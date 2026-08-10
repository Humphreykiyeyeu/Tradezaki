import { evaluate, type EvalContext } from "./conditions";
import { ladderExhausted, nextStep, stakeFor } from "./staking";
import {
  initialSession,
  type ContractSpec,
  type SessionState,
  type StopReason,
  type Strategy,
  type TickPoint,
} from "./types";

/**
 * Strategy execution, as a pure state machine.
 *
 * It consumes market events and returns *intents*; it never places a trade
 * itself and holds no connection. That separation is what makes it testable
 * against synthetic ticks, runnable in the browser for a dry run, and runnable
 * on the server for the real thing — the same code, with no branching on
 * environment.
 */

export type RunnerAction =
  | { kind: "buy"; contract: ContractSpec; amount: number }
  | { kind: "stop"; reason: StopReason };

export interface RunnerOptions {
  strategy: Strategy;
  decimals: number;
  /** Ticks kept for condition evaluation. */
  maxTicks?: number;
}

export class StrategyRunner {
  readonly strategy: Strategy;
  private decimals: number;
  private maxTicks: number;
  private ticks: TickPoint[] = [];
  private session: SessionState = initialSession();
  private stopped: StopReason | null = null;

  constructor(opts: RunnerOptions) {
    this.strategy = opts.strategy;
    this.decimals = opts.decimals;
    this.maxTicks = opts.maxTicks ?? 200;
  }

  get state(): SessionState {
    return { ...this.session };
  }

  get stopReason(): StopReason | null {
    return this.stopped;
  }

  get isStopped(): boolean {
    return this.stopped !== null;
  }

  stop(reason: StopReason = "stopped-by-user"): void {
    if (!this.stopped) this.stopped = reason;
  }

  /** Seeds history without triggering trades — used when a bot starts mid-stream. */
  seed(ticks: TickPoint[]): void {
    this.ticks = ticks.slice(-this.maxTicks);
  }

  /**
   * Feeds one tick and returns what to do about it.
   *
   * Limits are checked BEFORE entry conditions, so a bot that has hit stop-loss
   * cannot squeeze one more trade in on the same tick that breached it.
   */
  onTick(tick: TickPoint): RunnerAction | null {
    if (this.stopped) return null;

    this.ticks.push(tick);
    if (this.ticks.length > this.maxTicks) this.ticks.shift();
    if (this.session.ticksSinceSettle < Number.MAX_SAFE_INTEGER) {
      this.session.ticksSinceSettle += 1;
    }

    const limit = this.limitBreached();
    if (limit) {
      this.stopped = limit;
      return { kind: "stop", reason: limit };
    }

    if (!this.strategy.allowConcurrent && this.session.openContracts > 0) return null;

    const cooldown = this.strategy.cooldownTicks ?? 0;
    if (cooldown > 0 && this.session.ticksSinceSettle < cooldown) return null;

    const ctx: EvalContext = {
      ticks: this.ticks,
      session: this.session,
      decimals: this.decimals,
    };

    let contract: ContractSpec | null = null;
    if (evaluate(this.strategy.entry, ctx)) {
      contract = this.strategy.contract;
    } else if (this.strategy.contractAlt && this.strategy.entryAlt) {
      if (evaluate(this.strategy.entryAlt, ctx)) contract = this.strategy.contractAlt;
    }
    if (!contract) return null;

    const amount = this.nextStake();
    if (amount <= 0) return null;

    // Counted at buy time, not settlement — otherwise a strategy with no
    // concurrency guard would fire again on the very next tick.
    this.session.openContracts += 1;
    this.session.trades += 1;

    return { kind: "buy", contract, amount };
  }

  /** The stake the next trade would use, after limits are applied. */
  nextStake(): number {
    const raw = stakeFor(this.strategy.staking, this.session);
    const cap = this.strategy.limits.maxStake;
    return cap !== undefined ? Math.min(raw, cap) : raw;
  }

  /** Records a settled contract and advances the staking ladder. */
  onSettle(profit: number): RunnerAction | null {
    const won = profit >= 0;

    this.session.openContracts = Math.max(0, this.session.openContracts - 1);
    this.session.profit = round(this.session.profit + profit);
    this.session.lastResult = won ? "won" : "lost";
    this.session.ticksSinceSettle = 0;

    if (won) {
      this.session.wins += 1;
      this.session.consecutiveLosses = 0;
    } else {
      this.session.losses += 1;
      this.session.consecutiveLosses += 1;
    }

    this.session.step = nextStep(this.strategy.staking, this.session.step, won);

    if (this.stopped) return null;

    if (ladderExhausted(this.strategy.staking, this.session.step)) {
      this.stopped = "staking-ladder-exhausted";
      return { kind: "stop", reason: this.stopped };
    }

    const limit = this.limitBreached();
    if (limit) {
      this.stopped = limit;
      return { kind: "stop", reason: limit };
    }

    return null;
  }

  /** Called when a buy fails, so the open-contract count doesn't drift upward. */
  onBuyFailed(): void {
    this.session.openContracts = Math.max(0, this.session.openContracts - 1);
    this.session.trades = Math.max(0, this.session.trades - 1);
  }

  private limitBreached(): StopReason | null {
    const { limits } = this.strategy;
    const s = this.session;

    if (limits.takeProfit !== undefined && s.profit >= limits.takeProfit) return "take-profit";
    if (limits.stopLoss !== undefined && s.profit <= -Math.abs(limits.stopLoss)) return "stop-loss";
    if (limits.maxTrades !== undefined && s.trades >= limits.maxTrades) return "max-trades";
    if (
      limits.maxConsecutiveLosses !== undefined &&
      s.consecutiveLosses >= limits.maxConsecutiveLosses
    ) {
      return "max-consecutive-losses";
    }
    return null;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
