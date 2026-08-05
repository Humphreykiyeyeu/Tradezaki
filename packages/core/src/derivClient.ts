import type { ContractType, Proposal, ProposalRequest } from "./types";

// Classic Deriv WebSocket API v3. Works from browser, React Native
// (with a WebSocket polyfill, which RN provides natively), or Node.
const DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3";

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
  private requestId = 0;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private subscribers = new Map<string, Set<MessageHandler>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(appId: string) {
    this.appId = appId;
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

  async buyContract(proposalId: string, price: number): Promise<Record<string, unknown>> {
    return this.request({ buy: proposalId, price });
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
