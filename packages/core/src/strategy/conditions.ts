import type { Comparison, Condition, SessionState, TickPoint } from "./types";

/**
 * Evaluates a strategy condition against market and session state.
 *
 * Pure and total: every operator is handled, unknown input returns false rather
 * than throwing. A bot must not die because a condition was malformed — it
 * should simply not trade.
 */

function compare(a: number, cmp: Comparison, b: number): boolean {
  switch (cmp) {
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case ">=":
      return a >= b;
    case ">":
      return a > b;
    default:
      return false;
  }
}

/** Last decimal digit of a quote, which is what digit contracts settle on. */
export function lastDigitOf(quote: number, decimals: number): number {
  const s = quote.toFixed(decimals);
  return Number(s[s.length - 1]);
}

function directionStreak(ticks: TickPoint[], direction: "up" | "down"): number {
  let n = 0;
  for (let i = ticks.length - 1; i > 0; i -= 1) {
    const rising = ticks[i].quote > ticks[i - 1].quote;
    const falling = ticks[i].quote < ticks[i - 1].quote;
    const matches = direction === "up" ? rising : falling;
    if (!matches) break;
    n += 1;
  }
  return n;
}

export interface EvalContext {
  ticks: TickPoint[];
  session: SessionState;
  /** Decimal places for this symbol — needed to read the last digit correctly. */
  decimals: number;
}

export function evaluate(condition: Condition, ctx: EvalContext): boolean {
  const { ticks, session } = ctx;

  switch (condition.op) {
    case "always":
      return true;

    case "lastDigit": {
      if (ticks.length === 0) return false;
      const d = lastDigitOf(ticks[ticks.length - 1].quote, ctx.decimals);
      return compare(d, condition.cmp, condition.value);
    }

    case "tickDirection": {
      if (ticks.length < 2) return false;
      const a = ticks[ticks.length - 2].quote;
      const b = ticks[ticks.length - 1].quote;
      // A flat tick is neither up nor down; saying otherwise would fire trades
      // on no movement at all.
      if (b === a) return false;
      return condition.is === "up" ? b > a : b < a;
    }

    case "streak":
      return compare(directionStreak(ticks, condition.direction), condition.cmp, condition.value);

    case "priceChange": {
      if (ticks.length < condition.overTicks + 1) return false;
      const from = ticks[ticks.length - 1 - condition.overTicks].quote;
      const to = ticks[ticks.length - 1].quote;
      if (from === 0) return false;
      return compare(((to - from) / from) * 100, condition.cmp, condition.pct);
    }

    case "lastResult":
      return session.lastResult === condition.is;

    case "consecutiveLosses":
      return compare(session.consecutiveLosses, condition.cmp, condition.value);

    case "tradeCount":
      return compare(session.trades, condition.cmp, condition.value);

    case "sessionProfit":
      return compare(session.profit, condition.cmp, condition.value);

    case "and":
      return condition.terms.every((t) => evaluate(t, ctx));

    case "or":
      return condition.terms.some((t) => evaluate(t, ctx));

    case "not":
      return !evaluate(condition.term, ctx);

    default:
      // Unknown operator — refuse to trade rather than guess.
      return false;
  }
}

/**
 * Rejects conditions that are malformed or nested absurdly deeply.
 *
 * Depth matters: these arrive from user uploads, and a few thousand nested
 * `not`s would blow the stack when evaluated on the server.
 */
export function validateCondition(c: unknown, depth = 0): string | null {
  if (depth > 20) return "Condition is nested too deeply.";
  if (typeof c !== "object" || c === null) return "Condition must be an object.";

  const cond = c as Record<string, unknown>;
  const op = cond.op;

  switch (op) {
    case "always":
    case "lastResult":
    case "tickDirection":
      return null;

    case "lastDigit":
    case "consecutiveLosses":
    case "tradeCount":
    case "sessionProfit":
    case "streak":
    case "priceChange":
      return typeof cond.cmp === "string" ? null : "Condition is missing a comparison.";

    case "and":
    case "or": {
      if (!Array.isArray(cond.terms)) return "and/or needs a list of terms.";
      for (const t of cond.terms) {
        const err = validateCondition(t, depth + 1);
        if (err) return err;
      }
      return null;
    }

    case "not":
      return validateCondition(cond.term, depth + 1);

    default:
      return `Unknown condition "${String(op)}".`;
  }
}
