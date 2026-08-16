"use client";

import type { AccumulatorDetails } from "@tradezaki/core";

/**
 * How long recent Accumulators lasted, newest on the right.
 *
 * This is the Accumulator's version of the last-digit strip. The only thing a
 * trader is really asking is "how many ticks does this market usually stay
 * inside the range", and Deriv answers it directly with ticks_stayed_in — a run
 * of 1 and a run of 90 are the difference between a growth rate that pays and
 * one that never gets going.
 *
 * Bar height encodes the run length so the shape of the recent history is
 * readable before any number is; the numbers are printed underneath because
 * "about this tall" is not good enough to size a stake on.
 */
export default function AccumulatorStrip({ details }: { details: AccumulatorDetails }) {
  const runs = details.ticksStayedIn.slice(0, 24);

  if (runs.length === 0) {
    return (
      <div className="px-4 pb-4">
        <p className="font-mono text-[9px] uppercase tracking-widest text-mist mb-2">
          Ticks stayed in
        </p>
        <p className="text-[12px] text-mist">No recent history for this market yet.</p>
      </div>
    );
  }

  // Newest last reads as time moving left to right, matching the chart above it.
  const ordered = [...runs].reverse();
  const max = Math.max(...ordered, 1);
  const mean = ordered.reduce((s, n) => s + n, 0) / ordered.length;

  return (
    <div className="px-4 pb-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="font-mono text-[9px] uppercase tracking-widest text-mist">
          Ticks stayed in
        </p>
        <p className="font-mono text-[9px] text-mist">
          avg {mean.toFixed(0)}
          {details.maximumTicks ? ` · closes at ${details.maximumTicks}` : ""}
        </p>
      </div>

      <div className="flex items-end gap-[3px] h-14">
        {ordered.map((n, i) => {
          const latest = i === ordered.length - 1;
          return (
            <div
              key={i}
              className="group relative flex-1 min-w-0 flex flex-col justify-end h-full"
              title={`${n} ticks`}
            >
              <div
                className={`w-full rounded-[3px] transition-all ${
                  latest ? "bg-signal" : n >= mean ? "bg-signal/40" : "bg-line"
                }`}
                style={{ height: `${Math.max((n / max) * 100, 6)}%` }}
              />
              <span
                className={`mt-1 text-center font-mono text-[9px] tabular-nums ${
                  latest ? "text-signal" : "text-mist"
                }`}
              >
                {n}
              </span>
            </div>
          );
        })}
      </div>

      {(details.lowBarrier !== null || details.barrierPercentage) && (
        <p className="font-mono text-[9px] text-mist mt-2">
          {details.lowBarrier !== null && details.highBarrier !== null
            ? `range ${details.lowBarrier} – ${details.highBarrier}`
            : ""}
          {details.barrierPercentage ? ` · ±${details.barrierPercentage} of spot` : ""}
        </p>
      )}
    </div>
  );
}
