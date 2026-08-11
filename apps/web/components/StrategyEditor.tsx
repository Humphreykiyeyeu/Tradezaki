"use client";

import { useMemo } from "react";
import type { Condition, ContractSpec, Strategy, StakingPlan } from "@tradezaki/core";
import { worstCaseLoss } from "@tradezaki/core";
import { useDeriv } from "@/components/DerivProvider";
import { CONTRACT_PAIRS, DURATION_UNIT_LABELS, marketLabel } from "@/lib/contracts";

/**
 * Strategy builder.
 *
 * Entry conditions are picked from a fixed list rather than typed. Same reason
 * the IR is a closed tree: nothing a user configures here can become
 * executable code.
 */

const ENTRY_PRESETS: { label: string; value: Condition }[] = [
  { label: "Every opportunity", value: { op: "always" } },
  { label: "After an up tick", value: { op: "tickDirection", is: "up" } },
  { label: "After a down tick", value: { op: "tickDirection", is: "down" } },
  { label: "After 2 up ticks", value: { op: "streak", direction: "up", cmp: ">=", value: 2 } },
  { label: "After 3 up ticks", value: { op: "streak", direction: "up", cmp: ">=", value: 3 } },
  { label: "After 2 down ticks", value: { op: "streak", direction: "down", cmp: ">=", value: 2 } },
  { label: "After 3 down ticks", value: { op: "streak", direction: "down", cmp: ">=", value: 3 } },
  { label: "After a loss", value: { op: "lastResult", is: "lost" } },
  { label: "After a win", value: { op: "lastResult", is: "won" } },
  { label: "Last digit under 5", value: { op: "lastDigit", cmp: "<", value: 5 } },
  { label: "Last digit over 4", value: { op: "lastDigit", cmp: ">", value: 4 } },
  { label: "Last digit is even", value: { op: "lastDigit", cmp: "<", value: 10 } },
  {
    label: "Price up 0.1% over 10 ticks",
    value: { op: "priceChange", overTicks: 10, cmp: ">", pct: 0.1 },
  },
  {
    label: "Price down 0.1% over 10 ticks",
    value: { op: "priceChange", overTicks: 10, cmp: "<", pct: -0.1 },
  },
];

function labelFor(c: Condition | undefined): string {
  if (!c) return "Every opportunity";
  return (
    ENTRY_PRESETS.find((p) => JSON.stringify(p.value) === JSON.stringify(c))?.label ?? "Custom"
  );
}

