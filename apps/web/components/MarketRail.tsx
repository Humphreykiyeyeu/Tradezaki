"use client";

import { useMemo, useState } from "react";
import { useDeriv } from "@/components/DerivProvider";
import { marketLabel } from "@/lib/contracts";

/**
 * Persistent market list. A dropdown hides what you're not looking at; a rail
 * lets you see the whole board and switch in one click, which is what a trading
 * terminal is for.
 */
export default function MarketRail({ onPick }: { onPick?: () => void }) {
  const { symbols, symbol, setSymbol } = useDeriv();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? symbols.filter(
          (s) => s.displayName.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q)
        )
      : symbols;

    const map = new Map<string, typeof matched>();
    for (const s of matched) {
      if (!map.has(s.market)) map.set(s.market, []);
      map.get(s.market)!.push(s);
    }
    // Synthetics first — they trade 24/7, which is why most people are here.
    return [...map.entries()].sort(([a], [b]) =>
      a === "synthetic_index" ? -1 : b === "synthetic_index" ? 1 : a.localeCompare(b)
    );
  }, [symbols, query]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-2.5 border-b border-line shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search markets…"
          className="w-full bg-ink border border-line rounded-md px-3 py-2 text-sm placeholder:text-mist/60 focus:border-signal focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {symbols.length === 0 && (
          <p className="p-4 text-xs text-mist">Loading markets…</p>
        )}

        {groups.map(([market, list]) => (
          <section key={market}>
            <h3 className="px-3 pt-3 pb-1 font-mono text-[9px] uppercase tracking-widest text-mist/70 sticky top-0 bg-panel/95 backdrop-blur">
              {marketLabel(market)}
            </h3>
            {list.map((s) => {
              const on = s.symbol === symbol;
              const tradable = s.isOpen && !s.isSuspended;
              return (
                <button
                  key={s.symbol}
                  disabled={!tradable}
                  onClick={() => {
                    setSymbol(s.symbol);
                    onPick?.();
                  }}
                  className={`w-full text-left px-3 py-2 border-l-2 transition ${
                    on
                      ? "border-signal bg-signal/10 text-signal"
                      : tradable
                        ? "border-transparent text-mist hover:text-[#E7ECE9] hover:bg-line/40"
                        : "border-transparent opacity-35 cursor-not-allowed"
                  }`}
                >
                  <span className="block text-[13px] leading-tight truncate">{s.displayName}</span>
                  <span className="block font-mono text-[10px] text-mist/70">
                    {tradable ? s.symbol : "closed"}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
