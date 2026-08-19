"use client";

import type { Breakdown } from "@tradezaki/core";

/**
 * Where the money came from, or went.
 *
 * Diverging bars from a shared zero line rather than a pie. The question here is
 * "which of these made money and which lost it", and that is polarity — a pie
 * cannot show a negative slice at all, and with the two or three symbols a real
 * account actually trades it would be a two-slice pie, which is a stat tile
 * wearing a costume.
 *
 * Bar length is the only magnitude encoding; colour repeats the sign so it is
 * never the sole carrier, and every row is labelled with its own number.
 */
export default function BreakdownBars({
  rows,
  currency,
  emptyLabel = "Nothing to break down yet.",
  label,
}: {
  rows: Breakdown[];
  currency: string;
  emptyLabel?: string;
  /**
   * Turns a grouping key into something a person reads. Markets arrive as
   * Deriv's codes — R_10, RDBEAR — which mean nothing to anyone who has not
   * memorised them; the API knows them as "Volatility 10 Index" and
   * "Bear Market Index".
   */
  label?: (key: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="text-[12px] text-mist py-6 text-center">{emptyLabel}</p>;
  }

  // One scale for both directions, so a -5 bar is exactly as long as a +5 bar.
  const max = Math.max(...rows.map((r) => Math.abs(r.netProfit)), 0.01);

  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const up = r.netProfit >= 0;
        const width = (Math.abs(r.netProfit) / max) * 50;
        return (
          <li key={r.key} className="group">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="font-mono text-[11px] truncate">{label ? label(r.key) : r.key}</span>
              <span className="flex items-baseline gap-2 shrink-0">
                <span className="font-mono text-[10px] text-mist">
                  {r.trades} {r.trades === 1 ? "trade" : "trades"}
                  {r.winRate !== null ? ` · ${Math.round(r.winRate * 100)}%` : ""}
                </span>
                <span
                  className={`font-mono text-[11px] ${up ? "text-signal" : "text-danger"}`}
                >
                  {up ? "+" : ""}
                  {r.netProfit.toFixed(2)}
                </span>
              </span>
            </div>

            <div className="relative h-2 rounded-full bg-line/40 overflow-hidden">
              {/* Zero sits in the middle; bars grow out from it in either
                  direction, which is what makes the sign readable at a glance. */}
              <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
              <div
                className={`absolute inset-y-0 rounded-full transition-all ${
                  up ? "bg-signal" : "bg-danger"
                }`}
                style={
                  up
                    ? { left: "50%", width: `${width}%` }
                    : { right: "50%", width: `${width}%` }
                }
              />
            </div>
          </li>
        );
      })}
      <li className="pt-1 font-mono text-[9px] text-mist">Net profit, {currency}</li>
    </ul>
  );
}
