"use client";

import { useDeriv } from "@/components/DerivProvider";

/**
 * Live open contracts. Deriv pushes an update every tick, so profit here moves
 * in real time — and anything Deriv says is sellable gets a Close button, which
 * is the only way out of a running Accumulator or Multiplier.
 */
export default function OpenPositions({ compact = false }: { compact?: boolean }) {
  const { openContracts, currency, sell, selling } = useDeriv();

  if (openContracts.length === 0) {
    return <p className="p-4 text-xs text-mist">No open positions.</p>;
  }

  return (
    <ul className="divide-y divide-line/60">
      {openContracts.map((c) => {
        const up = c.profit >= 0;
        const ticks =
          c.tickCount && c.tickPassed !== null
            ? `${c.tickPassed}/${c.tickCount} ticks`
            : c.growthRate
              ? `${(c.growthRate * 100).toFixed(0)}% per tick`
              : null;

        return (
          <li key={c.contractId} className="px-4 py-2.5 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[12px] truncate">
                {c.contractType}
                <span className="text-mist"> · {c.symbol}</span>
              </p>
              <p className="font-mono text-[10px] text-mist">
                {c.buyPrice.toFixed(2)} {currency}
                {ticks ? ` · ${ticks}` : ""}
              </p>
            </div>

            <div className="text-right shrink-0">
              <p className={`font-mono text-sm ${up ? "text-signal" : "text-danger"}`}>
                {up ? "+" : ""}
                {c.profit.toFixed(2)}
              </p>
              {!compact && (
                <p className="font-mono text-[10px] text-mist">
                  now {c.bidPrice.toFixed(2)}
                </p>
              )}
            </div>

            {/* Only offered when Deriv says the contract can actually be sold —
                most short tick contracts cannot be closed early. */}
            {c.isValidToSell && (
              <button
                onClick={() => sell(c.contractId)}
                disabled={selling === c.contractId}
                className="shrink-0 text-[11px] border border-line hover:border-danger hover:text-danger rounded-md px-2.5 py-1.5 transition disabled:opacity-50"
              >
                {selling === c.contractId ? "…" : "Close"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
