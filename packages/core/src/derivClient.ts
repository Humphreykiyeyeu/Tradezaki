import type { Proposal, ProposalRequest } from "./types";

/**
 * Client for Deriv's CURRENT Options API.
 *
 * This is NOT the classic `wss://ws.derivws.com/websockets/v3?app_id=NNNN` API.
 * Accounts migrated to the new platform (check
 * `GET /trading/v1/options/legacy/migration-status`) are rejected by the legacy
 * endpoint entirely — wrong app_id format, wrong token format, no way in.
 *
 * What changed, and what didn't:
 *
 *   Connection  REST call for a one-time password, which returns a ready-made
 *               WebSocket URL. There is no `authorize` message — the socket is
 *               already authenticated when it opens.
 *   App ID      A string, sent as the `Deriv-App-ID` HTTP header. Not numeric,
 *               not a query parameter. Markup is attributed to it.
 *   Messages    Unchanged. Same `{ msg_type, echo_req, req_id }` envelope as v3,
 *               so trading logic ports over as-is.
 *   Fields      `symbol` is now `underlying_symbol` on proposal. Sending
 *               `symbol` fails with "Properties not allowed".
 *
 * All of the above verified against the live API.
 */

export const DERIV_REST_BASE = "https://api.derivws.com";

/** Deriv's hard cap on markup, per the app registration schema. */
export const MAX_MARKUP_PERCENTAGE = 3;

type MessageHandler = (msg: Record<string, unknown>) => void;

/**
 * Returns an authenticated WebSocket URL.
 *
 * Kept as an injected function so the access token never has to live wherever
 * the client does. In the browser this should call your own server route (see
 * `apps/web/app/api/deriv/ws-url`), so the long-lived token stays server-side
 * and only the 120-second single-use URL reaches the page.
 */
export type WebSocketUrlProvider = () => Promise<string>;

/**
 * Builds a URL provider that talks to Deriv directly. Server-side only — using
 * this in a browser exposes the access token to any script on the page.
 */
export function createDirectUrlProvider(opts: {
  appId: string;
  accessToken: string;
  accountId: string;
  restBase?: string;
}): WebSocketUrlProvider {
  return async () => {
    const res = await fetch(
      `${opts.restBase ?? DERIV_REST_BASE}/trading/v1/options/accounts/${opts.accountId}/otp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Deriv-App-ID": opts.appId,
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Could not get a trading session (HTTP ${res.status}).`);
    }

    const body = (await res.json()) as { data?: { url?: string } };
    if (!body.data?.url) throw new Error("Deriv returned no WebSocket URL.");
    return body.data.url;
  };
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export interface ActiveSymbol {
  symbol: string;
  displayName: string;
  market: string;
  submarket: string;
  isOpen: boolean;
  isSuspended: boolean;
  pipSize: number;
}

export interface DurationRange {
  unit: "t" | "s" | "m" | "h" | "d";
  min: number;
  max: number;
}

export interface OpenContract {
  contractId: number;
  contractType: string;
  symbol: string;
  longcode: string;
  buyPrice: number;
  bidPrice: number;
  payout: number;
  profit: number;
  isSold: boolean;
  isValidToSell: boolean;
  entrySpot: number | null;
  currentSpot: number | null;
  barrier: number | null;
  /** Accumulators: boundaries that move on every tick. */
  highBarrier: number | null;
  lowBarrier: number | null;
  tickCount: number | null;
  tickPassed: number | null;
  growthRate: number | null;
  status: string;
}

export interface ContractAvailability {
  contractType: string;
  category: string;
  /** 0, 1 or 2 barrier inputs required. */
  barriers: number;
  /** Present on Over/Under-style digit contracts: the selectable digits. */
  lastDigitRange: number[] | null;
  durations: DurationRange[];
  defaultStake: number | null;
  /**
   * The multipliers this symbol actually offers, and they differ wildly:
   * R_100 allows 40–400, R_10 allows 400–4000, R_75 tops out at 500, and forex
   * offers up to 800. A hardcoded list is guaranteed to show numbers Deriv will
   * reject on some markets and to hide the ones a trader came for on others.
   */
  multiplierRange: number[] | null;
  /** Accumulators: the selectable per-tick growth rates, e.g. 0.01–0.05. */
  growthRateRange: number[] | null;
  /**
   * Deal-cancellation windows for multipliers, e.g. ["5m","10m"]. Empty on
   * forex and crypto, where Deriv does not offer it at all — so an empty array
   * is meaningful and must not be treated the same as absent.
   */
  cancellationRange: string[] | null;
  minStake: number | null;
  maxStake: number | null;
  /** Preset barrier offsets Deriv suggests, where it supplies them. */
  barrierChoices: string[] | null;
}

