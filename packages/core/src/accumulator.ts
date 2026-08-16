import type { AccumulatorDetails } from "./types";

/**
 * Folds Deriv's Accumulator proposal stream into something displayable.
 *
 * The stream is not what it looks like. The first message carries the full
 * history — a hundred completed runs, how many ticks each one stayed inside the
 * range. Every message after it carries an array of length one, and that single
 * number is not history at all: it is the run in progress, counting up on each
 * tick, dropping back to 0 the moment the price leaves the range.
 *
 * Treating every message the same way replaces the history with one live number
 * and the chart collapses to a single counting bar. Treating them differently is
 * the whole job of this reducer.
 */

export interface AccumulatorState {
  /** Completed runs, newest first, exactly as Deriv orders them. */
  runs: number[];
  /** Ticks the price has stayed inside the range so far, or null before it is known. */
  currentRun: number | null;
  highBarrier: number | null;
  lowBarrier: number | null;
  maximumTicks: number | null;
  maximumPayout: number | null;
  minimumStake: number | null;
  maximumStake: number | null;
  barrierPercentage: string | null;
}

/** Deriv sends a hundred; more than that is never displayed and only grows memory. */
const MAX_RUNS = 100;

export function accumulatorReducer(
  prev: AccumulatorState | null,
  update: AccumulatorDetails
): AccumulatorState {
  const incoming = update.ticksStayedIn;

  let runs = prev?.runs ?? [];
  let currentRun = prev?.currentRun ?? null;

  if (incoming.length > 1) {
    // A full snapshot. Arrives first, and again whenever the subscription is
    // rebuilt after a reconnect — so it replaces rather than merges.
    runs = incoming.slice(0, MAX_RUNS);
    currentRun = null;
  } else if (incoming.length === 1) {
    const value = incoming[0];

    // A drop means the previous run ended: the price left the range and the
    // counter restarted. Whatever it had reached is now a completed run, and
    // this is the only moment we are told so.
    if (currentRun !== null && value < currentRun) {
      runs = [currentRun, ...runs].slice(0, MAX_RUNS);
    }

    currentRun = value;
  }
  // An empty array leaves both alone — it carries no information either way.

  return {
    runs,
    currentRun,
    // Barriers always come from the newest message; they move on every tick.
    highBarrier: update.highBarrier,
    lowBarrier: update.lowBarrier,
    // These are only sent with the opening snapshot, so keep the last known
    // value rather than blanking the tick ceiling on the next update.
    maximumTicks: update.maximumTicks ?? prev?.maximumTicks ?? null,
    maximumPayout: update.maximumPayout ?? prev?.maximumPayout ?? null,
    minimumStake: update.minimumStake ?? prev?.minimumStake ?? null,
    maximumStake: update.maximumStake ?? prev?.maximumStake ?? null,
    barrierPercentage: update.barrierPercentage ?? prev?.barrierPercentage ?? null,
  };
}
