"use client";

import { useMemo, useState } from "react";
import type { ActiveSymbol } from "@tradezaki/core";
import { marketLabel } from "@/lib/contracts";

interface Props {
  symbols: ActiveSymbol[];
  value: string | null;
  onChange: (symbol: string) => void;
}

/**
 * Searchable symbol list grouped by market. Closed markets stay visible but
 * unselectable — hiding them makes the app look broken on a weekend, when in
 * fact synthetics trade 24/7 and are the ones most users want anyway.
 */
export default function SymbolPicker({ symbols, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? symbols.filter(
          (s) =>
            s.displayName.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q)
        )
      : symbols;

    const groups = new Map<string, ActiveSymbol[]>();
    for (const s of matched) {
      if (!groups.has(s.market)) groups.set(s.market, []);
      groups.get(s.market)!.push(s);
    }
    // Synthetics first: always open, and the reason most people are here.
    return [...groups.entries()].sort(([a], [b]) =>
      a === "synthetic_index" ? -1 : b === "synthetic_index" ? 1 : a.localeCompare(b)
    );
  }, [symbols, query]);

  const selected = symbols.find((s) => s.symbol === value);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 bg-panel border border-line hover:border-mist rounded-lg px-4 py-3 transition text-left"
      >
        <span className="min-w-0">
          <span className="block font-medium truncate">
            {selected?.displayName ?? "Choose a market"}
          </span>
          <span className="block font-mono text-xs text-mist">
            {selected ? `${selected.symbol} · ${marketLabel(selected.market)}` : "—"}
          </span>
        </span>
        <span className="text-mist text-xs shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full bg-panel border border-line rounded-lg shadow-2xl max-h-96 overflow-y-auto">
          <div className="sticky top-0 bg-panel border-b border-line p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets…"
              className="w-full bg-ink border border-line rounded-md px-3 py-2 text-sm focus:border-signal focus:outline-none"
            />
          </div>

          {grouped.length === 0 && (
            <p className="px-4 py-6 text-sm text-mist text-center">No markets match that.</p>
          )}

          {grouped.map(([market, list]) => (
            <div key={market}>
              <p className="px-4 pt-3 pb-1 font-mono text-[10px] uppercase tracking-widest text-mist">
                {marketLabel(market)}
              </p>
              {list.map((s) => {
                const tradable = s.isOpen && !s.isSuspended;
                return (
                  <button
                    key={s.symbol}
                    disabled={!tradable}
                    onClick={() => {
                      onChange(s.symbol);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`w-full text-left px-4 py-2 flex items-center justify-between gap-2 transition ${
                      s.symbol === value
                        ? "bg-signal/10 text-signal"
                        : tradable
                          ? "hover:bg-ink"
                          : "opacity-40 cursor-not-allowed"
                    }`}
                  >
                    <span className="text-sm truncate">{s.displayName}</span>
                    <span className="font-mono text-[10px] text-mist shrink-0">
                      {tradable ? s.symbol : "closed"}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
