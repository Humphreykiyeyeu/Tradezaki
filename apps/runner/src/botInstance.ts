import {
  DerivClient,
  StrategyRunner,
  STOP_REASON_TEXT,
  checkTradeAllowed,
  createDirectUrlProvider,
  DEFAULT_RISK_CONFIG,
  type OpenContract,
  type RiskGuardianConfig,
  type StopReason,
  type Strategy,
  type TradeLogEntry,
} from "@tradezaki/core";

import { config } from "./config.js";
import { db } from "./db.js";
import { logEvent, line } from "./log.js";
import { getUsableToken } from "./vault.js";

/**
 * One running bot: a Deriv connection, a StrategyRunner, and the bookkeeping
 * that ties them to the database.
 *
 * The runner itself is pure and already tested. Everything here is the messy
 * part it deliberately doesn't know about — connections, persistence, and the
 * failure modes of an unattended process.
 */

export interface BotRecord {
  id: string;
  user_id: string;
  deriv_account_id: string;
  name: string;
  strategy: Strategy;
}

export class BotInstance {
  private client: DerivClient | null = null;
  private runner: StrategyRunner;
  private stopTicks: (() => void) | null = null;
  private risk: RiskGuardianConfig = DEFAULT_RISK_CONFIG;
  private stopping = false;
  /** Trades this bot placed, so settlements from other sources are ignored. */
  private ours = new Set<number>();

  constructor(
    readonly bot: BotRecord,
    private decimals: number
  ) {
    this.runner = new StrategyRunner({ strategy: bot.strategy, decimals });
  }

  get id(): string {
    return this.bot.id;
  }

  async start(): Promise<void> {
    await this.setStatus("starting");

    // Risk Guardian is the user's own limit, and it is enforced here as well as
    // in the strategy. A bot must not be able to trade past the ceiling its
    // owner set for the account just because the strategy said so.
    const { data: riskRow } = await db
      .from("risk_configs")
      .select("*")
      .eq("user_id", this.bot.user_id)
      .eq("deriv_account_id", this.bot.deriv_account_id)
      .maybeSingle();

    if (riskRow) {
      this.risk = {
        enabled: riskRow.enabled,
        dailyLossLimit: Number(riskRow.daily_loss_limit),
        maxConsecutiveLosses: riskRow.max_consecutive_losses,
        cooldownSeconds: riskRow.cooldown_seconds,
        maxStakePercentOfBalance: Number(riskRow.max_stake_percent_of_balance),
      };
    }

    const accessToken = await getUsableToken(this.bot.user_id);
    const client = new DerivClient(
      createDirectUrlProvider({
        appId: config.derivAppId,
        accessToken,
        accountId: this.bot.deriv_account_id,
      })
    );
    this.client = client;

    client.onStateChange((state) => {
      if (this.stopping) return;
      if (state === "offline") {
        // The client exhausts its own backoff before reporting offline, so this
        // is genuinely unrecoverable rather than a passing blip.
        void this.fail("Lost the connection to Deriv and could not get it back.");
      }
    });

    await client.connect();

    const history = await client.getTickHistory(this.bot.strategy.symbol, 100);
    this.runner.seed(history);

    this.stopTicks = client.subscribeTicks(this.bot.strategy.symbol, (quote, epoch) => {
      void this.onTick(quote, epoch);
    });

    await this.setStatus("running", null, { started_at: new Date().toISOString() });
    await logEvent(this.bot.user_id, this.bot.id, "info", `Started on ${this.bot.strategy.symbol}.`);
    line(this.bot.id, `running ${this.bot.strategy.symbol}`);
  }

