"use client";

import { useMemo, useRef, useState } from "react";
import type { AnalyticsTrade } from "@tradezaki/core";

/**
 * The settled-trade ledger: search, filter, sort, export.
 *
 * Everything here exists to answer one question — *how did I do on this market,
 * with this contract, in this stretch of time?* The filtered subtotal is the
 * important part: narrowing the list and then being told the net across exactly
 * those trades is the whole reason to filter. A list that filters without
 * re-totalling leaves the reader doing arithmetic the page already knows.
 *
 * Only search and export stay on the bar. Six controls spread across the top
 * cost more attention than they earn, and most of them sit at their default
 * most of the time — so the rest fold into one Filters button that carries a
 * count when any of them are active. The count matters: a hidden filter that
 * silently excludes trades is how someone concludes their bot stopped working.
 */

type SortKey = "time" | "stake" | "profit";
type SortDir = "asc" | "desc";

const PAGE = 50;

/** Local midnight, so a date typed by the user means their day, not UTC's. */
const startOfDay = (d: string) => new Date(`${d}T00:00:00`).getTime();
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999`).getTime();

export default function TradeLedger({
  trades,
  currency,
  emptyHint,
  marketName,
}: {
  trades: AnalyticsTrade[];
  currency: string;
  emptyHint: string;
  /** Deriv's code to its readable name — R_10 to "Volatility 10 Index". */
  marketName?: (symbol: string) => string;
}) {
  const label = (s: string) => marketName?.(s) ?? s;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<"all" | "won" | "lost">("all");
  const [source, setSource] = useState<"all" | "bot" | "manual">("all");
  const [symbol, setSymbol] = useState("all");
  const [contract, setContract] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [panelOpen, setPanelOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [shown, setShown] = useState(PAGE);

  /**
   * Expanding the list pushes the controls off screen. Scrolling the ledger's
   * own top back into view is the reliable way home: this page scrolls inside a
   * container rather than the window, so window.scrollTo would do nothing.
   */
  const topRef = useRef<HTMLDivElement>(null);
  const backToTop = () => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Options come from the data: a market the user has never traded should not be
  // offered as a filter that returns nothing.
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const contracts = useMemo(
    () => [...new Set(trades.map((t) => t.contractType))].sort(),
    [trades]
  );

  const activeCount =
    (result !== "all" ? 1 : 0) +
    (source !== "all" ? 1 : 0) +
    (symbol !== "all" ? 1 : 0) +
    (contract !== "all" ? 1 : 0) +
    (from !== "" ? 1 : 0) +
    (to !== "" ? 1 : 0);

  const dirty = activeCount > 0 || query !== "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fromMs = from ? startOfDay(from) : null;
    const toMs = to ? endOfDay(to) : null;

    const rows = trades.filter((t) => {
      if (result !== "all" && t.result !== result) return false;
      if (source !== "all" && t.source !== source) return false;
      if (symbol !== "all" && t.symbol !== symbol) return false;
      if (contract !== "all" && t.contractType !== contract) return false;

      const at = t.settledAt ?? t.openedAt;
      if (fromMs !== null && at < fromMs) return false;
      if (toMs !== null && at > toMs) return false;

      if (!q) return true;
      // Contract id included so a row can be found from a Deriv statement.
      // Both the code and the readable name are searchable: someone may type
      // "volatility" having never seen "R_100", or paste a code from a
      // statement having never seen the name.
      return (
        t.symbol.toLowerCase().includes(q) ||
        label(t.symbol).toLowerCase().includes(q) ||
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, query, result, source, symbol, contract, from, to, sortKey, sortDir, marketName]);

  // Recomputed over the filtered set, which is the point of filtering.
  const subtotal = useMemo(() => {
    const net = filtered.reduce((s, t) => s + t.profit, 0);
    const wins = filtered.filter((t) => t.result === "won").length;
    const staked = filtered.reduce((s, t) => s + t.stake, 0);
    return { net, wins, losses: filtered.length - wins, staked };
  }, [filtered]);

  function reset() {
    setQuery("");
    setResult("all");
    setSource("all");
    setSymbol("all");
    setContract("all");
    setFrom("");
    setTo("");
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
   * market wants those rows in their spreadsheet — handing over the lot would
   * silently discard the work they just did.
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
    // Quote everything and double internal quotes — a value containing a comma
    // would otherwise shift every later column.
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
      {/* ---- bar: the two controls worth permanent space ---- */}
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

        <button
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          className={`px-3 py-1.5 rounded-lg border text-[12px] transition ${
            activeCount > 0
              ? "border-signal/50 text-signal bg-signal/5"
              : "border-line text-mist hover:text-[#E7ECE9] hover:border-mist"
          }`}
        >
          Filters
          {activeCount > 0 && (
            <span className="ml-1.5 font-mono text-[10px] px-1.5 py-0.5 rounded bg-signal/20">
              {activeCount}
            </span>
          )}
          <span className="ml-1.5 text-mist">{panelOpen ? "▴" : "▾"}</span>
        </button>

        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="px-3 py-1.5 rounded-lg border border-line text-mist hover:border-signal hover:text-signal text-[12px] transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>

      {/* ---- the rest, folded away until wanted ---- */}
      {panelOpen && (
        <div className="mb-3 p-3 rounded-lg border border-line bg-ink/40">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Labelled label="Result">
              <Select
                value={result}
                onChange={setResult}
                options={[
                  ["all", "Any"],
                  ["won", "Won"],
                  ["lost", "Lost"],
                ]}
              />
            </Labelled>
            <Labelled label="Source">
              <Select
                value={source}
                onChange={setSource}
                options={[
                  ["all", "Any"],
                  ["bot", "Bot"],
                  ["manual", "By hand"],
                ]}
              />
            </Labelled>
            <Labelled label="Market">
              <Select
                value={symbol}
                onChange={setSymbol}
                options={[["all", "Any"], ...symbols.map((s) => [s, label(s)] as [string, string])]}
              />
            </Labelled>
            <Labelled label="Contract">
              <Select
                value={contract}
                onChange={setContract}
                options={[["all", "Any"], ...contracts.map((c) => [c, c] as [string, string])]}
              />
            </Labelled>

            {/* Narrows inside the period chosen at the top of the page rather
                than replacing it, so the two time controls cannot disagree. */}
            <Labelled label="From">
              <DateInput value={from} onChange={setFrom} />
            </Labelled>
            <Labelled label="To">
              <DateInput value={to} onChange={setTo} />
            </Labelled>
          </div>

          {dirty && (
            <button
              onClick={reset}
              className="mt-3 px-2.5 py-1.5 rounded-lg border border-line text-mist hover:text-[#E7ECE9] text-[11px] transition"
            >
              Clear all
            </button>
          )}
        </div>
      )}

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
                    <Td className="text-mist">{label(t.symbol)}</Td>
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

              {/* Collapses only. Scrolling as well took the reader somewhere
                  they had not asked to go, and the arrow does that on request. */}
              {shown > PAGE && (
                <button
                  onClick={() => setShown(PAGE)}
                  className="py-2 px-3.5 rounded-lg border border-line text-mist hover:text-[#E7ECE9] hover:border-mist text-[12px] transition"
                >
                  Show less
                </button>
              )}

              <button
                onClick={backToTop}
                aria-label="Back to the top of the list"
                title="Back to the top of the list"
                className="py-2 px-3.5 rounded-lg border border-line text-mist hover:text-signal hover:border-signal text-[12px] transition"
              >
                ↑
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-widest text-mist">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
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
      className="w-full bg-ink border border-line rounded-lg px-2 py-1.5 text-[11px] font-mono text-mist focus:border-signal focus:outline-none"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-ink border border-line rounded-lg px-2 py-1.5 text-[11px] font-mono text-mist focus:border-signal focus:outline-none"
    />
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
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
  return <td className={`py-2 font-mono ${right ? "text-right" : ""} ${className}`}>{children}</td>;
}
