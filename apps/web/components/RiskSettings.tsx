"use client";

import type { RiskGuardianConfig } from "@tradezaki/core";

interface Props {
  config: RiskGuardianConfig;
  onChange: (next: RiskGuardianConfig) => void;
  currency: string;
  /** Loss already taken today on THIS account, for the progress bar. */
  lossToday: number;
  accountLabel: string;
}

/**
 * Risk Guardian is opt-in and configured per account.
 *
 * Per account matters: demo and real are separate money. Hitting a limit while
 * practising on demo must not lock the real account — that was the behaviour
 * before, and it was simply wrong.
 */
export default function RiskSettings({
  config,
  onChange,
  currency,
  lossToday,
  accountLabel,
}: Props) {
  const set = (patch: Partial<RiskGuardianConfig>) => onChange({ ...config, ...patch });
  const pct =
    config.dailyLossLimit > 0 ? Math.min(100, (lossToday / config.dailyLossLimit) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-mist">
          Risk Guardian
        </p>
        <button
          role="switch"
          aria-checked={config.enabled}
          aria-label="Enable Risk Guardian"
          onClick={() => set({ enabled: !config.enabled })}
          className={`relative w-10 h-6 rounded-full transition ${
            config.enabled ? "bg-signal" : "bg-line"
          }`}
        >
          <span
            className={`absolute top-1 w-4 h-4 rounded-full bg-ink transition-all ${
              config.enabled ? "left-5" : "left-1"
            }`}
          />
        </button>
      </div>

      <p className="text-[11px] text-mist mb-4">
        {config.enabled
          ? `Applies to ${accountLabel} only — your other accounts are unaffected.`
          : "Off. Set your own limits and turn this on when you want them enforced."}
      </p>

      {config.enabled && (
        <div className="space-y-4">
          <label className="block">
            <span className="flex items-baseline justify-between">
              <span className="text-xs">Daily loss limit</span>
              <span className="font-mono text-xs text-mist">
                {config.dailyLossLimit > 0 ? `${config.dailyLossLimit} ${currency}` : "off"}
              </span>
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={config.dailyLossLimit}
              onChange={(e) => set({ dailyLossLimit: Math.max(0, Number(e.target.value)) })}
              className="mt-1.5 w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
            />
            {config.dailyLossLimit > 0 && (
              <>
                <div className="h-1 bg-line rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pct >= 100 ? "bg-danger" : pct > 70 ? "bg-alert" : "bg-signal"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] text-mist mt-1 block">
                  {lossToday.toFixed(2)} of {config.dailyLossLimit} {currency} used today
                </span>
              </>
            )}
          </label>

          <label className="block">
            <span className="flex items-baseline justify-between">
              <span className="text-xs">Max stake per trade</span>
              <span className="font-mono text-xs text-mist">
                {config.maxStakePercentOfBalance > 0
                  ? `${config.maxStakePercentOfBalance}% of balance`
                  : "off"}
              </span>
            </span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={config.maxStakePercentOfBalance}
              onChange={(e) =>
                set({
                  maxStakePercentOfBalance: Math.min(100, Math.max(0, Number(e.target.value))),
                })
              }
              className="mt-1.5 w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="flex items-baseline justify-between">
              <span className="text-xs">Cooldown after losing streak</span>
              <span className="font-mono text-xs text-mist">
                {config.maxConsecutiveLosses > 0
                  ? `${config.maxConsecutiveLosses} losses → ${config.cooldownSeconds / 60}m`
                  : "off"}
              </span>
            </span>
            <div className="mt-1.5 flex gap-2">
              <input
                type="number"
                min={0}
                value={config.maxConsecutiveLosses}
                onChange={(e) =>
                  set({ maxConsecutiveLosses: Math.max(0, Number(e.target.value)) })
                }
                className="w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
                aria-label="Consecutive losses before cooldown"
              />
              <select
                value={config.cooldownSeconds}
                onChange={(e) => set({ cooldownSeconds: Number(e.target.value) })}
                className="bg-ink border border-line rounded-md px-2 py-2 font-mono text-xs focus:border-signal focus:outline-none"
                aria-label="Cooldown length"
              >
                {[5, 15, 30, 60].map((m) => (
                  <option key={m} value={m * 60}>
                    {m} min
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