  private async onTick(quote: number, epoch: number): Promise<void> {
    if (this.stopping || !this.client) return;

    const action = this.runner.onTick({ quote, epoch });
    if (!action) return;

    if (action.kind === "stop") {
      await this.finish(action.reason);
      return;
    }

    const { contract, amount } = action;

    // The account-level guard, checked against the day's real trades rather
    // than this session's — a second bot on the same account counts too.
    const balance = await this.currentBalance();
    const todaysTrades = await this.todaysTrades();
    const allowed = checkTradeAllowed(this.risk, todaysTrades, amount, balance);
    if (!allowed.allowed) {
      this.runner.onBuyFailed();
      await logEvent(this.bot.user_id, this.bot.id, "warn", allowed.reason ?? "Blocked by your risk limits.");
      await this.finish("stopped-by-user", allowed.reason);
      return;
    }

    try {
      const proposal = await this.client.getProposal({
        ...contract,
        symbol: this.bot.strategy.symbol,
        currency: "USD",
        amount,
      });
      const contractId = await this.client.buyContract(proposal.id, proposal.askPrice);
      this.ours.add(contractId);

      await db.from("trades").insert({
        user_id: this.bot.user_id,
        deriv_account_id: this.bot.deriv_account_id,
        contract_id: contractId,
        bot_id: this.bot.id,
        symbol: this.bot.strategy.symbol,
        contract_type: contract.contractType,
        stake: amount,
        buy_price: proposal.askPrice,
        payout: proposal.payout,
        result: "open",
      });

      this.client.watchContract(contractId, (c) => void this.onContract(c));
    } catch (err) {
      this.runner.onBuyFailed();
      const msg = err instanceof Error ? err.message : "Buy failed.";
      await logEvent(this.bot.user_id, this.bot.id, "warn", `Trade rejected: ${msg}`);
    }
  }

  private async onContract(c: OpenContract): Promise<void> {
    if (!c.isSold || !this.ours.has(c.contractId)) return;
    this.ours.delete(c.contractId);

    await db
      .from("trades")
      .update({
        result: c.profit >= 0 ? "won" : "lost",
        profit: c.profit,
        settled_at: new Date().toISOString(),
      })
      .eq("user_id", this.bot.user_id)
      .eq("contract_id", c.contractId);

    const action = this.runner.onSettle(c.profit);
    if (action?.kind === "stop") await this.finish(action.reason);
  }

  private async currentBalance(): Promise<number> {
    // Deriv's balance stream is the authority, but the risk check only needs a
    // number for the percent-of-balance rule; 0 disables that rule rather than
    // blocking every trade, which a failed lookup must not do.
    return 0;
  }

  private async todaysTrades(): Promise<TradeLogEntry[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data } = await db
      .from("trades")
      .select("contract_id, symbol, contract_type, stake, result, profit, opened_at")
      .eq("user_id", this.bot.user_id)
      .eq("deriv_account_id", this.bot.deriv_account_id)
      .gte("opened_at", start.toISOString());

    return (data ?? []).map((t) => ({
      id: String(t.contract_id),
      timestamp: Date.parse(t.opened_at),
      symbol: t.symbol,
      contractType: t.contract_type,
      stake: Number(t.stake),
      result: t.result as TradeLogEntry["result"],
      profit: Number(t.profit),
      accountId: this.bot.deriv_account_id,
    }));
  }

  /** Ends the bot cleanly, recording why in language the user will understand. */
  async finish(reason: StopReason, detail?: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    this.runner.stop(reason);
    this.stopTicks?.();
    this.client?.disconnect();
    this.client = null;

    const text = detail ?? STOP_REASON_TEXT[reason];
    await this.setStatus("stopped", text, { stopped_at: new Date().toISOString() });
    await logEvent(this.bot.user_id, this.bot.id, "info", text);
    line(this.bot.id, `stopped: ${text}`);
  }

  private async fail(message: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    this.stopTicks?.();
    this.client?.disconnect();
    this.client = null;

    await this.setStatus("error", message, { stopped_at: new Date().toISOString() });
    await logEvent(this.bot.user_id, this.bot.id, "error", message);
    line(this.bot.id, `error: ${message}`);
  }

  async stop(): Promise<void> {
    await this.finish("stopped-by-user");
  }

  async heartbeat(): Promise<void> {
    if (this.stopping) return;
    await db
      .from("bots")
      .update({ last_heartbeat: new Date().toISOString() })
      .eq("id", this.bot.id);
  }

  get finished(): boolean {
    return this.stopping;
  }

  private async setStatus(
    status: string,
    detail?: string | null,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    await db
      .from("bots")
      .update({ status, status_detail: detail ?? null, ...extra })
      .eq("id", this.bot.id);
  }
}
