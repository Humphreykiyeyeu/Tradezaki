"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activityBuckets,
  breakdownBy,
  equityCurve,
  summarise,
  type AnalyticsTrade,
} from "@tradezaki/core";
import { useDeriv } from "@/components/DerivProvider";
import OpenPositions from "@/components/OpenPositions";
import StatTile from "@/components/analytics/StatTile";
import EquityChart from "@/components/analytics/EquityChart";
import BreakdownBars from "@/components/analytics/BreakdownBars";
import ActivityChart from "@/components/analytics/ActivityChart";
import { RANGES, loadHistory, withinRange, type Range } from "@/lib/history";

/**
 * Positions & analytics.
 *
 * Two halves with different guarantees, and the page says which is which. The
 * top is live: open contracts streaming from Deriv, updating every tick. The
 * rest is history read from the database, which is the only place a bot's
 * trades exist — this page used to read localStorage alone and therefore could
 * not see a single trade any bot had ever placed.
 *
 * Every number here is computed from real rows. Where there is no data there is
 * an empty state saying so, never a placeholder figure.
 */
export default function PositionsPage() {
  const { accountTrades, currency, account, activeId, openContracts, balance } = useDeriv();

  const [range, setRange] = useState<Range>("30d");
  const [history, setHistory] = useState<AnalyticsTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCloud, setFromCloud] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "won" | "lost" | "bot" | "manual">("all");

  // Held in a ref, not a dependency. Depending on accountTrades would refetch
  // the entire history every time a live contract ticked; capturing it in the
  // closure instead would freeze it at mount, so pressing Refresh after placing
  // a trade by hand would not show it. The ref gives the latest value without
  // re-creating the callback.
  const localRef = useRef(accountTrades);
  localRef.current = accountTrades;

  const refresh = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    const r = await loadHistory(activeId, localRef.current);
    setHistory(r.trades);
    setFromCloud(r.fromCloud);
    setError(r.error);
    setLoadedAt(Date.now());
    setLoading(false);
  }, [activeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inRange = useMemo(() => withinRange(history, range), [history, range]);
  const summary = useMemo(() => summarise(inRange), [inRange]);
  const curve = useMemo(() => equityCurve(inRange), [inRange]);
  const bySymbol = useMemo(() => breakdownBy(inRange, "symbol"), [inRange]);
  const byType = useMemo(() => breakdownBy(inRange, "contractType"), [inRange]);
  const bySource = useMemo(() => breakdownBy(inRange, "source"), [inRange]);

  // Bucket size follows the window so the chart always has a readable number of
  // columns rather than one per hour across a month.
  const { buckets, format } = useMemo(() => {
    const now = Date.now();
    if (range === "today") {
      return {
        buckets: activityBuckets(inRange, 3_600_000, now, 24),
        format: (t: number) => `${new Date(t).getHours()}:00`,
      };
    }
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 60;
    return {
      buckets: activityBuckets(inRange, 86_400_000, now, days),
      format: (t: number) =>
        new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    };
  }, [inRange, range]);

  const exposure = openContracts.reduce((s, c) => s + c.buyPrice, 0);
  const runningPL = openContracts.reduce((s, c) => s + c.profit, 0);
  const largestOpen = openContracts.reduce((m, c) => Math.max(m, c.buyPrice), 0);
  const exposurePct = balance && balance > 0 ? (exposure / balance) * 100 : null;

  const settled = useMemo(() => {
    const rows = [...inRange]
      .filter((t) => t.result !== "open")
      .sort((a, b) => (b.settledAt ?? b.openedAt) - (a.settledAt ?? a.openedAt));
    if (filter === "won" || filter === "lost") return rows.filter((t) => t.result === filter);
    if (filter === "bot" || filter === "manual") return rows.filter((t) => t.source === filter);
    return rows;
  }, [inRange, filter]);

  const money = (n: number, sign = true) =>
    `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)} ${currency}`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        {/* ---------------------------------------------------------- header */}
        <header className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="font-display font-bold text-2xl">Positions &amp; analytics</h1>
            <p className="text-sm text-mist mt-1">
              {account ? (
                <>
                  <span
                    className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
                      account.accountType === "demo"
                        ? "bg-signal/15 text-signal"
                        : "bg-ocean/15 text-ocean"
                    }`}
                  >
                    {account.accountType === "demo" ? "DEMO" : "REAL"}
                  </span>{" "}
                  <span className="font-mono text-[12px]">{account.accountId}</span>
                </>
              ) : (
                "No account selected"
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-line overflow-hidden">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={`px-2.5 py-1.5 font-mono text-[11px] transition ${
                    range === r.id
                      ? "bg-signal/15 text-signal"
                      : "text-mist hover:text-[#E7ECE9]"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="px-2.5 py-1.5 rounded-lg border border-line text-mist hover:text-[#E7ECE9] hover:border-mist font-mono text-[11px] transition disabled:opacity-50"
            >
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </header>

        {error && (
          <p className="text-[12px] text-alert bg-alert/10 border border-alert/30 rounded-lg px-3 py-2 mb-4">
            Showing trades from this device only — {error}
          </p>
        )}

        {/* ------------------------------------------------------------ live */}
        <section className="mb-6">
          <SectionHead
            title="Open now"
            live
            note={
              loadedAt
                ? `history updated ${new Date(loadedAt).toLocaleTimeString()}`
                : undefined
            }
          />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <StatTile label="Open positions" value={String(openContracts.length)} />
            <StatTile
              label="At risk"
              value={money(exposure, false)}
              sub={exposurePct !== null ? `${exposurePct.toFixed(1)}% of balance` : undefined}
              hint="Total stake on contracts that have not settled. This is the most you can lose right now."
            />
            <StatTile
              label="Running P/L"
              value={money(runningPL)}
              tone={runningPL > 0 ? "up" : runningPL < 0 ? "down" : "neutral"}
              hint="What your open contracts are worth if they settled at the current price. It moves every tick."
            />
            <StatTile
              label="Largest position"
              value={money(largestOpen, false)}
              hint="The biggest single stake currently open. A large number here means your risk is concentrated in one trade."
            />
          </div>

          <div className="border border-line rounded-xl bg-panel/50 overflow-hidden">
            <OpenPositions />
          </div>
        </section>

        {/* -------------------------------------------------------- headline */}
        <SectionHead
          title="Performance"
          note={
            fromCloud
              ? `${history.length} trades on record`
              : "this device only — sign in to include bot trades"
          }
        />

        {loading && history.length === 0 ? (
          <SkeletonGrid />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <StatTile
              label="Net P/L"
              value={summary.trades > 0 ? money(summary.netProfit) : "—"}
              sub={
                summary.returnOnStake !== null
                  ? `${(summary.returnOnStake * 100).toFixed(1)}% of ${summary.totalStaked.toFixed(0)} staked`
                  : undefined
              }
              tone={summary.netProfit > 0 ? "up" : summary.netProfit < 0 ? "down" : "neutral"}
            />
            <StatTile
              label="Win rate"
              value={summary.winRate !== null ? `${(summary.winRate * 100).toFixed(1)}%` : "—"}
              sub={`${summary.wins}W / ${summary.losses}L`}
            />
            <StatTile
              label="Profit factor"
              value={summary.profitFactor !== null ? summary.profitFactor.toFixed(2) : "—"}
              tone={
                summary.profitFactor === null
                  ? "neutral"
                  : summary.profitFactor >= 1
                    ? "up"
                    : "down"
              }
              hint="Money won divided by money lost. Above 1.00 means you are ahead overall. Below 1.00 means the losses are bigger than the wins."
            />
            <StatTile
              label="Max drawdown"
              value={summary.trades > 0 ? `-${summary.maxDrawdown.toFixed(2)}` : "—"}
              tone={summary.maxDrawdown > 0 ? "down" : "neutral"}
              hint="The worst drop from a high point to a later low point. It is how far down you went before recovering — the number that decides whether you can stomach the strategy."
            />
          </div>
        )}

        {/* ------------------------------------------------------------ curve */}
        <div className="grid lg:grid-cols-3 gap-4 mb-5">
          <Card className="lg:col-span-2">
            <CardTitle
              title="Running profit"
              note={`${curve.length} settled ${curve.length === 1 ? "trade" : "trades"}`}
            />
            <EquityChart points={curve} currency={currency} />
          </Card>

          <Card>
            <CardTitle title="Win / loss detail" />
            {summary.trades === 0 ? (
              <Empty>Nothing settled in this period.</Empty>
            ) : (
              <dl className="space-y-2">
                <Row label="Average win" value={money(summary.avgWin ?? 0)} tone="up" />
                <Row label="Average loss" value={money(summary.avgLoss ?? 0)} tone="down" />
                <Row
                  label="Best trade"
                  value={summary.bestTrade ? money(summary.bestTrade.profit) : "—"}
                  tone="up"
                />
                <Row
                  label="Worst trade"
                  value={summary.worstTrade ? money(summary.worstTrade.profit) : "—"}
                  tone="down"
                />
                <Row label="Longest win run" value={`${summary.longestWinStreak}`} />
                <Row label="Longest loss run" value={`${summary.longestLossStreak}`} />
                <Row
                  label="Current run"
                  value={
                    summary.currentStreak.kind === "none"
                      ? "—"
                      : `${summary.currentStreak.count} ${summary.currentStreak.kind === "won" ? "wins" : "losses"}`
                  }
                  tone={
                    summary.currentStreak.kind === "won"
                      ? "up"
                      : summary.currentStreak.kind === "lost"
                        ? "down"
                        : undefined
                  }
                />
                <Row
                  label="Typical hold"
                  value={
                    summary.medianHoldSeconds !== null
                      ? `${summary.medianHoldSeconds.toFixed(0)}s`
                      : "—"
                  }
                />
              </dl>
            )}
          </Card>
        </div>

        {/* -------------------------------------------------------- activity */}
        <Card className="mb-5">
          <CardTitle title="Trading activity" note={range === "today" ? "by hour" : "by day"} />
          <ActivityChart buckets={buckets} format={format} />
        </Card>

        {/* ------------------------------------------------------- breakdown */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
          <Card>
            <CardTitle title="By market" />
            <BreakdownBars rows={bySymbol} currency={currency} />
          </Card>
          <Card>
            <CardTitle title="By contract type" />
            <BreakdownBars rows={byType} currency={currency} />
          </Card>
          <Card className="md:col-span-2 lg:col-span-1">
            <CardTitle title="Bot vs by hand" />
            <BreakdownBars
              rows={bySource}
              currency={currency}
              emptyLabel="No settled trades to compare."
            />
          </Card>
        </div>

        {/* ---------------------------------------------------------- ledger */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <CardTitle title="Settled trades" note={`${settled.length} shown`} inline />
            <div className="flex rounded-lg border border-line overflow-hidden">
              {(["all", "won", "lost", "bot", "manual"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 font-mono text-[10px] capitalize transition ${
                    filter === f ? "bg-line text-[#E7ECE9]" : "text-mist hover:text-[#E7ECE9]"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {settled.length === 0 ? (
            <Empty>
              {history.length === 0
                ? "No trades yet. Start a bot or place one from the Trade page and it will appear here."
                : "No trades match this filter."}
            </Empty>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-[12px] min-w-[560px]">
                <thead>
                  <tr className="text-mist font-mono text-[9px] uppercase tracking-widest">
                    <Th>When</Th>
                    <Th>Contract</Th>
                    <Th>Market</Th>
                    <Th>Source</Th>
                    <Th right>Stake</Th>
                    <Th right>Result</Th>
                  </tr>
                </thead>
                <tbody>
                  {settled.slice(0, 200).map((t) => (
                    <tr key={t.id} className="border-t border-line/50 hover:bg-line/20 transition">
                      <Td className="text-mist">
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
                            t.source === "bot"
                              ? "bg-signal/10 text-signal"
                              : "bg-line text-mist"
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
              {settled.length > 200 && (
                <p className="font-mono text-[10px] text-mist pt-3">
                  Showing the 200 most recent of {settled.length}.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function SectionHead({
  title,
  live,
  note,
}: {
  title: string;
  live?: boolean;
  note?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-mist">{title}</h2>
      {live && (
        <span className="flex items-center gap-1 font-mono text-[9px] text-signal">
          <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse" />
          LIVE
        </span>
      )}
      {note && <span className="font-mono text-[9px] text-mist/70 ml-auto">{note}</span>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`border border-line rounded-xl bg-panel/50 p-4 ${className}`}>
      {children}
    </section>
  );
}

function CardTitle({
  title,
  note,
  inline,
}: {
  title: string;
  note?: string;
  inline?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${inline ? "" : "mb-3"}`}>
      <h3 className="font-mono text-[10px] uppercase tracking-widest text-mist">{title}</h3>
      {note && <span className="font-mono text-[9px] text-mist/70">{note}</span>}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12px] text-mist">{label}</dt>
      <dd
        className={`font-mono text-[12px] tabular-nums ${
          tone === "up" ? "text-signal" : tone === "down" ? "text-danger" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-mist py-6 text-center">{children}</p>;
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`font-normal pb-2 ${right ? "text-right" : "text-left"}`}>{children}</th>;
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

/** Skeletons rather than a blank area — the layout should not jump on load. */
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="border border-line rounded-xl p-3.5 bg-panel/60">
          <div className="h-2 w-16 rounded bg-line animate-pulse mb-3" />
          <div className="h-5 w-20 rounded bg-line animate-pulse" />
        </div>
      ))}
    </div>
  );
}
