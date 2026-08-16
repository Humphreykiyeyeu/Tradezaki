"use client";

import { useMemo, useState } from "react";
import type { CurvePoint } from "@tradezaki/core";

/**
 * Running profit, one step per settled trade.
 *
 * Plotted against trade number, not wall-clock time. Trading here happens in
 * bursts with long idle gaps between them, and a time axis draws that as a flat
 * line with a cliff in it — the shape of the run, which is the whole point,
 * disappears. Trade number spaces every decision equally.
 *
 * Single series, so no legend: the title names it. Colour carries polarity
 * (ending up or down) and never carries identity on its own — the value is
 * always written out beside it.
 */
export default function EquityChart({
  points,
  currency,
  height = 200,
}: {
  points: CurvePoint[];
  currency: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = height;
  const PAD = { top: 14, right: 14, bottom: 20, left: 46 };

  const geom = useMemo(() => {
    if (points.length === 0) return null;

    const values = points.map((p) => p.cumulative);
    // Zero is always in view. A profit curve that never touches its own
    // baseline invites the reader to mistake "less profit" for "a loss".
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const span = hi - lo || 1;
    const pad = span * 0.12;

    const yMin = lo - pad;
    const yMax = hi + pad;

    const x = (i: number) =>
      PAD.left +
      (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - PAD.left - PAD.right));
    const y = (v: number) =>
      PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.cumulative)}`).join(" ");
    const area =
      points.length > 1
        ? `${line} L${x(points.length - 1)},${y(yMin)} L${x(0)},${y(yMin)} Z`
        : "";

    // Ticks at zero and the two extremes — enough to read the scale, few enough
    // to stay out of the way.
    const ticks = [...new Set([yMin + pad, 0, yMax - pad])].sort((a, b) => a - b);

    return { x, y, line, area, yMin, yMax, ticks };
  }, [points, H, PAD.left, PAD.right, PAD.top, PAD.bottom, W]);

  if (!geom || points.length === 0) {
    return (
      <div
        style={{ height }}
        className="grid place-items-center text-[12px] text-mist border border-dashed border-line rounded-lg"
      >
        Nothing settled in this period yet.
      </div>
    );
  }

  const last = points[points.length - 1].cumulative;
  const up = last >= 0;
  const stroke = up ? "#3ED9A0" : "#E2604F";
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Running profit over ${points.length} settled trades, ending at ${last.toFixed(2)} ${currency}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          const ratio = (px - PAD.left) / (W - PAD.left - PAD.right);
          const i = Math.round(ratio * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive grid. Present enough to measure against, quiet enough to
            never compete with the data. */}
        {geom.ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geom.y(v)}
              y2={geom.y(v)}
              stroke={v === 0 ? "#2A362F" : "#1F2822"}
              strokeWidth={v === 0 ? 1.5 : 1}
              strokeDasharray={v === 0 ? "" : "3 5"}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD.left - 8}
              y={geom.y(v) + 3}
              textAnchor="end"
              className="fill-mist"
              style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}
            >
              {v > 0 ? "+" : ""}
              {v.toFixed(1)}
            </text>
          </g>
        ))}

        {points.length > 1 && <path d={geom.area} fill="url(#equityFill)" />}
        <path
          d={geom.line}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {active && (
          <g>
            <line
              x1={geom.x(hover!)}
              x2={geom.x(hover!)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="#8A9A93"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            {/* 2px surface ring keeps the marker readable wherever it lands. */}
            <circle
              cx={geom.x(hover!)}
              cy={geom.y(active.cumulative)}
              r="5"
              fill={stroke}
              stroke="#121714"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-1 px-2.5 py-1.5 rounded-md border border-line bg-ink/95 backdrop-blur font-mono text-[10px] leading-relaxed shadow-xl"
          style={{
            left: `${(geom.x(hover!) / W) * 100}%`,
            transform:
              geom.x(hover!) > W * 0.7 ? "translateX(-100%) translateX(-8px)" : "translateX(8px)",
          }}
        >
          <div className="text-mist">Trade #{active.n}</div>
          <div className={active.profit >= 0 ? "text-signal" : "text-danger"}>
            {active.profit >= 0 ? "+" : ""}
            {active.profit.toFixed(2)} {currency}
          </div>
          <div className="text-[#E7ECE9]">
            running {active.cumulative >= 0 ? "+" : ""}
            {active.cumulative.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}
