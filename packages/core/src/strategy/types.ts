/**
 * Strategy definition — the thing a bot runs.
 *
 * The single most important property here: **a strategy is data, never code.**
 * These objects come from users (uploaded DBot XML, or a builder UI), get
 * stored as JSONB, and are executed on our servers. If a strategy could carry
 * an expression to `eval`, one uploaded file would own the machine holding
 * every other user's trading tokens.
 *
 * So conditions are a small typed tree with a fixed set of operators. Anything
 * the tree can't express is a feature we decide to add, not something a user
 * can smuggle in.
 */

import type { ProposalRequest } from "../types";

// ---------------------------------------------------------------- conditions

export type Comparison = "<" | "<=" | "==" | "!=" | ">=" | ">";

export type Condition =
  /** Always true — buy on every opportunity. */
  | { op: "always" }
  /** Last digit of the most recent tick. */
  | { op: "lastDigit"; cmp: Comparison; value: number }
  /** Direction of the most recent tick versus the one before it. */
  | { op: "tickDirection"; is: "up" | "down" }
  /** N ticks in the same direction. */
  | { op: "streak"; direction: "up" | "down"; cmp: Comparison; value: number }
  /** Percentage move over the last N ticks. */
  | { op: "priceChange"; overTicks: number; cmp: Comparison; pct: number }
  /** Outcome of the previous settled trade. */
  | { op: "lastResult"; is: "won" | "lost" }
  /** Current losing streak in this session. */
  | { op: "consecutiveLosses"; cmp: Comparison; value: number }
  /** Trades placed in this session. */
  | { op: "tradeCount"; cmp: Comparison; value: number }
  /** Session profit so far. */
  | { op: "sessionProfit"; cmp: Comparison; value: number }
  | { op: "and"; terms: Condition[] }
  | { op: "or"; terms: Condition[] }
  | { op: "not"; term: Condition };

// ------------------------------------------------------------------- staking

export type StakingPlan =
  | { type: "fixed"; amount: number }
  /**
   * Multiply the stake after a loss, reset on a win. Popular in the Deriv
   * community and the fastest way to lose an account — `maxSteps` caps the
   * ladder so a losing run can't compound without limit.
   */
  | { type: "martingale"; base: number; multiplier: number; maxSteps: number }
  /** Up one unit after a loss, down one after a win. Gentler than martingale. */
  | { type: "dalembert"; base: number; unit: number; maxSteps: number };

// ------------------------------------------------------------------ strategy

export interface StrategyLimits {
  /** Stop once session profit reaches this. */
  takeProfit?: number;
  /** Stop once session loss reaches this (positive number). */
  stopLoss?: number;
  maxTrades?: number;
  maxConsecutiveLosses?: number;
  /** Hard ceiling on any single stake, whatever the staking plan computes. */
  maxStake?: number;
}

/** The contract to buy, minus the fields the runner fills in. */
export type ContractSpec = Omit<ProposalRequest, "symbol" | "currency" | "amount">;

export interface Strategy {
  name: string;
  symbol: string;
  /**
   * Which contract to buy. Two entries means the strategy alternates by
   * condition — `entryUp` picks the first, `entryDown` the second.
   */
  contract: ContractSpec;
  contractAlt?: ContractSpec;
  /** When to buy `contract`. */
  entry: Condition;
  /** When to buy `contractAlt` instead. Ignored when contractAlt is absent. */
  entryAlt?: Condition;
  staking: StakingPlan;
  limits: StrategyLimits;
  /** Wait this many ticks after a settlement before trading again. */
  cooldownTicks?: number;
  /** Allow more than one contract open at a time. Off by default. */
  allowConcurrent?: boolean;
}

// -------------------------------------------------------------------- state

export interface TickPoint {
  quote: number;
  epoch: number;
}

export interface SessionState {
  trades: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
  profit: number;
  lastResult: "won" | "lost" | null;
  /** Rung of the staking ladder — 0 means base stake. */
  step: number;
  openContracts: number;
  /** Ticks seen since the last settlement, for cooldownTicks. */
  ticksSinceSettle: number;
}

export function initialSession(): SessionState {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
    profit: 0,
    lastResult: null,
    step: 0,
    openContracts: 0,
    ticksSinceSettle: Number.MAX_SAFE_INTEGER, // no cooldown before the first trade
  };
}

/** Why a runner stopped. Shown to the user verbatim, so keep it plain. */
export type StopReason =
  | "take-profit"
  | "stop-loss"
  | "max-trades"
  | "max-consecutive-losses"
  | "staking-ladder-exhausted"
  | "stopped-by-user"
  | "error";

export const STOP_REASON_TEXT: Record<StopReason, string> = {
  "take-profit": "Take profit reached.",
  "stop-loss": "Stop loss reached.",
  "max-trades": "Reached the maximum number of trades.",
  "max-consecutive-losses": "Hit the consecutive-loss limit.",
  "staking-ladder-exhausted": "Staking plan reached its maximum step.",
  "stopped-by-user": "Stopped.",
  error: "Stopped after an error.",
};