/** Deriv returns durations as strings like "5t", "1d", "15m". */
function parseDuration(min?: string, max?: string): DurationRange | null {
  if (!min || !max) return null;
  const m = /^(\d+)([tsmhd])$/.exec(min);
  const x = /^(\d+)([tsmhd])$/.exec(max);
  if (!m || !x || m[2] !== x[2]) return null;
  return { unit: m[2] as DurationRange["unit"], min: Number(m[1]), max: Number(x[1]) };
}

export class DerivClient {
  private ws: WebSocket | null = null;
  private getUrl: WebSocketUrlProvider;
  private requestId = 0;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private subscribers = new Map<string, Set<MessageHandler>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private closedByUs = false;

  // Subscriptions don't survive a socket. Deriv has no "resume" — a new socket
  // is a blank slate, so every stream has to be re-requested by hand. Without
  // this, a reconnect looks healthy while balance and settlement silently stop.
  private resubscribers = new Map<string, () => void>();

  private stateHandlers = new Set<(s: ConnectionState) => void>();
  private state: ConnectionState = "offline";
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 8;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(getUrl: WebSocketUrlProvider) {
    this.getUrl = getUrl;
  }

  onStateChange(handler: (s: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  private setState(s: ConnectionState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateHandlers.forEach((h) => h(s));
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Opens an authenticated connection. Each call fetches a fresh OTP, because
   * they are single-use and expire after 120 seconds — so reconnecting means
   * calling this again, not reusing the old URL.
   */
  async connect(): Promise<void> {
    this.closedByUs = false;
    this.setState(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    // A fresh OTP every time — they are single-use, so the previous URL is dead.
    let url: string;
    try {
      url = await this.getUrl();
    } catch (err) {
      // No socket was created, so no onclose will fire to trigger a retry. This
      // is usually an expired session, which retrying cannot fix.
      this.setState("offline");
      throw err;
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempts = 0;
        // Deriv drops idle sockets.
        this.pingInterval = setInterval(() => this.send({ ping: 1 }), 30000);
        this.setState("connected");
        // Re-establish every stream this client had before the drop.
        this.resubscribers.forEach((resub) => resub());
        resolve();
      };

      ws.onerror = () => reject(new Error("Could not connect to Deriv."));

      ws.onclose = () => {
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = null;
        // Fail any in-flight requests rather than leaving them hanging forever.
        for (const [, settle] of this.pending) settle({ error: { message: "Connection closed." } });
        this.pending.clear();

        if (this.closedByUs) {
          this.setState("offline");
          return;
        }
        this.scheduleReconnect();
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        const reqId = msg.req_id as number | undefined;

        if (reqId && this.pending.has(reqId)) {
          this.pending.get(reqId)?.(msg);
          this.pending.delete(reqId);
        }

        this.subscribers.get(msg.msg_type as string)?.forEach((cb) => cb(msg));
      };
    });
  }

  /**
   * Exponential backoff, capped at 30s. Each attempt fetches a new OTP, so this
   * also recovers from an expired session rather than only a flaky network —
   * provided the URL provider refreshes the access token when needed.
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState("offline");
      return;
    }

    this.reconnectAttempts += 1;
    this.setState("reconnecting");

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private send(payload: Record<string, unknown>): number {
    const reqId = ++this.requestId;
    // Only OPEN sockets accept sends — a CONNECTING one throws InvalidStateError.
    // Dropping the send is safe for subscriptions: the resubscribers replay them
    // once the socket opens.
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...payload, req_id: reqId }));
    }
    return reqId;
  }

  private request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const reqId = this.send(payload);
      this.pending.set(reqId, (msg) => {
        if (msg.error) reject(msg.error);
        else resolve(msg);
      });
    });
  }

  subscribeBalance(onUpdate: (balance: number, currency: string) => void): void {
    const request = () => this.send({ balance: 1, subscribe: 1 });
    this.resubscribers.set("balance", request);
    request();

    this.on("balance", (msg) => {
      const balance = msg.balance as { balance: number; currency: string } | undefined;
      if (balance) onUpdate(balance.balance, balance.currency);
    });
  }

  /** Tradable underlyings, with market grouping and open/closed state. */
  async getActiveSymbols(): Promise<ActiveSymbol[]> {
    const msg = await this.request({ active_symbols: "brief" });
    const list = (msg.active_symbols ?? []) as Record<string, unknown>[];
    return list.map((s) => ({
      symbol: s.underlying_symbol as string,
      displayName: (s.underlying_symbol_name as string) ?? (s.underlying_symbol as string),
      market: s.market as string,
      submarket: s.submarket as string,
      isOpen: s.exchange_is_open === 1,
      isSuspended: s.is_trading_suspended === 1,
      pipSize: (s.pip_size as number) ?? 2,
    }));
  }

  /**
   * What can actually be traded on a symbol, and within what limits.
   *
   * A symbol offers the same contract type at several expiry types (tick,
   * intraday, daily), so entries are merged per contract type and the widest
   * duration range kept. Building the UI from this rather than a hardcoded list
   * is what stops it offering combinations Deriv will reject.
   */
  async getContractsFor(symbol: string): Promise<ContractAvailability[]> {
    const msg = await this.request({ contracts_for: symbol });
    const container = msg.contracts_for as Record<string, unknown>;
    const available = (container?.available ?? []) as Record<string, unknown>[];

    const merged = new Map<string, ContractAvailability>();
    for (const c of available) {
      const type = c.contract_type as string;
      const entry = merged.get(type);
      const durations = parseDuration(
        c.min_contract_duration as string,
        c.max_contract_duration as string
      );

      if (!entry) {
        merged.set(type, {
          contractType: type,
          category: c.contract_category as string,
          barriers: (c.barriers as number) ?? 0,
          lastDigitRange: (c.last_digit_range as number[]) ?? null,
          durations: durations ? [durations] : [],
          defaultStake: (c.default_stake as number) ?? null,
          multiplierRange: (c.multiplier_range as number[]) ?? null,
          growthRateRange: (c.growth_rate_range as number[]) ?? null,
          cancellationRange: (c.cancellation_range as string[]) ?? null,
          minStake: (c.min_stake as number) ?? null,
          maxStake: (c.max_stake as number) ?? null,
          barrierChoices: (c.barrier_choices as string[]) ?? null,
        });
      } else if (durations) {
        entry.durations.push(durations);
      }
    }
    return [...merged.values()];
  }

  /**
   * Recent ticks, so a chart opens already populated instead of drawing itself
   * one point at a time. Note this call still uses `ticks_history: <symbol>` —
   * it did not get the `underlying_symbol` rename that `proposal` did.
   */
  async getTickHistory(symbol: string, count = 80): Promise<{ quote: number; epoch: number }[]> {
    const msg = await this.request({
      ticks_history: symbol,
      end: "latest",
      count,
      style: "ticks",
    });
    const h = msg.history as { prices?: number[]; times?: number[] } | undefined;
    if (!h?.prices || !h?.times) return [];
    return h.prices.map((quote, i) => ({ quote, epoch: h.times![i] }));
  }

  /** Streams live ticks for a symbol. Returns an unsubscribe function. */
  subscribeTicks(symbol: string, onTick: (quote: number, epoch: number) => void): () => void {
    const key = `ticks:${symbol}`;
    const request = () => this.send({ ticks: symbol, subscribe: 1 });
    this.resubscribers.set(key, request);
    request();

    const off = this.on("tick", (msg) => {
      const t = msg.tick as Record<string, unknown> | undefined;
      if (!t || t.symbol !== symbol) return;
      onTick(Number(t.quote), Number(t.epoch));
    });

    return () => {
      this.resubscribers.delete(key);
      off();
    };
  }

  async getProposal(req: ProposalRequest): Promise<Proposal> {
    const msg = await this.request({
      proposal: 1,
      amount: req.amount,
      basis: req.basis,
      contract_type: req.contractType,
      currency: req.currency,
      // Accumulators have no expiry — sending a duration is rejected.
      ...(req.duration !== undefined ? { duration: req.duration } : {}),
      ...(req.durationUnit !== undefined ? { duration_unit: req.durationUnit } : {}),
      ...(req.growthRate !== undefined ? { growth_rate: req.growthRate } : {}),
      ...(req.multiplier !== undefined ? { multiplier: req.multiplier } : {}),
      // Renamed from `symbol` in this API version.
      underlying_symbol: req.symbol,
      // Omitted entirely when not needed — sending an empty barrier is rejected.
      ...(req.barrier !== undefined ? { barrier: req.barrier } : {}),
      ...(req.barrier2 !== undefined ? { barrier2: req.barrier2 } : {}),
      ...(req.selectedTick !== undefined ? { selected_tick: req.selectedTick } : {}),
      // Take profit and stop loss travel together in one object, and it must be
      // omitted entirely rather than sent empty.
      ...(req.takeProfit !== undefined || req.stopLoss !== undefined
        ? {
            limit_order: {
              ...(req.takeProfit !== undefined ? { take_profit: req.takeProfit } : {}),
              ...(req.stopLoss !== undefined ? { stop_loss: req.stopLoss } : {}),
            },
          }
        : {}),
      ...(req.cancellation !== undefined ? { cancellation: req.cancellation } : {}),
      // app_markup_percentage is NOT accepted here — verified, it fails with
      // "Properties not allowed". Markup is configured on the app itself and
      // Deriv applies it automatically at purchase.
    });

    const p = msg.proposal as Record<string, unknown>;
    const d = p.contract_details as Record<string, unknown> | undefined;

    // Deriv sends these as strings as often as numbers, and mixing the two
    // silently produces "647.098646.402" where a sum was intended.
    const num = (v: unknown): number | null => {
      if (v === undefined || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    return {
      id: p.id as string,
      askPrice: p.ask_price as number,
      payout: p.payout as number,
      spot: p.spot as number,
      displayValue: p.display_value as string,
      accumulator: Array.isArray(d?.ticks_stayed_in)
        ? {
            ticksStayedIn: d!.ticks_stayed_in as number[],
            highBarrier: num(d!.high_barrier),
            lowBarrier: num(d!.low_barrier),
            maximumTicks: num(d!.maximum_ticks),
            maximumPayout: num(d!.maximum_payout),
            minimumStake: num(d!.minimum_stake),
            maximumStake: num(d!.maximum_stake),
            barrierPercentage: (d!.tick_size_barrier_percentage as string) ?? null,
          }
        : null,
    };
  }

  /**
   * Buys a contract and returns its ID.
   *
   * Markup is applied by Deriv from the app's own registered percentage, so it
   * needs no parameter here and cannot be forgotten at a call site. Check what
   * it actually earned with `GET /applications/v1/markup-statistics`.
   */
  async buyContract(proposalId: string, price: number): Promise<number> {
    // price as a string — that's what Deriv's own reference client sends, and
    // float formatting differences are a needless way to get a buy rejected.
    const msg = await this.request({ buy: proposalId, price: String(price) });
    return (msg.buy as Record<string, unknown>).contract_id as number;
  }

  /**
   * Streams a contract's live state until it settles.
   *
   * Deriv pushes an update on every tick, so this drives running P&L, the
   * chart's entry marker, the moving Accumulator boundaries, and whether a
   * sell button should be enabled. Watching only for settlement (which is what
   * this used to do) left the trader staring at a screen that never moved.
   *
   * Returns an unsubscribe function.
   */
  watchContract(contractId: number, onUpdate: (c: OpenContract) => void): () => void {
    const key = `contract:${contractId}`;
    const request = () =>
      this.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });

    // Re-watched after a reconnect. A contract can settle while the socket is
    // down; re-subscribing replays its state so the outcome isn't lost.
    this.resubscribers.set(key, request);
    request();

    // Each watch owns its own subscription id. Using forget_all here would kill
    // every other contract's stream too — one closed position freezing all the
    // rest is exactly the kind of bug that looks like "the app hung".
    let subscriptionId: string | null = null;

    const off = this.on("proposal_open_contract", (msg) => {
      const c = msg.proposal_open_contract as Record<string, unknown> | undefined;
      if (!c || Number(c.contract_id) !== contractId) return;

      const sub = msg.subscription as { id?: string } | undefined;
      if (sub?.id) subscriptionId = sub.id;

      const num = (v: unknown): number | null =>
        v === null || v === undefined || v === "" ? null : Number(v);

      const state: OpenContract = {
        contractId,
        contractType: String(c.contract_type ?? ""),
        // `underlying_symbol` here too — the same rename `proposal` got. Deriv's
        // published schema still documents the legacy `underlying`.
        symbol: String(c.underlying_symbol ?? c.underlying ?? ""),
        longcode: String(c.longcode ?? ""),
        buyPrice: Number(c.buy_price ?? 0),
        bidPrice: Number(c.bid_price ?? 0),
        payout: Number(c.payout ?? 0),
        profit: Number(c.profit ?? 0),
        isSold: c.is_sold === 1 || c.is_sold === true,
        isValidToSell: c.is_valid_to_sell === 1 || c.is_valid_to_sell === true,
        entrySpot: num(c.entry_spot),
        currentSpot: num(c.current_spot),
        barrier: num(c.barrier),
        // Accumulators move their boundaries every tick; these are the live ones.
        highBarrier: num(c.current_spot_high_barrier ?? c.high_barrier),
        lowBarrier: num(c.current_spot_low_barrier ?? c.low_barrier),
        tickCount: num(c.tick_count),
        // No tick_passed field on this API — the streamed ticks are the count.
        tickPassed: Array.isArray(c.tick_stream) ? c.tick_stream.length : num(c.tick_passed),
        growthRate: num(c.growth_rate),
        status: String(c.status ?? "open"),
      };

      onUpdate(state);
      if (state.isSold) stop();
    });

    const stop = () => {
      this.resubscribers.delete(key);
      if (subscriptionId) this.send({ forget: subscriptionId });
      off();
    };

    return stop;
  }

  /**
   * Sells an open contract at market. `price: 0` means "accept the current
   * bid" — Deriv rejects a sell priced above what it is currently offering.
   */
  async sellContract(contractId: number): Promise<number> {
    const msg = await this.request({ sell: contractId, price: 0 });
    const sold = msg.sell as Record<string, unknown>;
    return Number(sold.sold_for ?? 0);
  }

  on(msgType: string, handler: MessageHandler): () => void {
    if (!this.subscribers.has(msgType)) this.subscribers.set(msgType, new Set());
    this.subscribers.get(msgType)!.add(handler);
    return () => this.subscribers.get(msgType)?.delete(handler);
  }

  disconnect(): void {
    this.closedByUs = true;
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.resubscribers.clear();
    this.ws?.close();
    this.ws = null;
    this.setState("offline");
  }
}

/**
 * Lists the Deriv accounts this token can trade. Server-side only.
 * Returns both real and demo accounts with balances.
 */
export async function listAccounts(opts: {
  appId: string;
  accessToken: string;
  restBase?: string;
}): Promise<
  { accountId: string; balance: string; currency: string; accountType: string; status: string }[]
> {
  const res = await fetch(`${opts.restBase ?? DERIV_REST_BASE}/trading/v1/options/accounts`, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Deriv-App-ID": opts.appId,
    },
  });

