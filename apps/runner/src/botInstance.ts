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

/**
 * What guards a real-money account that has no limits of its own.
 *
 * Chosen to be loose enough that a reasonable bot never notices it, and tight
 * enough that a runaway one stops the same day rather than at dawn. It is a
 * floor, not a recommendation — the user's own limits replace it entirely.
 */
const REAL_MONEY_FALLBACK: RiskGuardianConfig = {
  enabled: true,
  dailyLossLimit: 50,
  maxConsecutiveLosses: 5,
  cooldownSeconds: 900,
  maxStakePercentOfBalance: 5,
};

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
  /** Latest balance from Deriv's stream; 0 until the first message arrives. */
  private balance = 0;
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
    // Status is already 'running' — the supervisor set it as an atomic claim
    // before constructing this instance, so two runners can't both take it.

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
    } else if (await this.isRealMoney()) {
      // No limits configured, and this is real money running unattended. The
      // shared default has every rule switched off, which is a reasonable
      // default for a person watching a screen and a bad one for a process that
      // will keep buying all night. Fail safe instead, and say so — a limit the
      // user did not set must never be silent.
      this.risk = REAL_MONEY_FALLBACK;
      await logEvent(
        this.bot.user_id,
        this.bot.id,
        "warn",
        "No risk limits set for this account, so a safe default is in force: " +
          `stop after ${REAL_MONEY_FALLBACK.dailyLossLimit} lost in a day, ` +
          `pause after ${REAL_MONEY_FALLBACK.maxConsecutiveLosses} losses in a row, ` +
          `and no single stake above ${REAL_MONEY_FALLBACK.maxStakePercentOfBalance}% of balance. ` +
          "Set your own limits on the Account page."
      );
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

    await client.connect();

    // Subscribed only after the connection is up, and deliberately so.
    // onStateChange reports the current state to a new listener immediately,
    // and a client that has not connected yet is "offline" — so registering
    // this before connect() fired "lost the connection" on every single start,
    // before a socket had even been attempted. Failures during connect() throw
    // instead, and the supervisor already turns those into an error status.
    client.onStateChange((state) => {
      if (this.stopping) return;
      if (state === "offline") {
        // The client exhausts its own backoff before reporting offline, so this
        // is genuinely unrecoverable rather than a passing blip.
        void this.fail("Lost the connection to Deriv and could not get it back.");
      }
    });

    // Feeds the percent-of-balance rule. Subscribed rather than polled because
    // the balance moves with every settlement, and a stale one would let a
    // drained account keep sizing trades as though it were still full.
    client.subscribeBalance((b) => {
      this.balance = b;
    });

    const history = await client.getTickHistory(this.bot.strategy.symbol, 100);

    // Starting is not instantaneous, and the connection can die inside any of
    // the awaits above. Without these checks the tail of start() would overwrite
    // the error fail() just recorded with status 'running' — leaving a bot that
    // the database calls healthy, that no instance is executing, and that
    // reports the wrong reason an hour later when the heartbeat reaper finds it.
    if (this.stopping) return;

    this.runner.seed(history);

    this.stopTicks = client.subscribeTicks(this.bot.strategy.symbol, (quote, epoch) => {
      void this.onTick(quote, epoch);
    });

    if (this.stopping) {
      this.stopTicks?.();
      return;
    }

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

  /**
   * Asks the database rather than reading the account id.
   *
   * Deriv's prefixes have changed across API generations and are not a contract
   * — guessing from them is how a real account gets treated as practice money.
   * deriv_accounts is written from Deriv's own answer at login.
   */
  private async isRealMoney(): Promise<boolean> {
    const { data } = await db
      .from("deriv_accounts")
      .select("account_type")
      .eq("user_id", this.bot.user_id)
      .eq("account_id", this.bot.deriv_account_id)
      .maybeSingle();

    // Unknown is treated as real. The cost of being wrong the other way is
    // someone's actual balance.
    return data?.account_type !== "demo";
  }

  private async currentBalance(): Promise<number> {
    // Fed by Deriv's balance stream, subscribed in start(). It used to return a
    // hard-coded 0, which silently disabled the percent-of-balance rule
    // entirely — the limit could be set, displayed, and stored, and no trade
    // was ever measured against it. 0 still means "unknown", which disables the
    // rule rather than blocking every trade, because a missing balance must not
    // stop a bot that is otherwise within its limits.
    return this.balance;
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
