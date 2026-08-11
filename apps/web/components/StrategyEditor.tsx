"use client";

import type { Condition, Strategy, StakingPlan } from "@tradezaki/core";
import { worstCaseLoss } from "@tradezaki/core";

/**
 * Minimal strategy editor.
 *
 * Entry conditions are chosen from a fixed list rather than typed, which is the
 * same reason the IR is a closed tree: nothing here can become executable code.
 */

const ENTRY_PRESETS: { label: string; value: Condition }[] = [
  { label: "Every opportunity", value: { op: "always" } },
  { label: "After an up tick", value: { op: "tickDirection", is: "up" } },
  { label: "After a down tick", value: { op: "tickDirection", is: "down" } },
  { label: "After 3 up ticks", value: { op: "streak", direction: "up", cmp: ">=", value: 3 } },
  { label: "After 3 down ticks", value: { op: "streak", direction: "down", cmp: ">=", value: 3 } },
  { label: "After a loss", value: { op: "lastResult", is: "lost" } },
  { label: "After a win", value: { op: "lastResult", is: "won" } },
  { label: "Last digit is under 5", value: { op: "lastDigit", cmp: "<", value: 5 } },
  { label: "Last digit is over 4", value: { op: "lastDigit", cmp: ">", value: 4 } },
];

function labelFor(c: Condition): string {
  const hit = ENTRY_PRESETS.find((p) => JSON.stringify(p.value) === JSON.stringify(c));
  return hit?.label ?? "Custom";
}

export default function StrategyEditor({
  strategy,
  onChange,
  currency,
}: {
  strategy: Strategy;
  onChange: (s: Strategy) => void;
  currency: string;
}) {
  const set = (patch: Partial<Strategy>) => onChange({ ...strategy, ...patch });
  const setStaking = (patch: Partial<StakingPlan>) =>
    onChange({ ...strategy, staking: { ...strategy.staking, ...patch } as StakingPlan });
  const setLimits = (patch: Partial<Strategy["limits"]>) =>
    onChange({ ...strategy, limits: { ...strategy.limits, ...patch } });

  const worst = worstCaseLoss(strategy.staking);

  return (
    <div className="space-y-4">
      <Field label="Name">
        <input
          value={strategy.name}
          onChange={(e) => set({ name: e.target.value })}
          className="input"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Market">
          <input value={strategy.symbol} readOnly className="input opacity-60" />
        </Field>
        <Field label="Contract">
          <input
            value={
              strategy.contract.contractType +
              (strategy.contractAlt ? ` / ${strategy.contractAlt.contractType}` : "")
            }
            readOnly
            className="input opacity-60"
          />
        </Field>
      </div>

      <Field label="Buy when">
        <select
          value={labelFor(strategy.entry)}
          onChange={(e) => {
            const preset = ENTRY_PRESETS.find((p) => p.label === e.target.value);
            if (preset) set({ entry: preset.value });
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
            value={labelFor(strategy.entryAlt ?? { op: "always" })}
            onChange={(e) => {
              const preset = ENTRY_PRESETS.find((p) => p.label === e.target.value);
              if (preset) set({ entryAlt: preset.value });
            }}
            className="input"
          >
            {ENTRY_PRESETS.map((p) => (
              <option key={p.label}>{p.label}</option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Staking">
        <select
          value={strategy.staking.type}
          onChange={(e) => {
            const base =
              strategy.staking.type === "fixed" ? strategy.staking.amount : strategy.staking.base;
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

      <div className="grid grid-cols-3 gap-3">
        <Field label={`Stake (${currency})`}>
          <input
            type="number"
            step={0.01}
            min={0.35}
            value={
              strategy.staking.type === "fixed" ? strategy.staking.amount : strategy.staking.base
            }
            onChange={(e) => {
              const v = Math.max(0, Number(e.target.value));
              setStaking(strategy.staking.type === "fixed" ? { amount: v } : { base: v });
            }}
            className="input"
          />
        </Field>

        {strategy.staking.type === "martingale" && (
          <Field label="Multiplier">
            <input
              type="number"
              step={0.05}
              min={1.01}
              value={strategy.staking.multiplier}
              onChange={(e) => setStaking({ multiplier: Number(e.target.value) })}
              className="input"
            />
          </Field>
        )}
        {strategy.staking.type === "dalembert" && (
          <Field label="Step unit">
            <input
              type="number"
              step={0.01}
              value={strategy.staking.unit}
              onChange={(e) => setStaking({ unit: Number(e.target.value) })}
              className="input"
            />
          </Field>
        )}
        {strategy.staking.type !== "fixed" && (
          <Field label="Max steps">
            <input
              type="number"
              min={1}
              max={15}
              value={strategy.staking.maxSteps}
              onChange={(e) => setStaking({ maxSteps: Number(e.target.value) })}
              className="input"
            />
          </Field>
        )}
      </div>

      {/* The number people don't compute for themselves: a $1 martingale at x2
          over 8 steps commits $511, not $1. */}
      {strategy.staking.type !== "fixed" && (
        <p className="text-[11px] text-alert bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
          If every step loses, this risks <strong>{worst.toFixed(2)} {currency}</strong> in one
          run, and the largest single stake is{" "}
          {(strategy.staking.type === "martingale"
            ? strategy.staking.base * strategy.staking.multiplier ** strategy.staking.maxSteps
            : strategy.staking.base + strategy.staking.unit * strategy.staking.maxSteps
          ).toFixed(2)}{" "}
          {currency}.
        </p>
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
