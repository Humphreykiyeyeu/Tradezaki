"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "@tradezaki/core";
import { useDeriv } from "@/components/DerivProvider";

/**
 * The price chart traders expect: candles, timeframes, zoom and pan.
 *
 * The old one drew every tick it had into a fixed box. That is honest for a
 * tick contract and useless for everything else — you could not look back, could
 * not change the timeframe, and could not see a candle at all.
 *
 * The viewport is an index window over the data, not a pixel transform. Zoom
 * changes how many bars are shown, pan moves where the window starts, and the
 * price scale is recomputed from what is actually visible. That is why zooming
 * in makes small moves readable rather than just enlarging the same line — a
 * scaled bitmap would show the same flat trace, bigger.
 */

export interface TimeFrame {
  id: string;
  label: string;
  /** Seconds per bar. 0 means the raw tick stream. */
  granularity: number;
}

export const TIMEFRAMES: TimeFrame[] = [
  { id: "ticks", label: "Ticks", granularity: 0 },
  { id: "1m", label: "1m", granularity: 60 },
  { id: "5m", label: "5m", granularity: 300 },
  { id: "15m", label: "15m", granularity: 900 },
  { id: "1h", label: "1h", granularity: 3600 },
  { id: "4h", label: "4h", granularity: 14400 },
  { id: "1d", label: "1d", granularity: 86400 },
];

type ChartType = "candle" | "line" | "area";

/** One plotted item. A tick is a candle whose four prices are equal. */
interface Bar {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const MIN_VISIBLE = 15;
const MAX_VISIBLE = 600;

export default function TradingChart({
  symbolName,
  barrier,
  entries = [],
  bounds,
  height = 340,
}: {
  symbolName: string;
  barrier?: number | null;
  entries?: number[];
  bounds?: { high: number; low: number } | null;
  height?: number;
}) {
  const { symbol, ticks, fetchCandles, fetchTickHistory, subscribeCandles, connState } = useDeriv();

  const [tf, setTf] = useState<TimeFrame>(TIMEFRAMES[1]);
  const [type, setType] = useState<ChartType>("candle");
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);

