"use client";

import { useMemo, useRef, useState } from "react";

export interface Tick {
  quote: number;
  epoch: number;
}

interface Props {
  ticks: Tick[];
  pipSize: number;
  /** Absolute price of the barrier, drawn as a reference line when set. */
  barrier?: number | null;
  symbolName: string;
}

const W = 720;
const H = 240;
const PAD = { top: 16, right: 64, bottom: 22, left: 8 };

/**
 * Live tick line. One series, so no legend — the heading names it. The price
 * line is the only coloured mark; the barrier is a neutral dashed reference,
 * deliberately not a second "series" colour.
 */
export default function TickChart({ ticks, pipSize, barrier, symbolName }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (ticks.length < 2) return null;

    const quotes = ticks.map((t) => t.quote);
    const values = barrier != null ? [...quotes, barrier] : quotes;
    let min = Math.min(...values);
    let max = Math.max(...values);
    // Flat series would divide by zero; give it a nominal band.
    if (max - min < Number.EPSILON) {
      const nudge = Math.max(Math.abs(max) * 0.0005, 10 ** -pipSize);
      min -= nudge;
      max += nudge;
    }
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / (ticks.length - 1)) * plotW;
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * plotH;

    return {
      x,
      y,
      min,
      max,
      path: ticks.map((t, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(t.quote)}`).join(" "),
      area:
        `M${x(0)} ${PAD.top + plotH} ` +
        ticks.map((t, i) => `L${x(i)} ${y(t.quote)}`).join(" ") +
        ` L${x(ticks.length - 1)} ${PAD.top + plotH} Z`,
    };
  }, [ticks, barrier, pipSize]);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!geometry || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const i = Math.round(ratio * (ticks.length - 1));
    setHoverIndex(Math.min(Math.max(i, 0), ticks.length - 1));
  }

  if (!geometry) {
    return (
      <div className="h-[240px] flex items-center justify-center text-mist font-mono text-xs">
        Waiting for ticks…
      </div>
    );
  }

  const last = ticks[ticks.length - 1];
  const first = ticks[0];
  const rising = last.quote >= first.quote;
  const hovered = hoverIndex != null ? ticks[hoverIndex] : null;
  const fmt = (v: number) => v.toFixed(pipSize);

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        Live price ticks for {symbolName}. Latest {fmt(last.quote)}.
      </figcaption>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        role="img"
        aria-label={`Price chart for ${symbolName}, latest ${fmt(last.quote)}`}
      >
        <defs>
          <linearGradient id="tickFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3ED9A0" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#3ED9A0" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive gridlines — three is enough to read level without noise. */}
        {[0, 0.5, 1].map((f) => {
          const v = geometry.min + f * (geometry.max - geometry.min);
          return (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={geometry.y(v)}
                y2={geometry.y(v)}
                stroke="#1F2822"
                strokeWidth="1"
              />
              <text
                x={W - PAD.right + 8}
                y={geometry.y(v) + 4}
                fill="#8A9A93"
                fontSize="11"
                fontFamily="var(--font-mono)"
              >
                {fmt(v)}
              </text>
            </g>
          );
        })}

        <path d={geometry.area} fill="url(#tickFill)" />
        <path
          d={geometry.path}
          fill="none"
          stroke="#3ED9A0"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {barrier != null && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geometry.y(barrier)}
              y2={geometry.y(barrier)}
              stroke="#8A9A93"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
            <text
              x={PAD.left + 6}
              y={geometry.y(barrier) - 6}
              fill="#8A9A93"
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              barrier {fmt(barrier)}
            </text>
          </g>
        )}

        {/* Latest price: the one direct label worth having. */}
        <circle cx={geometry.x(ticks.length - 1)} cy={geometry.y(last.quote)} r="4" fill="#3ED9A0" />
        <circle
          cx={geometry.x(ticks.length - 1)}
          cy={geometry.y(last.quote)}
          r="8"
          fill="#3ED9A0"
          opacity="0.25"
        />

        {hovered && hoverIndex != null && (
          <g pointerEvents="none">
            <line
              x1={geometry.x(hoverIndex)}
              x2={geometry.x(hoverIndex)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="#8A9A93"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={geometry.x(hoverIndex)}
              cy={geometry.y(hovered.quote)}
              r="5"
              fill="#3ED9A0"
              stroke="#121714"
              strokeWidth="2"
            />
            <g
              transform={`translate(${Math.min(
                geometry.x(hoverIndex) + 10,
                W - PAD.right - 96
              )}, ${Math.max(geometry.y(hovered.quote) - 34, PAD.top)})`}
            >
              <rect width="96" height="30" rx="4" fill="#0B0F0E" stroke="#1F2822" />
              <text x="8" y="19" fill="#E7ECE9" fontSize="12" fontFamily="var(--font-mono)">
                {fmt(hovered.quote)}
              </text>
            </g>
          </g>
        )}
      </svg>

      <div className="flex items-baseline justify-between mt-2">
        <span className="font-mono text-xs text-mist">
          last {ticks.length} ticks · {symbolName}
        </span>
        <span
          className={`font-mono text-sm ${rising ? "text-signal" : "text-danger"}`}
          aria-label={`Latest price ${fmt(last.quote)}, ${rising ? "up" : "down"} over this window`}
        >
          {fmt(last.quote)} {rising ? "▲" : "▼"}
        </span>
      </div>
    </figure>
  );
}
