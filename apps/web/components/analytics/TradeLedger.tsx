"use client";

import { useMemo, useRef, useState } from "react";
import type { AnalyticsTrade } from "@tradezaki/core";

/**
 * The settled-trade ledger, with the controls an analytics page owes its reader.
 *
 * The previous version was a fixed list of the 200 most recent trades behind
 * five filter chips, which is fine for glancing at and useless for answering a
 * question. Everything here exists to answer one: *how did I do on this market,
 * with this contract, when the bot was running?*
 *
 * The filtered subtotal is the important part. Narrowing to R_100 DIGITEVEN and
 * being told the net across exactly those trades is the whole reason to filter
 * at all — a list that filters but does not re-total makes the reader do
 * arithmetic the page already knows.
 */

type SortKey = "time" | "stake" | "profit";
type SortDir = "asc" | "desc";

const PAGE = 50;

export default function TradeLedger({
  trades,
  currency,
  emptyHint,
}: {
  trades: AnalyticsTrade[];
  currency: string;
  emptyHint: string;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<"all" | "won" | "lost">("all");
  const [source, setSource] = useState<"all" | "bot" | "manual">("all");
  const [symbol, setSymbol] = useState("all");
  const [contract, setContract] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [shown, setShown] = useState(PAGE);

  /**
   * Expanding the list pushes the controls off screen, and the whole point of
   * the controls is that you keep adjusting them. Scrolling the ledger's own
   * top back into view is the reliable way home: this page scrolls inside a
   * container rather than the window, so window.scrollTo would do nothing.
   */
  const topRef = useRef<HTMLDivElement>(null);
  const backToFilters = () =>
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Options come from the data, not a hardcoded list: a market the user has
  // never traded should not be offered as a filter that returns nothing.
  const symbols = useMemo(
    () => [...new Set(trades.map((t) => t.symbol))].sort(),
    [trades]
  );
  const contracts = useMemo(
    () => [...new Set(trades.map((t) => t.contractType))].sort(),
    [trades]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = trades.filter((t) => {
      if (result !== "all" && t.result !== result) return false;
      if (source !== "all" && t.source !== source) return false;
      if (symbol !== "all" && t.symbol !== symbol) return false;
      if (contract !== "all" && t.contractType !== contract) return false;
      if (!q) return true;
      // Contract id included so a trade can be found from a Deriv statement.
      return (
        t.symbol.toLowerCase().includes(q) ||
        t.contractType.toLowerCase().includes(q) ||
        t.id.includes(q)
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      if (sortKey === "stake") return (a.stake - b.stake) * dir;
      if (sortKey === "profit") return (a.profit - b.profit) * dir;
      return ((a.settledAt ?? a.openedAt) - (b.settledAt ?? b.openedAt)) * dir;
    });
  }, [trades, query, result, source, symbol, contract, sortKey, sortDir]);

  // Recomputed over the filtered set, which is the point of filtering.
  const subtotal = useMemo(() => {
    const net = filtered.reduce((s, t) => s + t.profit, 0);
    const wins = filtered.filter((t) => t.result === "won").length;
    const staked = filtered.reduce((s, t) => s + t.stake, 0);
    return { net, wins, losses: filtered.length - wins, staked };
  }, [filtered]);

  const dirty =
    query !== "" || result !== "all" || source !== "all" || symbol !== "all" || contract !== "all";

  function reset() {
    setQuery("");
    setResult("all");
    setSource("all");
    setSymbol("all");
    setContract("all");
    setShown(PAGE);
  }

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  /**
   * Exports what is on screen, not everything. Someone who has narrowed to one
   * market and one contract type wants those rows in their spreadsheet — giving
   * them the unfiltered set would silently discard the work they just did.
   */
  function exportCsv() {
    const head = [
      "contract_id",
      "opened_at",
      "settled_at",
      "symbol",
      "contract_type",
      "stake",
      "result",
      "profit",
      "source",
    ];
    const iso = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString());
    // Quote everything and double internal quotes — a symbol or contract type
    // containing a comma would otherwise shift every later column.
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

    const csv = [
      head.join(","),
      ...filtered.map((t) =>
        [
          t.id,
          iso(t.openedAt),
          iso(t.settledAt),
          t.symbol,
          t.contractType,
          t.stake.toFixed(2),
          t.result,
          t.profit.toFixed(2),
          t.source,
        ]
          .map(cell)
          .join(",")
      ),
    ].join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradezaki-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* ---- controls ---- */}
      <div ref={topRef} className="flex flex-wrap items-center gap-2 mb-3 scroll-mt-4">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
          placeholder="Search market, contract or ID"
          className="flex-1 min-w-[180px] bg-ink border border-line rounded-lg px-3 py-1.5 text-[12px] focus:border-signal focus:outline-none placeholder:text-mist/50"
        />

        <Select value={result} onChange={setResult} options={[["all", "Any result"], ["won", "Won"], ["lost", "Lost"]]} />
        <Select value={source} onChange={setSource} options={[["all", "Any source"], ["bot", "Bot"], ["manual", "By hand"]]} />
        <Select
          value={symbol}
          onChange={setSymbol}
          options={[["all", "Any market"], ...symbols.map((s) => [s, s] as [string, string])]}
        />
        <Select
          value={contract}
          onChange={setContract}
          options={[["all", "Any contract"], ...contracts.map((c) => [c, c] as [string, string])]}
        />

        {dirty && (
          <button
            onClick={reset}
            className="px-2.5 py-1.5 rounded-lg border border-line text-mist hover:text-[#E7ECE9] text-[11px] transition"
          >
            Clear
          </button>
        )}

        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="px-2.5 py-1.5 rounded-lg border border-line hover:border-signal hover:text-signal text-[11px] transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>

      {/* ---- subtotal for exactly what is shown ---- */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mb-3 px-3 py-2 rounded-lg bg-line/20 border border-line/60">
        <Metric label={dirty ? "Matching" : "Trades"} value={String(filtered.length)} />
        <Metric label="Won" value={String(subtotal.wins)} />
        <Metric label="Lost" value={String(subtotal.losses)} />
        <Metric
          label="Win rate"
          value={
            filtered.length > 0 ? `${((subtotal.wins / filtered.length) * 100).toFixed(1)}%` : "—"
          }
        />
        <Metric label="Staked" value={subtotal.staked.toFixed(2)} />
        <Metric
          label="Net"
          value={`${subtotal.net >= 0 ? "+" : ""}${subtotal.net.toFixed(2)} ${currency}`}
          tone={subtotal.net > 0 ? "up" : subtotal.net < 0 ? "down" : undefined}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-[12px] text-mist py-8 text-center">
          {trades.length === 0 ? emptyHint : "No trades match these filters."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-[12px] min-w-[600px]">
              <thead>
                <tr className="text-mist font-mono text-[9px] uppercase tracking-widest">
                  <Th sortable active={sortKey === "time"} dir={sortDir} onClick={() => sortBy("time")}>
                    When
                  </Th>
                  <Th>Contract</Th>
                  <Th>Market</Th>
                  <Th>Source</Th>
                  <Th right sortable active={sortKey === "stake"} dir={sortDir} onClick={() => sortBy("stake")}>
                    Stake
                  </Th>
                  <Th right sortable active={sortKey === "profit"} dir={sortDir} onClick={() => sortBy("profit")}>
                    Result
                  </Th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map((t) => (
                  <tr key={t.id} className="border-t border-line/50 hover:bg-line/20 transition">
                    <Td className="text-mist whitespace-nowrap">
                      {new Date(t.settledAt ?? t.openedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Td>
                    <Td>{t.contractType}</Td>
                    <Td className="text-mist">{t.symbol}</Td>
                    <Td>
                      <span
                        className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${
                          t.source === "bot" ? "bg-signal/10 text-signal" : "bg-line text-mist"
                        }`}
                      >
                        {t.source}
                      </span>
                    </Td>
                    <Td right className="text-mist">
                      {t.stake.toFixed(2)}
                    </Td>
                    <Td right>
                      <span className={t.profit >= 0 ? "text-signal" : "text-danger"}>
                        {t.profit >= 0 ? "+" : ""}
                        {t.profit.toFixed(2)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length > PAGE && (
            <div className="flex flex-wrap gap-2 mt-3">
              {shown < filtered.length && (
                <button
                  onClick={() => setShown((n) => n + PAGE)}
                  className="flex-1 min-w-[160px] py-2 rounded-lg border border-line text-mist hover:text-[#E7ECE9] hover:border-mist text-[12px] transition"
                >
                  Show more — {filtered.length - shown} left
                </button>
              )}

              {shown > PAGE && (
                <button
                  onClick={() => {
                    setShown(PAGE);
                    // Collapsing from far down the page would otherwise leave
                    // the reader below the end of a list that just got short.
                    backToFilters();
                  }}
                  className="py-2 px-3.5 rounded-lg border border-line text-mist hover:text-[#E7ECE9] hover:border-mist text-[12px] transition"
                >
                  Show less
                </button>
              )}

              <button
                onClick={backToFilters}
                title="Back to search and filters"
                className="py-2 px-3.5 rounded-lg border border-line text-mist hover:text-signal hover:border-signal text-[12px] transition"
              >
                ↑ Filters
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="bg-ink border border-line rounded-lg px-2 py-1.5 text-[11px] font-mono text-mist focus:border-signal focus:outline-none"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[9px] uppercase tracking-widest text-mist">{label}</span>
      <span
        className={`font-mono text-[12px] tabular-nums ${
          tone === "up" ? "text-signal" : tone === "down" ? "text-danger" : ""
        }`}
      >
        {value}
      </span>
    </span>
  );
}

function Th({
  children,
  right,
  sortable,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  right?: boolean;
  sortable?: boolean;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
}) {
  return (
    <th className={`font-normal pb-2 ${right ? "text-right" : "text-left"}`}>
      {sortable ? (
        <button
          onClick={onClick}
          className={`uppercase tracking-widest transition hover:text-[#E7ECE9] ${
            active ? "text-signal" : ""
          }`}
        >
          {children}
          <span className="ml-1">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function Td({
  children,
  right,
  className = "",
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td className={`py-2 font-mono ${right ? "text-right" : ""} ${className}`}>{children}</td>
  );
}