  /** Bars visible, and how far back from the newest the window sits. */
  const [visible, setVisible] = useState(120);
  const [scrollBack, setScrollBack] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; from: number } | null>(null);

  // ---------------------------------------------------------------- history
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setScrollBack(0);

    (async () => {
      if (tf.granularity === 0) {
        const h = await fetchTickHistory(1000);
        if (!cancelled) {
          setBars(h.map((t) => ({ epoch: t.epoch, open: t.quote, high: t.quote, low: t.quote, close: t.quote })));
          setLoading(false);
        }
        return;
      }
      const c = await fetchCandles(tf.granularity, 500);
      if (!cancelled) {
        setBars(c);
        setLoading(false);
      }
    })().catch(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [symbol, tf.granularity, fetchCandles, fetchTickHistory, connState]);

  // ------------------------------------------------------------------- live
  useEffect(() => {
    if (tf.granularity === 0) return;
    return subscribeCandles(tf.granularity, (c) => {
      setBars((prev) => {
        if (prev.length === 0) return [c];
        const last = prev[prev.length - 1];
        // Replace-or-append by epoch: Deriv resends the forming bar on every
        // tick, so pushing would add the same candle hundreds of times.
        if (c.epoch === last.epoch) return [...prev.slice(0, -1), c];
        if (c.epoch > last.epoch) return [...prev, c];
        return prev;
      });
    });
  }, [tf.granularity, symbol, subscribeCandles]);

  // The tick view rides the provider's existing stream rather than opening a
  // second one for the same data.
  useEffect(() => {
    if (tf.granularity !== 0 || ticks.length === 0) return;
    const latest = ticks[ticks.length - 1];
    setBars((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].epoch >= latest.epoch) return prev;
      return [
        ...prev.slice(-1999),
        { epoch: latest.epoch, open: latest.quote, high: latest.quote, low: latest.quote, close: latest.quote },
      ];
    });
  }, [ticks, tf.granularity]);

  // --------------------------------------------------------------- viewport
  const window_ = useMemo(() => {
    const end = Math.max(0, bars.length - scrollBack);
    const start = Math.max(0, end - visible);
    return { start, end, slice: bars.slice(start, end) };
  }, [bars, visible, scrollBack]);

  const live = scrollBack === 0;

  const zoom = useCallback((factor: number) => {
    setVisible((v) => Math.round(Math.min(MAX_VISIBLE, Math.max(MIN_VISIBLE, v * factor))));
  }, []);

  const panBy = useCallback(
    (bars_: number) => {
      setScrollBack((s) => Math.max(0, Math.min(bars.length - MIN_VISIBLE, s + bars_)));
    },
    [bars.length]
  );

  const onWheel = (e: React.WheelEvent) => {
    // Trackpads send horizontal deltas for a two-finger swipe; treat that as
    // panning and vertical as zooming, which is what every charting tool does.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) panBy(Math.sign(e.deltaX) * 3);
    else zoom(e.deltaY > 0 ? 1.12 : 0.89);
  };

  const startDrag = (x: number) => {
    drag.current = { x, from: scrollBack };
  };
  const moveDrag = (x: number) => {
    if (!drag.current || !wrapRef.current) return;
    const w = wrapRef.current.clientWidth || 1;
    const perBar = w / Math.max(window_.slice.length, 1);
    const shifted = Math.round((x - drag.current.x) / perBar);
    setScrollBack(Math.max(0, Math.min(bars.length - MIN_VISIBLE, drag.current.from + shifted)));
  };
  const endDrag = () => {
    drag.current = null;
  };

  // ----------------------------------------------------------------- render
  const W = 1000;
  const H = height;
  const PAD = { top: 12, right: 62, bottom: 22, left: 8 };

  const geom = useMemo(() => {
    const s = window_.slice;
    if (s.length === 0) return null;

    let lo = Math.min(...s.map((b) => b.low));
    let hi = Math.max(...s.map((b) => b.high));
    // Overlays must not fall outside the plot, or a barrier line silently
    // disappears exactly when the price approaches it.
    for (const v of [barrier, bounds?.high, bounds?.low, ...entries]) {
      if (typeof v === "number" && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    const span = hi - lo || Math.abs(hi) * 0.001 || 1;
    const pad = span * 0.08;
    const yMin = lo - pad;
    const yMax = hi + pad;

    const plotW = W - PAD.left - PAD.right;
    const step = plotW / s.length;
    const x = (i: number) => PAD.left + i * step + step / 2;
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

    return { s, x, y, step, yMin, yMax };
  }, [window_.slice, barrier, bounds, entries, H, PAD.bottom, PAD.left, PAD.right, PAD.top]);

  const decimals = useMemo(() => {
    const sample = bars[bars.length - 1]?.close ?? 0;
    const str = String(sample);
    return str.includes(".") ? Math.min(str.split(".")[1].length, 5) : 2;
  }, [bars]);

  const active = hover !== null && geom ? geom.s[hover] : null;
  const lastBar = bars[bars.length - 1];

  return (
    <div className="select-none">
      {/* ---- controls ---- */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex rounded-lg border border-line overflow-hidden">
          {TIMEFRAMES.map((f) => (
            <button
              key={f.id}
              onClick={() => setTf(f)}
              className={`px-2 py-1 font-mono text-[11px] transition ${
                tf.id === f.id ? "bg-signal/15 text-signal" : "text-mist hover:text-[#E7ECE9]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-line overflow-hidden">
          {(["candle", "line", "area"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              title={t === "candle" ? "Candlesticks" : t === "line" ? "Line" : "Area"}
              className={`px-2 py-1 font-mono text-[11px] capitalize transition ${
                type === t ? "bg-signal/15 text-signal" : "text-mist hover:text-[#E7ECE9]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-line overflow-hidden">
          <button onClick={() => zoom(0.8)} title="Zoom in" className="px-2.5 py-1 text-mist hover:text-signal transition">+</button>
          <button onClick={() => zoom(1.25)} title="Zoom out" className="px-2.5 py-1 text-mist hover:text-signal transition">−</button>
        </div>

        {!live && (
          <button
            onClick={() => setScrollBack(0)}
            className="px-2.5 py-1 rounded-lg border border-signal/40 text-signal text-[11px] transition hover:bg-signal/10"
          >
            Jump to now →
          </button>
        )}

        <span className="ml-auto font-mono text-[10px] text-mist">
          {loading ? "loading…" : `${window_.slice.length} of ${bars.length} bars`}
        </span>
      </div>

      {/* ---- plot ---- */}
      <div
        ref={wrapRef}
        className="relative rounded-lg border border-line bg-ink/40 overflow-hidden cursor-crosshair touch-pan-y"
        style={{ height: H }}
        onWheel={onWheel}
        onMouseDown={(e) => startDrag(e.clientX)}
        onMouseMove={(e) => {
          moveDrag(e.clientX);
          if (!geom || drag.current) return;
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          const i = Math.floor((px - PAD.left) / geom.step);
          setHover(i >= 0 && i < geom.s.length ? i : null);
        }}
        onMouseUp={endDrag}
        onMouseLeave={() => {
          endDrag();
          setHover(null);
        }}
        onTouchStart={(e) => startDrag(e.touches[0].clientX)}
        onTouchMove={(e) => moveDrag(e.touches[0].clientX)}
        onTouchEnd={endDrag}
      >
        {!geom ? (
          <div className="h-full grid place-items-center text-[12px] text-mist">
            {loading ? "Loading chart…" : "No data for this market yet."}
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none"
               role="img" aria-label={`${symbolName} ${tf.label} ${type} chart`}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3ED9A0" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#3ED9A0" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* price grid — recessive, five steps */}
            {Array.from({ length: 5 }, (_, k) => {
              const v = geom.yMin + ((geom.yMax - geom.yMin) * k) / 4;
              return (
                <g key={k}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={geom.y(v)} y2={geom.y(v)}
                        stroke="#1F2822" strokeWidth="1" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />
                  <text x={W - PAD.right + 6} y={geom.y(v) + 3} className="fill-mist"
                        style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
                    {v.toFixed(decimals)}
                  </text>
                </g>
              );
            })}

            {/* overlays: barrier, accumulator range, entry prices */}
            {bounds && (
              <rect x={PAD.left} y={geom.y(bounds.high)} width={W - PAD.left - PAD.right}
                    height={Math.max(geom.y(bounds.low) - geom.y(bounds.high), 1)}
                    fill="#3ED9A0" fillOpacity="0.07" stroke="#3ED9A0" strokeOpacity="0.3"
                    strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            )}
            {typeof barrier === "number" && Number.isFinite(barrier) && (
              <line x1={PAD.left} x2={W - PAD.right} y1={geom.y(barrier)} y2={geom.y(barrier)}
                    stroke="#E8A33D" strokeWidth="1.5" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            )}
            {entries.map((e, i) => (
              <line key={i} x1={PAD.left} x2={W - PAD.right} y1={geom.y(e)} y2={geom.y(e)}
                    stroke="#8A9A93" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            ))}

            {/* the series */}
            {type === "candle" ? (
              geom.s.map((b, i) => {
                const up = b.close >= b.open;
                const colour = up ? "#3ED9A0" : "#E2604F";
                const bodyTop = geom.y(Math.max(b.open, b.close));
                const bodyBottom = geom.y(Math.min(b.open, b.close));
                // A doji would otherwise vanish; 1px keeps every bar visible.
                const bodyH = Math.max(bodyBottom - bodyTop, 1);
                const w = Math.max(geom.step * 0.62, 1);
                return (
                  <g key={b.epoch}>
                    <line x1={geom.x(i)} x2={geom.x(i)} y1={geom.y(b.high)} y2={geom.y(b.low)}
                          stroke={colour} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <rect x={geom.x(i) - w / 2} y={bodyTop} width={w} height={bodyH} fill={colour} />
                  </g>
                );
              })
            ) : (
              <>
                {type === "area" && (
                  <path
                    d={`${geom.s.map((b, i) => `${i === 0 ? "M" : "L"}${geom.x(i)},${geom.y(b.close)}`).join(" ")} L${geom.x(geom.s.length - 1)},${H - PAD.bottom} L${geom.x(0)},${H - PAD.bottom} Z`}
                    fill="url(#areaFill)"
                  />
                )}
                <path
                  d={geom.s.map((b, i) => `${i === 0 ? "M" : "L"}${geom.x(i)},${geom.y(b.close)}`).join(" ")}
                  fill="none" stroke="#3ED9A0" strokeWidth="2" strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}

            {/* last price, always readable even when scrolled back */}
            {live && lastBar && (
              <g>
                <line x1={PAD.left} x2={W - PAD.right} y1={geom.y(lastBar.close)} y2={geom.y(lastBar.close)}
                      stroke="#E7ECE9" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 3"
                      vectorEffect="non-scaling-stroke" />
                <rect x={W - PAD.right + 2} y={geom.y(lastBar.close) - 8} width={PAD.right - 4} height={16} rx="3" fill="#3ED9A0" />
                <text x={W - PAD.right + 6} y={geom.y(lastBar.close) + 3} className="fill-ink"
                      style={{ fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                  {lastBar.close.toFixed(decimals)}
                </text>
              </g>
            )}

            {active && (
              <line x1={geom.x(hover!)} x2={geom.x(hover!)} y1={PAD.top} y2={H - PAD.bottom}
                    stroke="#8A9A93" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        )}

        {active && (
          <div className="pointer-events-none absolute top-2 left-2 px-2.5 py-1.5 rounded-md border border-line bg-ink/95 backdrop-blur font-mono text-[10px] leading-relaxed shadow-xl">
            <div className="text-mist">
              {new Date(active.epoch * 1000).toLocaleString(undefined, {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </div>
            {tf.granularity === 0 ? (
              <div>{active.close.toFixed(decimals)}</div>
            ) : (
              <div className="grid grid-cols-2 gap-x-3">
                <span className="text-mist">O</span><span>{active.open.toFixed(decimals)}</span>
                <span className="text-mist">H</span><span>{active.high.toFixed(decimals)}</span>
                <span className="text-mist">L</span><span>{active.low.toFixed(decimals)}</span>
                <span className="text-mist">C</span>
                <span className={active.close >= active.open ? "text-signal" : "text-danger"}>
                  {active.close.toFixed(decimals)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="font-mono text-[9px] text-mist mt-1.5">
        Drag to pan · scroll to zoom{!live ? " · viewing history" : ""}
      </p>
    </div>
  );
}
