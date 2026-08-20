"use client";

import { useEffect, useMemo, useState } from "react";
import { STRATEGY_PRESETS, type ContractAvailability } from "@tradezaki/core";

type Preset = (typeof STRATEGY_PRESETS)[number];

/**
 * Presets, in a layer of their own.
 *
 * They used to render inline between the buttons and the editor, which meant a
 * chosen preset and an empty builder were on screen at the same time, each
 * looking like a live answer to "what am I editing?". It also assumed there
 * would only ever be a handful: at a hundred, the grid becomes a hundred cards
 * standing between the user and the thing they came to edit.
 *
 * A picker solves both. It is modal, so exactly one thing is being chosen at a
 * time, and it is searchable and scrolls, so the list can grow without the page
 * getting worse.
 */
export default function PresetPicker({
  available,
  symbol,
  onPick,
  onClose,
}: {
  available: ContractAvailability[];
  symbol: string | null;
  onPick: (p: Preset) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  // Escape closes it. A modal that can only be dismissed by hitting a small
  // target is a modal people feel trapped in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const have = useMemo(() => new Set(available.map((a) => a.contractType)), [available]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STRATEGY_PRESETS.map((p) => ({
      preset: p,
      // Before the market's contract list has loaded there is nothing to check
      // against, so nothing is greyed out — showing everything as unavailable
      // for the first second reads as broken.
      usable: have.size === 0 || p.requires.every((t) => have.has(t)),
    })).filter(({ preset }) => {
      if (!q) return true;
      return (
        preset.name.toLowerCase().includes(q) ||
        preset.blurb.toLowerCase().includes(q) ||
        preset.risk.toLowerCase().includes(q)
      );
    });
  }, [have, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-ink/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a preset"
    >
      <div
        className="w-full max-w-3xl max-h-full flex flex-col rounded-xl border border-line bg-panel shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-line">
          <div className="min-w-0">
            <h2 className="font-display font-bold">Presets</h2>
            <p className="text-[11px] text-mist">
              Picking one replaces whatever is in the builder.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto shrink-0 w-8 h-8 grid place-items-center rounded-md border border-line text-mist hover:text-[#E7ECE9] transition"
          >
            ✕
          </button>
        </div>

        <div className="shrink-0 px-4 py-3 border-b border-line">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search presets"
            className="w-full bg-ink border border-line rounded-lg px-3 py-2 text-[13px] focus:border-signal focus:outline-none placeholder:text-mist/50"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {rows.length === 0 ? (
            <p className="text-[12px] text-mist py-8 text-center">
              Nothing matches “{query}”.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {rows.map(({ preset: p, usable }) => (
                <button
                  key={p.id}
                  disabled={!usable}
                  onClick={() => onPick(p)}
                  className="text-left border border-line hover:border-signal rounded-lg p-3.5 bg-panel/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium text-sm">{p.name}</span>
                    <span
                      className={`font-mono text-[9px] uppercase px-1.5 py-0.5 rounded shrink-0 ${
                        p.risk === "high"
                          ? "bg-danger/15 text-danger"
                          : p.risk === "medium"
                            ? "bg-alert/15 text-alert"
                            : "bg-signal/15 text-signal"
                      }`}
                    >
                      {p.risk}
                    </span>
                  </div>
                  <p className="text-[11px] text-mist leading-relaxed mb-2">{p.blurb}</p>
                  {/* The honest part. A preset library that only sells the
                      upside is how people talk themselves into a martingale. */}
                  <p className="text-[10px] text-mist/70 leading-relaxed border-t border-line pt-2">
                    {p.edge}
                  </p>
                  {!usable && (
                    <p className="text-[10px] text-alert mt-2">
                      Not available on {symbol ?? "this market"}.
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
