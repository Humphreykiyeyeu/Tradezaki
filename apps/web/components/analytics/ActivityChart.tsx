"use client";

import { useState } from "react";
import type { ActivityBucket } from "@tradezaki/core";

/**
 * Wins and losses over time, stacked per bucket.
 *
 * Two classes, so a legend is required — colour alone must never be the only
 * way to tell them apart. A 2px gap separates the two segments so they read as
 * distinct blocks rather than one bar with a colour change in it.
 *
 * Empty buckets are drawn as empty, not skipped: a quiet stretch is information,
 * and closing the gaps would draw continuous activity that never happened.
 */
export default function ActivityChart({
  buckets,
  format,
  height = 120,
}: {
  buckets: ActivityBucket[];
  format: (t: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(...buckets.map((b) => b.wins + b.losses), 1);
  const total = buckets.reduce((s, b) => s + b.wins + b.losses, 0);

  if (total === 0) {
    return (
      <div
        style={{ height }}
        className="grid place-items-center text-[12px] text-mist border border-dashed border-line rounded-lg"
      >
        No trades in this period.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-2.5">
        <Legend swatch="bg-signal" label="Won" />
        <Legend swatch="bg-danger" label="Lost" />
      </div>

      <div className="relative flex items-end gap-[3px]" style={{ height }}>
        {buckets.map((b, i) => {
          const n = b.wins + b.losses;
          const h = (n / max) * 100;
          const winShare = n > 0 ? (b.wins / n) * 100 : 0;
          return (
            <div
              key={b.t}
              className="relative flex-1 min-w-0 h-full flex items-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Full-height hit target: the bar itself can be 2px tall. */}
              <div className="absolute inset-0" />
              <div
                className="relative w-full rounded-[3px] overflow-hidden flex flex-col justify-end transition-all"
                style={{ height: `${Math.max(h, n > 0 ? 4 : 0)}%` }}
              >
                {b.losses > 0 && (
                  <div
                    className="w-full bg-danger"
                    style={{ height: `${100 - winShare}%` }}
                  />
                )}
                {b.wins > 0 && (
                  <div
                    className="w-full bg-signal"
                    style={{
                      height: `${winShare}%`,
                      // The 2px surface gap between stacked segments.
                      marginBottom: b.losses > 0 ? 2 : 0,
                    }}
                  />
                )}
              </div>

              {hover === i && n > 0 && (
                <div
                  className={`pointer-events-none absolute bottom-full mb-1.5 z-10 px-2 py-1 rounded-md border border-line bg-ink/95 backdrop-blur font-mono text-[10px] whitespace-nowrap shadow-xl ${
                    i > buckets.length * 0.7 ? "right-0" : "left-0"
                  }`}
                >
                  <div className="text-mist">{format(b.t)}</div>
                  <div>
                    <span className="text-signal">{b.wins}W</span>
                    {" · "}
                    <span className="text-danger">{b.losses}L</span>
                  </div>
                  <div className={b.netProfit >= 0 ? "text-signal" : "text-danger"}>
                    {b.netProfit >= 0 ? "+" : ""}
                    {b.netProfit.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between font-mono text-[9px] text-mist mt-1.5">
        <span>{format(buckets[0].t)}</span>
        <span>{format(buckets[buckets.length - 1].t)}</span>
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-mist">
      <span className={`w-2.5 h-2.5 rounded-sm ${swatch}`} />
      {label}
    </span>
  );
}
