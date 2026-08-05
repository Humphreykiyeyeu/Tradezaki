// Shared types for Tradezaki — used identically by the Next.js web app
// and (later) the React Native mobile app. Keep this file free of any
// DOM- or RN-specific APIs so it works in both environments.

export interface DerivAccount {
  loginid: string;
  token: string;
  currency: string;
  isVirtual: boolean;
}

export type ContractType =
  | "CALL" // Rise
  | "PUT" // Fall
  | "DIGITEVEN"
  | "DIGITODD"
  | "ONETOUCH"
  | "NOTOUCH";

export interface ProposalRequest {
  symbol: string; // e.g. "R_75" (Volatility 75 Index)
  contractType: ContractType;
  amount: number;
  currency: string;
  basis: "stake" | "payout";
  duration: number;
  durationUnit: "t" | "s" | "m" | "h" | "d";
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
