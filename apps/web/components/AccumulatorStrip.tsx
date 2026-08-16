"use client";

import type { AccumulatorState } from "@tradezaki/core";

/**
 * How long recent Accumulators lasted, newest on the right, with the run in
 * progress counting up at the end.
 *
 * This is the Accumulator's version of the last-digit strip. The only thing a
 * trader is really asking is "how many ticks does this market usually stay
 * inside the range", and Deriv answers it directly — a run of 1 and a run of 90
 * are the difference between a growth rate that pays and one that never gets
 * going.
 *
 * Bar height encodes run length so the shape of the recent history is readable
 * before any number is; the numbers are printed underneath because "about this
 * tall" is not good enough to size a stake on. The live run shares the same
 * scale as the finished ones, so a record-breaking run visibly towers instead
 * of being clipped to the same height.
 */
export default function AccumulatorStrip({ state }: { state: AccumulatorState }) {
  const { runs, currentRun } = state;
  const recent = runs.slice(0, 20);
  const live = typeof currentRun === "number";

  if (recent.length === 0 && !live) {
    return (
      <div className="px-4 pb-4">
        <p className="font-mono text-[9px] uppercase tracking-widest text-mist mb-2">
          Ticks stayed in
        </p>
        <p className="text-[12px] text-mist">Waiting for this market&apos;s history…</p>
      </div>
    );
  }

  // Newest last reads as time moving left to right, matching the chart above.
  const ordered = [...recent].reverse();
  const mean = ordered.length > 0 ? ordered.reduce((s, n) => s + n, 0) / ordered.length : 0;
  const max = Math.max(...ordered, currentRun ?? 0, 1);

  return (
    <div className="px-4 pb-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="font-mono text-[9px] uppercase tracking-widest text-mist">
          Ticks stayed in
        </p>
        <p className="font-mono text-[9px] text-mist">
          {live && (
            <span className="text-alert">
              now {currentRun} ·{" "}
            </span>
          )}
          {ordered.length > 0 ? `avg ${mean.toFixed(0)}` : ""}
          {state.maximumTicks ? ` · closes at ${state.maximumTicks}` : ""}
        </p>
      </div>

      <div className="flex items-end gap-[3px] h-16">
        {ordered.map((n, i) => (
          <div
            key={`${i}-${n}`}
            className="group relative flex-1 min-w-0 flex flex-col justify-end h-full"
            title={`${n} ticks`}
          >
            <div
              className={`w-full rounded-[3px] transition-all ${
                n >= mean ? "bg-signal/50" : "bg-line"
              }`}
              style={{ height: `${Math.max((n / max) * 100, 6)}%` }}
            />
            <span className="mt-1 text-center font-mono text-[9px] tabular-nums text-mist">
              {n}
            </span>
          </div>
        ))}

        {/* The run in flight. Amber and divided off so it never reads as one of
            the finished runs — it has not finished, and its number is still
            moving. */}
        {live && (
          <div
            className={`flex-1 min-w-0 flex flex-col justify-end h-full ${
              ordered.length > 0 ? "ml-1.5 border-l border-line pl-1.5" : ""
            }`}
            title={`${currentRun} ticks and counting`}
          >
            <div
              className="w-full rounded-[3px] bg-alert transition-all"
              style={{ height: `${Math.max((currentRun! / max) * 100, 6)}%` }}
            />
            <span className="mt-1 text-center font-mono text-[9px] tabular-nums text-alert font-bold">
              {currentRun}
            </span>
          </div>
        )}
      </div>

      {(state.lowBarrier !== null || state.barrierPercentage) && (
        <p className="font-mono text-[9px] text-mist mt-2">
          {state.lowBarrier !== null && state.highBarrier !== null
            ? `range ${state.lowBarrier} – ${state.highBarrier}`
            : ""}
          {state.barrierPercentage ? ` · ±${state.barrierPercentage} of spot` : ""}
        </p>
      )}
    </div>
  );
}
