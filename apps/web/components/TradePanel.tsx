"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContractAvailability, DurationRange } from "@tradezaki/core";
import {
  CONTRACT_PAIRS,
  DURATION_UNIT_LABELS,
  type ContractPair,
} from "@/lib/contracts";

export interface TradeIntent {
  contractType: string;
  stake: number;
  /** Absent for no-expiry contracts (Accumulators, Multipliers). */
  duration?: number;
  durationUnit?: DurationRange["unit"];
  barrier?: string;
  barrier2?: string;
  selectedTick?: number;
  growthRate?: number;
  multiplier?: number;
}

interface Props {
  available: ContractAvailability[];
  currency: string;
  balance: number | null;
  disabled: boolean;
  busy: string | null;
  /** Current spot. Barriers are meaningless without it — see barrier defaults. */
  spot: number | null;
  /** Prices an intent without buying, so each side can show its real payout. */
  onQuote: (intent: TradeIntent) => Promise<{ payout: number } | { error: string }>;
  onTrade: (intent: TradeIntent) => void;
  onBarrierChange: (offset: string | null) => void;
}

export default function TradePanel({
  available,
  currency,
  balance,
  disabled,
  busy,
  spot,
  onQuote,
  onTrade,
  onBarrierChange,
}: Props) {
  // Only offer pairs Deriv actually lists for this symbol — otherwise the UI
  // advertises trades that will be rejected at proposal time.
  const pairs = useMemo(() => {
    const byType = new Set(available.map((a) => a.contractType));
    return CONTRACT_PAIRS.filter((p) => p.sides.every((s) => byType.has(s.type)));
  }, [available]);

  const [pairIndex, setPairIndex] = useState(0);
  const pair: ContractPair | undefined = pairs[pairIndex] ?? pairs[0];

  const spec = available.find((a) => a.contractType === pair?.sides[0].type);
  const durations = spec?.durations ?? [];

  const [stake, setStake] = useState(1);
  const [unit, setUnit] = useState<DurationRange["unit"]>("t");
  const [duration, setDuration] = useState(5);
  const [digit, setDigit] = useState(5);
  const [selectedTick, setSelectedTick] = useState(1);
  const [growthRate, setGrowthRate] = useState(0.03);
  const [multiplier, setMultiplier] = useState(100);
  const [offset, setOffset] = useState("");
  const [offset2, setOffset2] = useState("");
  const [touchedBarrier, setTouchedBarrier] = useState(false);

  // Barriers over 24h must be ABSOLUTE prices; shorter ones use a relative
  // offset. Deriv rejects the wrong form outright, and Stays/Ends In-Out are
  // daily-only, so they are always absolute.
  const absoluteBarrier = unit === "d";

  // Reset duration whenever the contract changes — its limits differ, and a
  // stale value is the most common source of "duration not allowed" errors.
  useEffect(() => {
    if (durations.length === 0) return;
    const preferred = durations.find((d) => d.unit === "t") ?? durations[0];
    setUnit(preferred.unit);
    setDuration(Math.min(Math.max(5, preferred.min), preferred.max));
    setSelectedTick(1);
    setTouchedBarrier(false);
  }, [pair?.category, durations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size the default barrier from the actual price. A fixed "+0.50" is far too
  // close on an index trading near 50,000 — Deriv rejects it for being inside
  // the minimum distance from spot.
  useEffect(() => {
    if (spot === null || touchedBarrier) return;
    const step = spot * 0.01;
    if (absoluteBarrier) {
      setOffset((spot + step).toFixed(2));
      setOffset2((spot - step).toFixed(2));
    } else {
      setOffset(`+${step.toFixed(2)}`);
      setOffset2(`-${step.toFixed(2)}`);
    }
  }, [spot, absoluteBarrier, touchedBarrier, pair?.category]);

  useEffect(() => {
    if (!pair) return;
    onBarrierChange(pair.barrier === "offset" && !absoluteBarrier ? offset : null);
  }, [pair, offset, absoluteBarrier, onBarrierChange]);

  // Live prices for both sides. Deriv refuses to price a contract whose outcome
  // is near-certain ("offers no return") — that's a legitimate answer to a badly
  // placed barrier, so it's shown on the button rather than hidden until buy.
  const [quotes, setQuotes] = useState<Record<string, { payout: number } | { error: string }>>({});

  const quoteKey = pair
    ? [pair.category, stake, duration, unit, digit, selectedTick, offset, offset2, growthRate, multiplier].join("|")
    : "";

  useEffect(() => {
    if (!pair || disabled || stake <= 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results: Record<string, { payout: number } | { error: string }> = {};
      for (const side of pair.sides) {
        try {
          results[side.type] = await onQuote(buildIntent(side.type));
        } catch {
          results[side.type] = { error: "Unavailable" };
        }
      }
      if (!cancelled) setQuotes(results);
    }, 450); // debounce: every keystroke would otherwise hit the rate limit

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [quoteKey, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pairs.length === 0) {
    return (
      <p className="text-sm text-mist">
        No contracts available for this market right now.
      </p>
    );
  }

  const activeRange = durations.find((d) => d.unit === unit) ?? durations[0];
  const overStake = balance !== null && stake > balance;

  function buildIntent(contractType: string): TradeIntent {
    const noExpiry = durations.length === 0;
    const intent: TradeIntent = {
      contractType,
      stake,
      // Accumulators and Multipliers have no expiry; sending one is rejected.
      ...(noExpiry ? {} : { duration, durationUnit: unit }),
    };
    if (pair!.barrier === "digit") intent.barrier = String(digit);
    if (pair!.barrier === "offset") intent.barrier = offset;
    if (pair!.barrier === "range") {
      intent.barrier = offset;
      intent.barrier2 = offset2;
    }
    if (pair!.barrier === "tick") intent.selectedTick = selectedTick;
    if (pair!.category === "accumulator") intent.growthRate = growthRate;
    if (pair!.category === "multiplier") intent.multiplier = multiplier;
    return intent;
  }

  return (
    <div>
      {/* Contract families — a grid, so every option is visible at once
          rather than hidden behind a horizontal scroll. */}
      <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
        Contract type
      </span>
      <div className="grid grid-cols-2 gap-1.5 mt-2 mb-4">
        {pairs.map((p, i) => (
          <button
            key={p.category}
            onClick={() => setPairIndex(i)}
            className={`text-left text-[11px] leading-tight px-2.5 py-2 rounded-md border transition ${
              i === pairIndex
                ? "border-signal text-signal bg-signal/10"
                : "border-line text-mist hover:border-mist hover:text-[#E7ECE9]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-mist mb-4 leading-relaxed">{pair.blurb}</p>

      {pair.noFixedPayout && (
        <p className="text-[11px] text-alert bg-alert/10 border border-alert/30 rounded-md px-3 py-2 mb-4">
          No fixed payout — Deriv prices these differently, so they likely earn no
          markup for the app.
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
            Stake ({currency})
          </span>
          <input
            type="number"
            min={0.35}
            step={0.01}
            value={stake}
            onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
            className="mt-1.5 w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
          />
          {overStake && (
            <span className="text-[11px] text-danger mt-1 block">
              More than your {balance?.toFixed(2)} {currency} balance.
            </span>
          )}
        </label>

        <label className={`block ${durations.length === 0 ? "hidden" : ""}`}>
          <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
            Duration
            {activeRange && (
              <span className="normal-case tracking-normal">
                {" "}
                ({activeRange.min}–{activeRange.max} {DURATION_UNIT_LABELS[activeRange.unit]})
              </span>
            )}
          </span>
          <div className="mt-1.5 flex gap-2">
            <input
              type="number"
              min={activeRange?.min ?? 1}
              max={activeRange?.max ?? 10}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
            />
            {durations.length > 1 && (
              <select
                value={unit}
                onChange={(e) => {
                  const u = e.target.value as DurationRange["unit"];
                  setUnit(u);
                  const r = durations.find((d) => d.unit === u);
                  if (r) setDuration(Math.min(Math.max(duration, r.min), r.max));
                }}
                className="bg-ink border border-line rounded-md px-2 py-2 font-mono text-xs focus:border-signal focus:outline-none"
              >
                {durations.map((d) => (
                  <option key={d.unit} value={d.unit}>
                    {DURATION_UNIT_LABELS[d.unit]}
                  </option>
                ))}
              </select>
            )}
          </div>
        </label>
      </div>

      {pair.barrier === "digit" && (
        <div className="mb-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
            Predicted digit
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(spec?.lastDigitRange ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).map((d) => (
              <button
                key={d}
                onClick={() => setDigit(d)}
                className={`w-9 h-9 rounded-md border font-mono text-sm transition ${
                  d === digit
                    ? "border-signal text-signal bg-signal/10"
                    : "border-line text-mist hover:border-mist"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {pair.barrier === "growth" && (
        <div className="mb-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
            Growth rate per tick
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[0.01, 0.02, 0.03, 0.04, 0.05].map((g) => (
              <button
                key={g}
                onClick={() => setGrowthRate(g)}
                className={`px-3 h-9 rounded-md border font-mono text-sm transition ${
                  g === growthRate
                    ? "border-signal text-signal bg-signal/10"
                    : "border-line text-mist hover:border-mist"
                }`}
              >
                {(g * 100).toFixed(0)}%
              </button>
            ))}
          </div>
        </div>
      )}

      {pair.category === "multiplier" && (
        <label className="block mb-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
            Multiplier
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[30, 50, 100, 200, 400].map((m) => (
              <button
                key={m}
                onClick={() => setMultiplier(m)}
                className={`px-3 h-9 rounded-md border font-mono text-sm transition ${
                  m === multiplier
                    ? "border-signal text-signal bg-signal/10"
                    : "border-line text-mist hover:border-mist"
                }`}
              >
                x{m}
              </button>
            ))}
          </div>
        </label>
      )}

      {pair.barrier === "tick" && (
        <div className="mb-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
            Which tick?
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from({ length: duration }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setSelectedTick(n)}
                className={`w-9 h-9 rounded-md border font-mono text-sm transition ${
                  n === selectedTick
                    ? "border-signal text-signal bg-signal/10"
                    : "border-line text-mist hover:border-mist"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {(pair.barrier === "offset" || pair.barrier === "range") && (
        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
              {pair.barrier === "range" ? "Upper barrier" : "Barrier offset"}
            </span>
            <input
              value={offset}
              onChange={(e) => {
                setTouchedBarrier(true);
                setOffset(e.target.value);
              }}
              placeholder={absoluteBarrier ? "50500.00" : "+500.00"}
              className="mt-1.5 w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
            />
            <span className="text-[11px] text-mist mt-1 block">
              {absoluteBarrier
                ? "An absolute price — contracts over 24h require one."
                : `Offset from the current price${spot ? ` (${spot.toFixed(2)})` : ""}, e.g. +500`}
            </span>
          </label>
          {pair.barrier === "range" && (
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
                Lower barrier
              </span>
              <input
                value={offset2}
                onChange={(e) => {
                  setTouchedBarrier(true);
                  setOffset2(e.target.value);
                }}
                placeholder={absoluteBarrier ? "49500.00" : "-500.00"}
                className="mt-1.5 w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
              />
            </label>
          )}
        </div>
      )}

      {/* Direction. Colour is never the only cue — each button is labelled. */}
      <div className={`grid gap-3 ${pair.sides.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {pair.sides.map((side) => {
          const q = quotes[side.type];
          const unpriceable = q !== undefined && "error" in q;
          return (
            <button
              key={side.type}
              disabled={disabled || overStake || busy !== null || unpriceable}
              onClick={() => onTrade(buildIntent(side.type))}
              className={`py-3 rounded-lg font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
                side.tone === "up"
                  ? "bg-signal text-ink hover:brightness-110"
                  : "bg-danger text-ink hover:brightness-110"
              }`}
            >
              <span className="block">{busy === side.type ? "Placing…" : side.label}</span>
              <span className="block font-mono text-[11px] opacity-80">
                {q === undefined
                  ? "…"
                  : "error" in q
                    ? q.error
                    : q.payout > 0
                      ? `pays ${q.payout.toFixed(2)} ${currency}`
                      : "no fixed payout"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