  if (!res.ok) throw new Error(`Could not list accounts (HTTP ${res.status}).`);

  const body = (await res.json()) as {
    data?: {
      account_id: string;
      balance: string;
      currency: string;
      account_type: string;
      status: string;
    }[];
  };

  return (body.data ?? []).map((a) => ({
    accountId: a.account_id,
    balance: a.balance,
    currency: a.currency,
    accountType: a.account_type,
    status: a.status,
  }));
}

/** Tops a demo account back up to its starting balance. Demo accounts only. */
export async function resetDemoBalance(opts: {
  appId: string;
  accessToken: string;
  accountId: string;
  restBase?: string;
}): Promise<void> {
  const res = await fetch(
    `${opts.restBase ?? DERIV_REST_BASE}/trading/v1/options/accounts/${opts.accountId}/reset-demo-balance`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Deriv-App-ID": opts.appId,
      },
    }
  );
  if (!res.ok) throw new Error(`Could not reset the demo balance (HTTP ${res.status}).`);
}

/** Markup earned over a date range — the revenue report. Server-side only. */
export async function getMarkupStatistics(opts: {
  appId: string;
  accessToken: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  restBase?: string;
}): Promise<{
  totalMarkupUsd: number;
  totalVolumeUsd: number;
  totalContracts: number;
  totalClients: number;
}> {
  const url = new URL(`${opts.restBase ?? DERIV_REST_BASE}/applications/v1/markup-statistics`);
  url.searchParams.set("date_from", opts.dateFrom);
  url.searchParams.set("date_to", opts.dateTo);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Deriv-App-ID": opts.appId,
    },
  });

  if (!res.ok) throw new Error(`Could not fetch markup statistics (HTTP ${res.status}).`);

  const body = (await res.json()) as {
    data?: {
      total_app_markup_usd?: number;
      total_volume_usd?: number;
      total_contract_count?: number;
      total_client_count?: number;
    };
  };

  return {
    totalMarkupUsd: body.data?.total_app_markup_usd ?? 0,
    totalVolumeUsd: body.data?.total_volume_usd ?? 0,
    totalContracts: body.data?.total_contract_count ?? 0,
    totalClients: body.data?.total_client_count ?? 0,
  };
}
