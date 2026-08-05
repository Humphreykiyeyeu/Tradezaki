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

export class DerivClient {
  private ws: WebSocket | null = null;
  private getUrl: WebSocketUrlProvider;
  private requestId = 0;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private subscribers = new Map<string, Set<MessageHandler>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private closedByUs = false;

  constructor(getUrl: WebSocketUrlProvider) {
    this.getUrl = getUrl;
  }

  /**
   * Opens an authenticated connection. Each call fetches a fresh OTP, because
   * they are single-use and expire after 120 seconds — so reconnecting means
   * calling this again, not reusing the old URL.
   */
  async connect(): Promise<void> {
    const url = await this.getUrl();
    this.closedByUs = false;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        // Deriv drops idle sockets.
        this.pingInterval = setInterval(() => this.send({ ping: 1 }), 30000);
        resolve();
      };

      ws.onerror = () => reject(new Error("Could not connect to Deriv."));

      ws.onclose = () => {
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = null;
        // Fail any in-flight requests rather than leaving them hanging forever.
        for (const [, settle] of this.pending) settle({ error: { message: "Connection closed." } });
        this.pending.clear();
        if (!this.closedByUs) this.subscribers.get("__disconnect__")?.forEach((cb) => cb({}));
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

  /** Fires when the connection drops unexpectedly. Reconnect by calling connect() again. */
  onDisconnect(handler: () => void): () => void {
    return this.on("__disconnect__", handler);
  }

  private send(payload: Record<string, unknown>): number {
    const reqId = ++this.requestId;
    this.ws?.send(JSON.stringify({ ...payload, req_id: reqId }));
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
    this.send({ balance: 1, subscribe: 1 });
    this.on("balance", (msg) => {
      const balance = msg.balance as { balance: number; currency: string } | undefined;
      if (balance) onUpdate(balance.balance, balance.currency);
    });
  }

  async getProposal(req: ProposalRequest): Promise<Proposal> {
    const msg = await this.request({
      proposal: 1,
      amount: req.amount,
      basis: req.basis,
      contract_type: req.contractType,
      currency: req.currency,
      duration: req.duration,
      duration_unit: req.durationUnit,
      // Renamed from `symbol` in this API version.
      underlying_symbol: req.symbol,
      // app_markup_percentage is NOT accepted here — verified, it fails with
      // "Properties not allowed". Markup is configured on the app itself and
      // Deriv applies it automatically at purchase.
    });

    const p = msg.proposal as Record<string, unknown>;
    return {
      id: p.id as string,
      askPrice: p.ask_price as number,
      payout: p.payout as number,
      spot: p.spot as number,
      displayValue: p.display_value as string,
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
    const msg = await this.request({ buy: proposalId, price });
    return (msg.buy as Record<string, unknown>).contract_id as number;
  }

  /**
   * Watches a contract until it settles, then reports the real outcome.
   * Without this, trades stay "open" with zero profit forever, and Risk
   * Guardian's loss limits can never trigger. Returns an unsubscribe function.
   */
  watchContract(
    contractId: number,
    onSettled: (result: "won" | "lost", profit: number) => void
  ): () => void {
    this.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });

    const off = this.on("proposal_open_contract", (msg) => {
      const c = msg.proposal_open_contract as Record<string, unknown> | undefined;
      if (!c || c.contract_id !== contractId) return;

      if (c.is_sold === 1 || c.is_sold === true) {
        const profit = Number(c.profit ?? 0);
        onSettled(profit >= 0 ? "won" : "lost", profit);
        off();
      }
    });

    return off;
  }

  on(msgType: string, handler: MessageHandler): () => void {
    if (!this.subscribers.has(msgType)) this.subscribers.set(msgType, new Set());
    this.subscribers.get(msgType)!.add(handler);
    return () => this.subscribers.get(msgType)?.delete(handler);
  }

  disconnect(): void {
    this.closedByUs = true;
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.ws?.close();
    this.ws = null;
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
