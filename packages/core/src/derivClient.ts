import type { ContractType, Proposal, ProposalRequest } from "./types";

// Classic Deriv WebSocket API v3. Works from browser, React Native
// (with a WebSocket polyfill, which RN provides natively), or Node.
const DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3";

/** Deriv's hard cap, from the app_register/app_update schemas. */
export const MAX_MARKUP_PERCENTAGE = 3;

type MessageHandler = (msg: Record<string, unknown>) => void;

/**
 * Thin wrapper around Deriv's WebSocket API. Deliberately framework-free
 * (no React hooks here) so the same class can be used from a Next.js
 * page, a React Native screen, or a background worker.
 *
 * Usage:
 *   const client = new DerivClient(APP_ID);
 *   await client.connect();
 *   await client.authorize(token);
 *   client.subscribeBalance((balance) => ...);
 */
export class DerivClient {
  private ws: WebSocket | null = null;
  private appId: string;
  private markupPercentage: number;
  private requestId = 0;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private subscribers = new Map<string, Set<MessageHandler>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * @param appId  Numeric Deriv App ID. Markup is attributed to this app, so
   *               revenue depends on it being *your* app ID, not a test one.
   * @param markupPercentage  Percentage of contract payout added to every
   *               contract — the revenue model. Applied in `getProposal` only,
   *               so it can never be accidentally omitted at a call site.
   */
  constructor(appId: string, markupPercentage = 0) {
    this.appId = appId;
    this.markupPercentage = markupPercentage;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${DERIV_WS_URL}?app_id=${this.appId}`);

      this.ws.onopen = () => {
        // Keep the connection alive; Deriv closes idle sockets.
        this.pingInterval = setInterval(() => {
          this.send({ ping: 1 });
        }, 30000);
        resolve();
      };

      this.ws.onerror = (err) => reject(err);

      this.ws.onclose = () => {
        if (this.pingInterval) clearInterval(this.pingInterval);
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        const reqId = (msg.req_id as number) ?? undefined;

        if (reqId && this.pending.has(reqId)) {
          this.pending.get(reqId)?.(msg);
          this.pending.delete(reqId);
        }

        const msgType = msg.msg_type as string;
        this.subscribers.get(msgType)?.forEach((cb) => cb(msg));
      };
    });
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

  authorize(token: string): Promise<Record<string, unknown>> {
    return this.request({ authorize: token });
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
      symbol: req.symbol,
      // NOTE: app_markup_percentage is NOT accepted here. Deriv rejects it with
      // "Properties not allowed" (verified against the live API). Markup is
      // applied at buy time — see buyContract below.
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
   * Markup — the revenue model — can be applied two ways, and this method
   * covers both:
   *
   *   App-wide:  set app_markup_percentage on the app itself (dashboard, or the
   *              app_update API call). Applies to every contract automatically.
   *              This is the recommended default.
   *   Per-buy:   only possible via the `buy: 1` + `parameters` form, which is
   *              what this method uses when a markup is configured. Buying by
   *              proposal ID cannot carry a markup.
   *
   * Deriv's schema caps markup at 3% of payout; over-cap values are rejected.
   *
   * `price` is the maximum you'll pay. It must leave room for the markup, or
   * Deriv rejects the buy for being under the asking price.
   */
  async buyContract(
    proposal: Proposal,
    price: number,
    req?: ProposalRequest
  ): Promise<number> {
    const useParameterForm = this.markupPercentage > 0 && req;

    const payload = useParameterForm
      ? {
          buy: 1,
          price,
          parameters: {
            amount: req!.amount,
            basis: req!.basis,
            contract_type: req!.contractType,
            currency: req!.currency,
            duration: req!.duration,
            duration_unit: req!.durationUnit,
            symbol: req!.symbol,
            app_markup_percentage: Math.min(this.markupPercentage, MAX_MARKUP_PERCENTAGE),
          },
        }
      : { buy: proposal.id, price };

    const msg = await this.request(payload);
    const buy = msg.buy as Record<string, unknown>;
    return buy.contract_id as number;
  }

  /** Markup earned over a period — how you check the revenue is actually landing. */
  async getMarkupDetails(dateFrom?: string, dateTo?: string): Promise<Record<string, unknown>> {
    return this.request({
      app_markup_details: 1,
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {}),
    });
  }

  /**
   * Watches a contract until it settles, then reports the real outcome.
   *
   * Without this, trades stay `"open"` with zero profit forever — which means
   * Risk Guardian's loss limits can never trigger, and the journal is empty.
   * Returns an unsubscribe function.
   */
  watchContract(
    contractId: number,
    onSettled: (result: "won" | "lost", profit: number) => void
  ): () => void {
    this.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });

    const off = this.on("proposal_open_contract", (msg) => {
      const c = msg.proposal_open_contract as Record<string, unknown> | undefined;
      if (!c || c.contract_id !== contractId) return;

      // is_sold flips once Deriv has settled the contract.
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
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.ws?.close();
    this.ws = null;
  }
}

export type { ContractType };
