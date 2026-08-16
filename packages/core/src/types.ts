// Shared types for Tradezaki — used identically by the Next.js web app
// and (later) the React Native mobile app. Keep this file free of any
// DOM- or RN-specific APIs so it works in both environments.

export interface DerivAccount {
  loginid: string;
  token: string;
  currency: string;
  isVirtual: boolean;
}

/**
 * Deriv exposes ~30 contract types and adds more over time, so this is a plain
 * string rather than a union. What's actually tradable on a given symbol comes
 * from `getContractsFor()` at runtime — hardcoding a list here would go stale
 * and would silently hide contracts the user could otherwise trade.
 */
export type ContractType = string;

export interface ProposalRequest {
  symbol: string; // e.g. "R_75" (Volatility 75 Index)
  contractType: ContractType;
  amount: number;
  currency: string;
  basis: "stake" | "payout";
  /** Omitted for contracts with no expiry, e.g. Accumulators. */
  duration?: number;
  durationUnit?: "t" | "s" | "m" | "h" | "d";
  /**
   * Barrier for Touch/No Touch, Higher/Lower, Ends/Stays In-Out — and doubles as
   * the digit prediction for Over/Under/Matches/Differs, which is how Deriv's
   * API models it.
   */
  barrier?: string;
  /** Second barrier, for range contracts that need two. */
  barrier2?: string;
  /** Which tick in the series is being bet on — High/Low Tick contracts only. */
  selectedTick?: number;
  /** Accumulators: the per-tick growth rate, e.g. 0.03 for 3%. */
  growthRate?: number;
  /** Multipliers: leverage factor. */
  multiplier?: number;
  /**
   * Close automatically once profit reaches this. Deriv calls it a limit order.
   * Offered on Multipliers and Accumulators — both run until something closes
   * them, so without this the only exit is watching the screen.
   */
  takeProfit?: number;
  /**
   * Close automatically once the loss reaches this. Multipliers only —
   * Accumulators cannot take one, because a breach of the range already ends
   * the contract at zero.
   */
  stopLoss?: number;
  /**
   * Deal cancellation window, e.g. "5m". Multipliers only, and only on markets
   * that offer it. Deriv rejects a stop loss sent alongside it, since
   * cancellation already guarantees the stake back.
   */
  cancellation?: string;
}

/**
 * Extra detail Deriv returns when pricing an Accumulator.
 *
 * `ticksStayedIn` is the one that matters on screen: how many ticks each of the
 * recent contracts survived before the price left the range. It is the
 * Accumulator equivalent of the last-digit strip — the at-a-glance read of what
 * this market has been doing — and Deriv's own interface leads with it.
 */
export interface AccumulatorDetails {
  ticksStayedIn: number[];
  highBarrier: number | null;
  lowBarrier: number | null;
  /** The contract closes itself here, however well it is doing. */
  maximumTicks: number | null;
  maximumPayout: number | null;
  minimumStake: number | null;
  maximumStake: number | null;
  /** How far the range sits from spot, as Deriv's own percentage string. */
  barrierPercentage: string | null;
}

export interface Proposal {
  id: string;
  askPrice: number;
  payout: number;
  spot: number;
  displayValue: string;
  /** Present for Accumulators only. */
  accumulator?: AccumulatorDetails | null;
}

export interface TradeLogEntry {
  id: string;
  timestamp: number; // ms epoch
  symbol: string;
  contractType: ContractType;
  stake: number;
  result: "won" | "lost" | "open";
  profit: number;
  accountId: string;
}

export interface RiskGuardianConfig {
  /**
   * Master switch. Off by default — these limits are the trader's to opt into,
   * not something imposed on them.
   */
  enabled: boolean;
  dailyLossLimit: number; // in account currency, 0 = disabled
  maxConsecutiveLosses: number; // 0 = disabled
  cooldownSeconds: number; // pause enforced after hitting the streak limit
  maxStakePercentOfBalance: number; // 0-100, 0 = disabled
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  cooldownEndsAt?: number; // ms epoch, present when a cooldown is active
}
