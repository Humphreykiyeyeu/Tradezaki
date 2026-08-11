import { lastDigitOf } from "./conditions";
import type { TickPoint } from "./types";

/**
 * Settles a contract from tick data, for dry runs.
 *
 * A paper trade is only worth anything if the outcome is decided the same way
 * Deriv would decide it. For tick-duration contracts on a known tick stream,
 * most families are unambiguous: the exit tick is the Nth tick after entry, and
 * the rule is public.
 *
 * Where the outcome is NOT knowable from ticks alone — path-dependent barriers,
 * Accumulators, anything priced on Deriv's own model — this returns
 * `unsupported` rather than guessing. A dry run that quietly invents wins is
 * worse than no dry run at all, because it produces confidence instead of
 * information.
 */

export type SimOutcome =
  | { kind: "won"; profit: number; exitSpot: number }
  | { kind: "lost"; profit: number; exitSpot: number }
  | { kind: "unsupported"; reason: string };

export interface SimulateInput {
  contractType: string;
  /** Spot at purchase. */
  entrySpot: number;
  /** Ticks strictly AFTER entry, oldest first. */
  after: TickPoint[];
  /** Contract length, in ticks. */
  durationTicks: number;
  /** Digit prediction / barrier, as sent to Deriv. */
  barrier?: string;
  stake: number;
  /** Payout from the real proposal — this is why dry runs need a live quote. */
  payout: number;
  decimals: number;
}

/** Contract families whose result a tick stream determines exactly. */
const SUPPORTED = new Set([
  "CALL",
  "PUT",
  "CALLE",
  "PUTE",
  "DIGITEVEN",
  "DIGITODD",
  "DIGITOVER",
  "DIGITUNDER",
  "DIGITMATCH",
  "DIGITDIFF",
  "ASIANU",
  "ASIAND",
  "ONETOUCH",
  "NOTOUCH",
  "RUNHIGH",
  "RUNLOW",
  "TICKHIGH",
  "TICKLOW",
]);

export function canSimulate(contractType: string): boolean {
  return SUPPORTED.has(contractType);
}

export function simulateSettlement(input: SimulateInput): SimOutcome {
  const {
    contractType: type,
    entrySpot,
    after,
    durationTicks,
    barrier,
    stake,
    payout,
    decimals,
  } = input;

  if (!SUPPORTED.has(type)) {
    return {
      kind: "unsupported",
      reason: `${type} can't be settled from ticks alone — run it on demo instead.`,
    };
  }
  if (after.length < durationTicks) {
    return { kind: "unsupported", reason: "Not enough ticks yet." };
  }

  const window = after.slice(0, durationTicks);
  const exit = window[window.length - 1].quote;
  const digit = lastDigitOf(exit, decimals);
  const barrierNum = barrier !== undefined ? Number(barrier) : NaN;

  let won: boolean;

  switch (type) {
    case "CALL":
      won = exit > entrySpot;
      break;
    case "PUT":
      won = exit < entrySpot;
      break;
    // The "equals" variants pay out on an exact tie, which is the whole point
    // of them and the easiest thing to get wrong.
    case "CALLE":
      won = exit >= entrySpot;
      break;
    case "PUTE":
      won = exit <= entrySpot;
      break;

    case "DIGITEVEN":
      won = digit % 2 === 0;
      break;
    case "DIGITODD":
      won = digit % 2 === 1;
      break;
    case "DIGITOVER":
      won = digit > barrierNum;
      break;
    case "DIGITUNDER":
      won = digit < barrierNum;
      break;
    case "DIGITMATCH":
      won = digit === barrierNum;
      break;
    case "DIGITDIFF":
      won = digit !== barrierNum;
      break;

    case "ASIANU":
    case "ASIAND": {
      const avg = window.reduce((s, t) => s + t.quote, 0) / window.length;
      won = type === "ASIANU" ? exit > avg : exit < avg;
      break;
    }

    // Path-dependent: any tick in the window can decide it, not just the last.
    case "ONETOUCH":
    case "NOTOUCH": {
      if (!Number.isFinite(barrierNum)) {
        return { kind: "unsupported", reason: "Touch contracts need a barrier." };
      }
      // Deriv sends these as relative offsets like "+500".
      const level = entrySpot + barrierNum;
      const touched = window.some((t) =>
        barrierNum >= 0 ? t.quote >= level : t.quote <= level
      );
      won = type === "ONETOUCH" ? touched : !touched;
      break;
    }

    case "RUNHIGH":
    case "RUNLOW": {
      let all = true;
      let prev = entrySpot;
      for (const t of window) {
        const ok = type === "RUNHIGH" ? t.quote > prev : t.quote < prev;
        if (!ok) {
          all = false;
          break;
        }
        prev = t.quote;
      }
      won = all;
      break;
    }

    case "TICKHIGH":
    case "TICKLOW": {
      // Without a selected tick this is unanswerable; assume the last, which is
      // the default the ticket offers.
      const quotes = window.map((t) => t.quote);
      const target = quotes[quotes.length - 1];
      won =
        type === "TICKHIGH"
          ? target === Math.max(...quotes)
          : target === Math.min(...quotes);
      break;
    }

    default:
      return { kind: "unsupported", reason: `Unhandled contract type ${type}.` };
  }

  // Deriv pays the full payout on a win; a loss forfeits the stake.
  const profit = won ? round(payout - stake) : -stake;
  return { kind: won ? "won" : "lost", profit, exitSpot: exit };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
