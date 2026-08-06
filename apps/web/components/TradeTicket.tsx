"use client";

import { useEffect, useMemo, useState } from "react";
import type { DurationRange, ProposalRequest } from "@tradezaki/core";
import { useDeriv } from "@/components/DerivProvider";
import { CONTRACT_PAIRS, DURATION_UNIT_LABELS, type ContractPair } from "@/lib/contracts";

type Quote = { payout: number; askPrice: number } | { error: string };

export default function TradeTicket() {
  const {
    available,
    currency,
    balance,
    connState,
    symbol,
    spot,
    quote,
    buy,
    busy,
    tradeError,
    clearTradeError,
    setChartBarrier,
  } = useDeriv();

  // Only families Deriv actually lists for this market — otherwise the ticket
  // advertises trades that get rejected at proposal time.
  const pairs = useMemo(() => {
    const have = new Set(available.map((a) => a.contractType));
    return CONTRACT_PAIRS.filter((p) => p.sides.every((s) => have.has(s.type)));
  }, [available]);

  const [pairIndex, setPairIndex] = useState(0);
  const pair: ContractPair | undefined = pairs[pairIndex] ?? pairs[0];
  const spec = available.find((a) => a.contractType === pair?.sides[0].type);
  const durations = spec?.durations ?? [];
  const noExpiry = durations.length === 0;

  const [stake, setStake] = useState(1);
  const [unit, setUnit] = useState<DurationRange["unit"]>("t");
  const [duration, setDuration] = useState(5);
  const [digit, setDigit] = useState(5);
  const [selectedTick, setSelectedTick] = useState(1);
  const [growthRate, setGrowthRate] = useState(0.03);
  const [multiplier, setMultiplier] = useState(100);
  const [barrier, setBarrier] = useState("");
  const [barrier2, setBarrier2] = useState("");
  const [touchedBarrier, setTouchedBarrier] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});

  // Barriers beyond 24h must be absolute prices, not offsets. Deriv rejects the
  // wrong form outright.
  const absolute = unit === "d";

  useEffect(() => {
    if (durations.length === 0) return;
    const preferred = durations.find((d) => d.unit === "t") ?? durations[0];
    setUnit(preferred.unit);
    setDuration(Math.min(Math.max(5, preferred.min), preferred.max));
    setSelectedTick(1);
    setTouchedBarrier(false);
  }, [pair?.category, durations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size barriers from the real price. A fixed "+0.50" is meaningless on an
  // index near 50,000 — Deriv enforces a minimum distance from spot.
  useEffect(() => {
    if (spot === null || touchedBarrier) return;
    const step = spot * 0.01;
    setBarrier(absolute ? (spot + step).toFixed(2) : `+${step.toFixed(2)}`);
    setBarrier2(absolute ? (spot - step).toFixed(2) : `-${step.toFixed(2)}`);
  }, [spot, absolute, touchedBarrier, pair?.category]);

  function intentFor(contractType: string): Omit<ProposalRequest, "symbol" | "currency"> {
    const req: Omit<ProposalRequest, "symbol" | "currency"> = {
      contractType,
      amount: stake,
      basis: "stake",
      ...(noExpiry ? {} : { duration, durationUnit: unit }),
    };
    if (pair?.barrier === "digit") req.barrier = String(digit);
    if (pair?.barrier === "offset") req.barrier = barrier;
    if (pair?.barrier === "range") {
      req.barrier = barrier;
      req.barrier2 = barrier2;
    }
    if (pair?.barrier === "tick") req.selectedTick = selectedTick;
    if (pair?.category === "accumulator") req.growthRate = growthRate;
    if (pair?.category === "multiplier") req.multiplier = multiplier;
    return req;
  }

  // Publish the barrier as an absolute price so the chart can draw it.
  useEffect(() => {
    if (!pair || (pair.barrier !== "offset" && pair.barrier !== "range")) {
      setChartBarrier(null);
      return;
    }
    const raw = barrier.trim();
    if (!/^[+-]?\d*\.?\d+$/.test(raw)) {
      setChartBarrier(null);
      return;
    }
    const n = Number(raw);
    setChartBarrier(absolute ? n : spot !== null ? spot + n : null);
  }, [pair, barrier, absolute, spot, setChartBarrier]);

  const key = pair
    ? [pair.category, stake, duration, unit, digit, selectedTick, barrier, barrier2, growthRate, multiplier, symbol].join("|")
    : "";

  useEffect(() => {
    if (!pair || connState !== "connected" || stake <= 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const next: Record<string, Quote> = {};
      for (const side of pair.sides) next[side.type] = await quote(intentFor(side.type));
      if (!cancelled) setQuotes(next);
    }, 400); // debounce — every keystroke would hit the rate limit
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, connState]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!symbol || pairs.length === 0) {
    return (
      <div className="p-5 text-sm text-mist">
        {connState === "connected" ? "No contracts available here." : "Connecting…"}
      </div>
    );
  }

  const range = durations.find((d) => d.unit === unit) ?? durations[0];
  const overStake = balance !== null && stake > balance;
  const firstQuote = quotes[pair.sides[0].type];
  const payout = firstQuote && !("error" in firstQuote) ? firstQuote.payout : null;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
        <section>
          <Label>Contract type</Label>
          <div className="grid grid-cols-2 gap-1.5 mt-2">
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
          <p className="text-[11px] text-mist mt-2.5 leading-relaxed">{pair.blurb}</p>
          {pair.noFixedPayout && (
            <p className="text-[11px] text-alert bg-alert/10 border border-alert/30 rounded-md px-2.5 py-2 mt-2.5">
              No fixed payout — these likely earn no markup for the app.
            </p>
          )}
        </section>

        {!noExpiry && (
          <section>
            <Label>
              Duration
              {range && (
                <span className="normal-case tracking-normal text-mist/70">
                  {" "}
                  · {range.min}–{range.max} {DURATION_UNIT_LABELS[range.unit]}
                </span>
              )}
            </Label>
            <div className="mt-1.5 flex gap-2">
              <div className="flex-1 flex items-center bg-ink border border-line rounded-md focus-within:border-signal">
                <button
                  onClick={() => setDuration((d) => Math.max(range?.min ?? 1, d - 1))}
                  className="px-3 py-2 text-mist hover:text-signal"
                  aria-label="Decrease duration"
                >
                  −
                </button>
                <input
                  type="number"
                  value={duration}
                  min={range?.min}
                  max={range?.max}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full bg-transparent text-center font-mono text-sm py-2 focus:outline-none"
                />
                <button
                  onClick={() => setDuration((d) => Math.min(range?.max ?? 10, d + 1))}
                  className="px-3 py-2 text-mist hover:text-signal"
                  aria-label="Increase duration"
                >
                  +
                </button>
              </div>
              {durations.length > 1 && (
                <select
                  value={unit}
                  onChange={(e) => {
                    const u = e.target.value as DurationRange["unit"];
                    setUnit(u);
                    const r = durations.find((d) => d.unit === u);
                    if (r) setDuration(Math.min(Math.max(duration, r.min), r.max));
                  }}
                  className="bg-ink border border-line rounded-md px-2 font-mono text-xs focus:border-signal focus:outline-none"
                >
                  {durations.map((d) => (
                    <option key={d.unit} value={d.unit}>
                      {DURATION_UNIT_LABELS[d.unit]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </section>
        )}

        {pair.barrier === "digit" && (
          <section>
            <Label>Predicted digit</Label>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {(spec?.lastDigitRange ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).map((d) => (
                <Chip key={d} on={d === digit} onClick={() => setDigit(d)}>
                  {d}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {pair.barrier === "tick" && (
          <section>
            <Label>Which tick</Label>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {Array.from({ length: duration }, (_, i) => i + 1).map((n) => (
                <Chip key={n} on={n === selectedTick} onClick={() => setSelectedTick(n)}>
                  {n}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {pair.barrier === "growth" && (
          <section>
            <Label>Growth per tick</Label>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {[0.01, 0.02, 0.03, 0.04, 0.05].map((g) => (
                <Chip key={g} on={g === growthRate} onClick={() => setGrowthRate(g)}>
                  {(g * 100).toFixed(0)}%
                </Chip>
              ))}
            </div>
          </section>
        )}

        {pair.category === "multiplier" && (
          <section>
            <Label>Multiplier</Label>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {[30, 50, 100, 200, 400].map((m) => (
                <Chip key={m} on={m === multiplier} onClick={() => setMultiplier(m)}>
                  x{m}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {(pair.barrier === "offset" || pair.barrier === "range") && (
          <section>
            <Label>{pair.barrier === "range" ? "Barriers" : "Barrier"}</Label>
            <div className={`mt-1.5 grid gap-2 ${pair.barrier === "range" ? "grid-cols-2" : ""}`}>
              <input
                value={barrier}
                onChange={(e) => {
                  setTouchedBarrier(true);
                  setBarrier(e.target.value);
                }}
                className="bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
              />
              {pair.barrier === "range" && (
                <input
                  value={barrier2}
                  onChange={(e) => {
                    setTouchedBarrier(true);
                    setBarrier2(e.target.value);
                  }}
                  className="bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
                />
              )}
            </div>
            <p className="text-[10px] text-mist mt-1">
              {absolute
                ? "Absolute price — required beyond 24 hours."
                : `Offset from spot${spot ? ` (${spot.toFixed(2)})` : ""}`}
            </p>
          </section>
        )}

        <section>
          <Label>Stake ({currency})</Label>
          <input
            type="number"
            min={0.35}
            step={0.01}
            value={stake}
            onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
            className="mt-1.5 w-full bg-ink border border-line rounded-md px-3 py-2.5 font-mono text-base focus:border-signal focus:outline-none"
          />
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {[1, 5, 10, 25].map((v) => (
              <Chip key={v} on={stake === v} onClick={() => setStake(v)}>
                {v}
              </Chip>
            ))}
          </div>
          {overStake && (
            <p className="text-[11px] text-danger mt-1.5">
              More than your {balance?.toFixed(2)} {currency} balance.
            </p>
          )}
        </section>

        {/* What you actually stand to win or lose — the number traders want. */}
        {payout !== null && payout > 0 && (
          <dl className="border border-line rounded-md divide-y divide-line text-[12px]">
            <Row label="Payout" value={`${payout.toFixed(2)} ${currency}`} />
            <Row
              label="Net if won"
              value={`+${(payout - stake).toFixed(2)} ${currency}`}
              tone="up"
            />
            <Row label="Net if lost" value={`−${stake.toFixed(2)} ${currency}`} tone="down" />
          </dl>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3 space-y-2 bg-panel">
        {tradeError && (
          <p className="text-[11px] text-danger bg-danger/10 border border-danger/30 rounded-md px-2.5 py-2 flex items-start justify-between gap-2">
            <span>{tradeError}</span>
            <button onClick={clearTradeError} className="text-mist shrink-0">
              ✕
            </button>
          </p>
        )}

        <div className={`grid gap-2 ${pair.sides.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {pair.sides.map((side) => {
            const q = quotes[side.type];
            const dead = q !== undefined && "error" in q;
            return (
              <button
                key={side.type}
                disabled={connState !== "connected" || overStake || busy !== null || dead}
                onClick={() => buy(intentFor(side.type))}
                className={`py-3 rounded-lg font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  side.tone === "up"
                    ? "bg-signal text-ink hover:brightness-110 active:brightness-95"
                    : "bg-danger text-ink hover:brightness-110 active:brightness-95"
                }`}
              >
                <span className="block text-sm">
                  {busy === side.type ? "Placing…" : side.label}
                </span>
                <span className="block font-mono text-[10px] opacity-80">
                  {q === undefined
                    ? "…"
                    : "error" in q
                      ? q.error
                      : q.payout > 0
                        ? `pays ${q.payout.toFixed(2)}`
                        : "no fixed payout"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[9px] uppercase tracking-widest text-mist">{children}</span>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-8 rounded-md border font-mono text-xs transition ${
        on
          ? "border-signal text-signal bg-signal/10"
          : "border-line text-mist hover:border-mist hover:text-[#E7ECE9]"
      }`}
    >
      {children}
    </button>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <dt className="text-mist">{label}</dt>
      <dd
        className={`font-mono ${
          tone === "up" ? "text-signal" : tone === "down" ? "text-danger" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
