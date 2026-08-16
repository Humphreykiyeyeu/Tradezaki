"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    watchAccumulator,
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

  // Take profit, stop loss and deal cancellation. Empty string means "not set",
  // which is different from zero — Deriv treats a 0 take-profit as a real order.
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [cancellation, setCancellation] = useState("");

  /**
   * What this symbol actually allows, straight from contracts_for.
   *
   * These lists are per-market and the differences are large: R_100 offers
   * multipliers 40–400 while R_10 offers 400–4000, and R_75 is the only one
   * with the x500 traders ask for. The ticket used to show a fixed 30/50/100/
   * 200/400, so on R_100 two of the five chips were values Deriv rejects, and
   * on R_10 every single one was.
   */
  const multipliers = spec?.multiplierRange ?? [];
  const growthRates = spec?.growthRateRange ?? [];
  const cancellations = spec?.cancellationRange ?? [];

  const isMultiplier = pair?.category === "multiplier";
  const isAccumulator = pair?.category === "accumulator";

  // Deriv refuses a stop loss while deal cancellation is active: cancellation
  // already returns the stake, so the two would contradict each other.
  const slBlockedByCancellation = isMultiplier && cancellation !== "";

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

  /**
   * Keep the selected multiplier and growth rate inside what this market allows.
   *
   * Switching from R_100 (40–400) to R_10 (400–4000) would otherwise leave x100
   * selected — a value R_10 does not offer — and every quote would come back
   * rejected with nothing on screen explaining why. Deriv's own default_stake
   * entry suggests the middle of the range, so the middle is what gets picked.
   */
  useEffect(() => {
    if (multipliers.length > 0 && !multipliers.includes(multiplier)) {
      setMultiplier(multipliers[Math.floor(multipliers.length / 2)]);
    }
  }, [multipliers, multiplier]);

  useEffect(() => {
    if (growthRates.length > 0 && !growthRates.includes(growthRate)) {
      setGrowthRate(growthRates[Math.floor(growthRates.length / 2)]);
    }
  }, [growthRates, growthRate]);

  // Limit orders belong to the contract that was on screen when they were
  // typed. Carrying a take profit across from Multipliers to Accumulators, or
  // a cancellation onto a market that has none, silently changes the trade.
  useEffect(() => {
    setTakeProfit("");
    setStopLoss("");
    setCancellation("");
  }, [pair?.category, symbol]);

  /**
   * Keep the Accumulator strip live for as long as Accumulators are selected.
   *
   * Stake is read through a ref rather than being a dependency: it changes on
   * every keystroke, and re-subscribing per character would tear the stream
   * down and rebuild it while the trader is still typing. The strip's contents
   * — how long recent contracts survived, and where the range currently sits —
   * do not depend on how much is being staked.
   */
  const stakeRef = useRef(stake);
  stakeRef.current = stake;

  useEffect(() => {
    if (!isAccumulator || connState !== "connected") return;
    return watchAccumulator(growthRate, stakeRef.current || 1);
  }, [isAccumulator, growthRate, symbol, connState, watchAccumulator]);

  // Size barriers from the real price. A fixed "+0.50" is meaningless on an
  // index near 50,000 — Deriv enforces a minimum distance from spot.
  useEffect(() => {
    if (spot === null || touchedBarrier) return;
    const step = spot * (pair?.barrierPct ?? 0.01);
    setBarrier(absolute ? (spot + step).toFixed(2) : `+${step.toFixed(2)}`);
    setBarrier2(absolute ? (spot - step).toFixed(2) : `-${step.toFixed(2)}`);
  }, [spot, absolute, touchedBarrier, pair?.category, pair?.barrierPct]);

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
    if (isAccumulator) req.growthRate = growthRate;
    if (isMultiplier) req.multiplier = multiplier;

    // Only sent when the trader actually filled them in. An empty limit_order
    // is rejected, and a zero is a real order to close immediately.
    const tp = Number(takeProfit);
    if ((isMultiplier || isAccumulator) && takeProfit !== "" && tp > 0) req.takeProfit = tp;

    const sl = Number(stopLoss);
    if (isMultiplier && !slBlockedByCancellation && stopLoss !== "" && sl > 0) req.stopLoss = sl;

    if (isMultiplier && cancellation !== "") req.cancellation = cancellation;

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
    ? [
        pair.category,
        stake,
        duration,
        unit,
        digit,
        selectedTick,
        barrier,
        barrier2,
        growthRate,
        multiplier,
        takeProfit,
        stopLoss,
        cancellation,
        symbol,
      ].join("|")
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
          <select
            value={pairIndex}
            onChange={(e) => setPairIndex(Number(e.target.value))}
            className="mt-1.5 w-full bg-ink border border-line rounded-md px-3 py-2.5 text-sm focus:border-signal focus:outline-none"
          >
            {pairs.map((p, i) => (
              <option key={p.category} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-mist mt-2 leading-relaxed">{pair.blurb}</p>
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

        {pair.barrier === "growth" && growthRates.length > 0 && (
          <section>
            <Label>Growth per tick</Label>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {growthRates.map((g) => (
                <Chip key={g} on={g === growthRate} onClick={() => setGrowthRate(g)}>
                  {(g * 100).toFixed(0)}%
                </Chip>
              ))}
            </div>
          </section>
        )}

        {isMultiplier && multipliers.length > 0 && (
          <section>
            <Label>Multiplier</Label>
            <div
              className="mt-2 grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${Math.min(multipliers.length, 5)}, 1fr)` }}
            >
              {multipliers.map((m) => (
                <Chip key={m} on={m === multiplier} onClick={() => setMultiplier(m)}>
                  x{m}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {/* Take profit — Deriv offers it on both families, and both run until
            something closes them, so leaving it out meant the only way to take
            a profit was to sit and watch. */}
        {(isMultiplier || isAccumulator) && (
          <section>
            <div className="flex items-center justify-between">
              <Label>Take profit</Label>
              <span className="font-mono text-[9px] text-mist">optional</span>
            </div>
            <input
              inputMode="decimal"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={`Close at this profit (${currency})`}
              className="mt-1.5 w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none placeholder:text-mist/50"
            />
          </section>
        )}

        {/* Stop loss is a multiplier-only concept. An Accumulator that leaves
            its range is already over at zero, so there is nothing to stop. */}
        {isMultiplier && (
          <section>
            <div className="flex items-center justify-between">
              <Label>Stop loss</Label>
              <span className="font-mono text-[9px] text-mist">optional</span>
            </div>
            <input
              inputMode="decimal"
              value={stopLoss}
              disabled={slBlockedByCancellation}
              onChange={(e) => setStopLoss(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={
                slBlockedByCancellation
                  ? "Covered by deal cancellation"
                  : `Close at this loss (${currency})`
              }
              className="mt-1.5 w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none placeholder:text-mist/50 disabled:opacity-50"
            />
          </section>
        )}

        {/* Only where Deriv actually offers it — the list is empty on forex and
            crypto, and showing a control that always fails is worse than none. */}
        {isMultiplier && cancellations.length > 0 && (
          <section>
            <div className="flex items-center justify-between">
              <Label>Deal cancellation</Label>
              <span className="font-mono text-[9px] text-mist">
                get your stake back within
              </span>
            </div>
            <div
              className="mt-2 grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${cancellations.length + 1}, 1fr)` }}
            >
              <Chip on={cancellation === ""} onClick={() => setCancellation("")}>
                Off
              </Chip>
              {cancellations.map((c) => (
                <Chip key={c} on={cancellation === c} onClick={() => setCancellation(c)}>
                  {c}
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
