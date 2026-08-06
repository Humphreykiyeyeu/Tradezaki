"use client";

import { useState } from "react";
import { useDeriv } from "@/components/DerivProvider";
import MarketRail from "@/components/MarketRail";
import TradeTicket from "@/components/TradeTicket";
import TickChart from "@/components/TickChart";

export default function TradePage() {
  const { activeSymbol, symbol, ticks, spot, accountTrades, currency, chartBarrier } =
    useDeriv();
  const [railOpen, setRailOpen] = useState(false);

  const open = accountTrades.filter((t) => t.result === "open");
  const recent = [...accountTrades].reverse().slice(0, 20);

  // pip_size arrives as 0.01 / 0.001 — decimals is what toFixed wants.
  const decimals = activeSymbol ? String(activeSymbol.pipSize).split(".")[1]?.length ?? 2 : 2;

  const change =
    ticks.length > 1 ? ((ticks[ticks.length - 1].quote - ticks[0].quote) / ticks[0].quote) * 100 : 0;

  return (
    <div className="h-full flex">
      {/* Market rail — a drawer on mobile, always-on from lg up */}
      <aside className="hidden lg:flex w-60 shrink-0 border-r border-line bg-panel/40 flex-col">
        <MarketRail />
      </aside>

      {railOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="w-72 bg-panel border-r border-line">
            <MarketRail onPick={() => setRailOpen(false)} />
          </div>
          <button
            className="flex-1 bg-ink/70 backdrop-blur-sm"
            onClick={() => setRailOpen(false)}
            aria-label="Close markets"
          />
        </div>
      )}

      {/* Centre: chart + activity */}
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 border-b border-line px-4 py-2.5 flex items-center gap-3">
          <button
            onClick={() => setRailOpen(true)}
            className="lg:hidden px-2.5 py-1.5 rounded-md border border-line text-mist text-xs"
          >
            Markets
          </button>
          <div className="min-w-0">
            <h1 className="font-medium truncate leading-tight">
              {activeSymbol?.displayName ?? symbol ?? "—"}
            </h1>
            <p className="font-mono text-[10px] text-mist">{symbol}</p>
          </div>
          <div className="flex-1" />
          {spot !== null && (
            <div className="text-right">
              <p className="font-mono text-lg leading-tight">{spot.toFixed(decimals)}</p>
              <p
                className={`font-mono text-[10px] ${change >= 0 ? "text-signal" : "text-danger"}`}
              >
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(3)}%
              </p>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-4">
            <TickChart
              ticks={ticks}
              pipSize={decimals}
              barrier={chartBarrier}
              symbolName={activeSymbol?.displayName ?? symbol ?? ""}
            />
          </div>

          {/* Last digits — the reason digit contracts are readable at a glance */}
          {ticks.length > 0 && (
            <div className="px-4 pb-4">
              <p className="font-mono text-[9px] uppercase tracking-widest text-mist mb-2">
                Last digits
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {ticks.slice(-12).map((t, i, arr) => {
                  const d = Number(t.quote.toFixed(decimals).slice(-1));
                  const latest = i === arr.length - 1;
                  return (
                    <span
                      key={t.epoch + "-" + i}
                      className={`w-8 h-8 grid place-items-center rounded-md font-mono text-sm border ${
                        latest
                          ? "border-signal text-signal bg-signal/10"
                          : "border-line text-mist"
                      }`}
                    >
                      {d}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border-t border-line">
            <Activity open={open} recent={recent} currency={currency} />
          </div>
        </div>
      </main>

      {/* Ticket */}
      <aside className="hidden md:flex w-[340px] shrink-0 border-l border-line bg-panel/40 flex-col">
        <TradeTicket />
      </aside>

      {/* On mobile the ticket becomes the bottom half of the screen */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-[58dvh] border-t border-line bg-panel z-30">
        <TradeTicket />
      </div>
    </div>
  );
}

function Activity({
  open,
  recent,
  currency,
}: {
  open: { id: string; contractType: string; symbol: string; stake: number }[];
  recent: { id: string; contractType: string; result: string; profit: number; stake: number }[];
  currency: string;
}) {
  const [tab, setTab] = useState<"open" | "journal">("open");
  const list = tab === "open" ? open : recent;

  return (
    <div className="pb-[60dvh] md:pb-0">
      <div className="flex border-b border-line">
        {(["open", "journal"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs transition border-b-2 -mb-px ${
              tab === t
                ? "border-signal text-signal"
                : "border-transparent text-mist hover:text-[#E7ECE9]"
            }`}
          >
            {t === "open" ? `Open (${open.length})` : "Journal"}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="p-4 text-xs text-mist">
          {tab === "open" ? "No open positions." : "No trades yet."}
        </p>
      ) : (
        <table className="w-full text-[12px]">
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className="border-b border-line/60">
                <td className="px-4 py-2 font-mono text-mist">{t.contractType}</td>
                <td className="px-4 py-2 font-mono text-right text-mist">
                  {t.stake.toFixed(2)} {currency}
                </td>
                <td className="px-4 py-2 font-mono text-right">
                  {"result" in t && t.result !== "open" ? (
                    <span className={t.profit >= 0 ? "text-signal" : "text-danger"}>
                      {t.profit >= 0 ? "+" : ""}
                      {t.profit.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-alert">open</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
