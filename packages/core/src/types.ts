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
}

export interface Proposal {
  id: string;
  askPrice: number;
  payout: number;
  spot: number;
  displayValue: string;
}

export interface OpenContract {
  contractId: number;
  buyPrice: number;
  payout: number;
  profit: number;
  status: "open" | "won" | "lost";
  symbol: string;
  contractType: ContractType;
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