export default function StrategyEditor({
  strategy,
  onChange,
  currency,
  /** Contract choice is locked for imports, where types came from the file. */
  lockContract = false,
}: {
  strategy: Strategy;
  onChange: (s: Strategy) => void;
  currency: string;
  lockContract?: boolean;
}) {
  const { symbols, available } = useDeriv();

  const set = (patch: Partial<Strategy>) => onChange({ ...strategy, ...patch });
  const setStaking = (patch: Record<string, unknown>) =>
    onChange({ ...strategy, staking: { ...strategy.staking, ...patch } as StakingPlan });
  const setLimits = (patch: Partial<Strategy["limits"]>) =>
    onChange({ ...strategy, limits: { ...strategy.limits, ...patch } });
  const setContract = (patch: Partial<ContractSpec>) =>
    onChange({
      ...strategy,
      contract: { ...strategy.contract, ...patch },
      ...(strategy.contractAlt
        ? { contractAlt: { ...strategy.contractAlt, ...patch } }
        : {}),
    });

  // Families available on the chosen market, so the builder can't offer a
  // contract Deriv would refuse.
  const pairs = useMemo(() => {
    const have = new Set(available.map((a) => a.contractType));
    return have.size === 0
      ? CONTRACT_PAIRS
      : CONTRACT_PAIRS.filter((p) => p.sides.every((s) => have.has(s.type)));
  }, [available]);

  const currentPair =
    pairs.find((p) => p.sides.some((s) => s.type === strategy.contract.contractType)) ?? null;
  const spec = available.find((a) => a.contractType === strategy.contract.contractType);
  const durations = spec?.durations ?? [];
  const noExpiry = strategy.contract.duration === undefined;

  const base =
    strategy.staking.type === "fixed" ? strategy.staking.amount : strategy.staking.base;
  const worst = worstCaseLoss(strategy.staking);
  const biggest =
    strategy.staking.type === "martingale"
      ? strategy.staking.base * strategy.staking.multiplier ** strategy.staking.maxSteps
      : strategy.staking.type === "dalembert"
        ? strategy.staking.base + strategy.staking.unit * strategy.staking.maxSteps
        : base;

  function pickFamily(category: string) {
    const pair = pairs.find((p) => p.category === category);
    if (!pair) return;
    const mk = (type: string): ContractSpec => {
      if (type === "ACCU") return { contractType: type, basis: "stake", growthRate: 0.03 };
      if (type.startsWith("MULT")) return { contractType: type, basis: "stake", multiplier: 100 };
      const d = available.find((a) => a.contractType === type)?.durations ?? [];
      const range = d.find((x) => x.unit === "t") ?? d[0];
      return {
        contractType: type,
        basis: "stake",
        duration: range ? Math.min(Math.max(5, range.min), range.max) : 5,
        durationUnit: (range?.unit ?? "t") as ContractSpec["durationUnit"],
        ...(pair.barrier === "digit" ? { barrier: "5" } : {}),
      };
    };
    onChange({
      ...strategy,
      contract: mk(pair.sides[0].type),
      ...(pair.sides[1]
        ? { contractAlt: mk(pair.sides[1].type), entryAlt: strategy.entryAlt ?? { op: "always" } }
        : { contractAlt: undefined, entryAlt: undefined }),
    });
  }

  return (
    <div className="space-y-4">
      <Field label="Name">
        <input value={strategy.name} onChange={(e) => set({ name: e.target.value })} className="input" />
      </Field>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Market">
          <select
            value={strategy.symbol}
            onChange={(e) => set({ symbol: e.target.value })}
            className="input"
          >
            {symbols.length === 0 && <option value={strategy.symbol}>{strategy.symbol}</option>}
            {symbols
              .filter((s) => s.isOpen && !s.isSuspended)
              .map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.displayName} · {marketLabel(s.market)}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Contract type">
          <select
            value={currentPair?.category ?? ""}
            disabled={lockContract}
            onChange={(e) => pickFamily(e.target.value)}
            className="input disabled:opacity-60"
          >
            {!currentPair && (
              <option value="">{strategy.contract.contractType}</option>
            )}
            {pairs.map((p) => (
              <option key={p.category} value={p.category}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!noExpiry && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Duration">
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={strategy.contract.duration ?? 5}
                onChange={(e) => setContract({ duration: Math.max(1, Number(e.target.value)) })}
                className="input"
              />
              <select
                value={strategy.contract.durationUnit ?? "t"}
                onChange={(e) =>
                  setContract({ durationUnit: e.target.value as ContractSpec["durationUnit"] })
                }
                className="input w-28"
              >
                {(durations.length ? durations.map((d) => d.unit) : ["t"]).map((u) => (
                  <option key={u} value={u}>
                    {DURATION_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          {currentPair?.barrier === "digit" && (
            <Field label="Predicted digit">
              <select
                value={strategy.contract.barrier ?? "5"}
                onChange={(e) => setContract({ barrier: e.target.value })}
                className="input"
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <option key={d} value={String(d)}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}

      {strategy.contract.growthRate !== undefined && (
        <Field label="Growth per tick">
          <select
            value={strategy.contract.growthRate}
            onChange={(e) => setContract({ growthRate: Number(e.target.value) })}
            className="input"
          >
            {[0.01, 0.02, 0.03, 0.04, 0.05].map((g) => (
              <option key={g} value={g}>
                {(g * 100).toFixed(0)}%
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={`Buy ${strategy.contract.contractType} when`}>
        <select
          value={labelFor(strategy.entry)}
          onChange={(e) => {
            const p = ENTRY_PRESETS.find((x) => x.label === e.target.value);
            if (p) set({ entry: p.value });
          }}
          className="input"
        >
          {labelFor(strategy.entry) === "Custom" && <option>Custom</option>}
          {ENTRY_PRESETS.map((p) => (
            <option key={p.label}>{p.label}</option>
          ))}
        </select>
      </Field>

      {strategy.contractAlt && (
        <Field label={`Buy ${strategy.contractAlt.contractType} when`}>
          <select
            value={labelFor(strategy.entryAlt)}
            onChange={(e) => {
              const p = ENTRY_PRESETS.find((x) => x.label === e.target.value);
              if (p) set({ entryAlt: p.value });
            }}
            className="input"
          >
            {ENTRY_PRESETS.map((p) => (
              <option key={p.label}>{p.label}</option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Staking">
          <select
            value={strategy.staking.type}
            onChange={(e) => {
              const t = e.target.value;
              set({
                staking:
                  t === "fixed"
                    ? { type: "fixed", amount: base }
                    : t === "martingale"
                      ? { type: "martingale", base, multiplier: 2, maxSteps: 4 }
                      : { type: "dalembert", base, unit: base, maxSteps: 8 },
              });
            }}
            className="input"
          >
            <option value="fixed">Fixed stake</option>
            <option value="martingale">Martingale</option>
            <option value="dalembert">D&apos;Alembert</option>
          </select>
        </Field>

        <Field label={`Stake (${currency})`}>
          <input
            type="number"
            step={0.01}
            min={0.35}
            value={base}
            onChange={(e) => {
              const v = Math.max(0, Number(e.target.value));
              setStaking(strategy.staking.type === "fixed" ? { amount: v } : { base: v });
            }}
            className="input"
          />
        </Field>
      </div>

      {strategy.staking.type !== "fixed" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={strategy.staking.type === "martingale" ? "Multiplier" : "Step unit"}>
              <input
                type="number"
                step={0.05}
                value={
                  strategy.staking.type === "martingale"
                    ? strategy.staking.multiplier
                    : strategy.staking.unit
                }
                onChange={(e) =>
                  setStaking(
                    strategy.staking.type === "martingale"
                      ? { multiplier: Number(e.target.value) }
                      : { unit: Number(e.target.value) }
                  )
                }
                className="input"
              />
            </Field>
            <Field label="Max steps">
              <input
                type="number"
                min={1}
                max={15}
                value={strategy.staking.maxSteps}
                onChange={(e) =>
                  setStaking({ maxSteps: Math.min(15, Math.max(1, Number(e.target.value))) })
                }
                className="input"
              />
            </Field>
          </div>

          {/* The number people don't work out for themselves. */}
          <p className="text-[11px] text-alert bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
            If every step loses, one run risks{" "}
            <strong>
              {worst.toFixed(2)} {currency}
            </strong>
            , with a largest single stake of {biggest.toFixed(2)} {currency}.
          </p>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Take profit (${currency})`}>
          <input
            type="number"
            step={0.01}
            value={strategy.limits.takeProfit ?? ""}
            placeholder="off"
            onChange={(e) =>
              setLimits({ takeProfit: e.target.value === "" ? undefined : Number(e.target.value) })
            }
            className="input"
          />
        </Field>
        <Field label={`Stop loss (${currency})`}>
          <input
            type="number"
            step={0.01}
            value={strategy.limits.stopLoss ?? ""}
            placeholder="off"
            onChange={(e) =>
              setLimits({ stopLoss: e.target.value === "" ? undefined : Number(e.target.value) })
            }
            className="input"
          />
        </Field>
        <Field label="Max trades">
          <input
            type="number"
            min={1}
            value={strategy.limits.maxTrades ?? ""}
            placeholder="off"
            onChange={(e) =>
              setLimits({ maxTrades: e.target.value === "" ? undefined : Number(e.target.value) })
            }
            className="input"
          />
        </Field>
        <Field label={`Max stake (${currency})`}>
          <input
            type="number"
            step={0.01}
            value={strategy.limits.maxStake ?? ""}
            placeholder="off"
            onChange={(e) =>
              setLimits({ maxStake: e.target.value === "" ? undefined : Number(e.target.value) })
            }
            className="input"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-widest text-mist">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
