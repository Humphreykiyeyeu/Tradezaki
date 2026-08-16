"use client";

import type { AnalyticsTrade, TradeLogEntry } from "@tradezaki/core";
import { isCloudConfigured, supabase } from "@/lib/supabase";

/**
 * Trade history for analytics, from both places it actually lives.
 *
 * Postgres holds every trade a bot has ever placed, on any machine. localStorage
 * holds trades placed by hand from this browser, and only this browser. Neither
 * is complete on its own: the dashboard read only localStorage before, which is
 * why sixty-odd real bot trades were invisible to the page meant to analyse
 * them.
 *
 * Merged and de-duplicated by contract id, since a trade can legitimately
 * appear in both.
 */

export interface HistoryResult {
  trades: AnalyticsTrade[];
  /** True when the database was reachable and returned rows. */
  fromCloud: boolean;
  /** Set when the cloud read failed; local trades are still returned. */
  error: string | null;
}

interface TradeRow {
  contract_id: number;
  bot_id: string | null;
  symbol: string;
  contract_type: string;
  stake: string | number;
  result: "open" | "won" | "lost";
  profit: string | number;
  opened_at: string;
  settled_at: string | null;
}

function fromRow(r: TradeRow): AnalyticsTrade {
  return {
    id: String(r.contract_id),
    openedAt: Date.parse(r.opened_at),
    settledAt: r.settled_at ? Date.parse(r.settled_at) : null,
    symbol: r.symbol,
    contractType: r.contract_type,
    stake: Number(r.stake),
    result: r.result,
    profit: Number(r.profit),
    source: r.bot_id ? "bot" : "manual",
  };
}

/**
 * Local trades carry no settlement timestamp — the log records one moment per
 * trade. Using it for both is honest enough for ordering, and the analytics
 * treat a settled trade's time as its settlement time.
 */
function fromLocal(t: TradeLogEntry): AnalyticsTrade {
  return {
    id: t.id,
    openedAt: t.timestamp,
    settledAt: t.result === "open" ? null : t.timestamp,
    symbol: t.symbol,
    contractType: t.contractType,
    stake: t.stake,
    result: t.result,
    profit: t.profit,
    source: "manual",
  };
}

export async function loadHistory(
  derivAccountId: string,
  localTrades: TradeLogEntry[]
): Promise<HistoryResult> {
  const local = localTrades.map(fromLocal);

  if (!isCloudConfigured) {
    return { trades: local, fromCloud: false, error: null };
  }

  try {
    const { data: auth } = await supabase().auth.getUser();
    if (!auth.user) return { trades: local, fromCloud: false, error: null };

    // Row-level security scopes this to the signed-in user; the account filter
    // is what keeps demo and real apart, which matters more here than anywhere
    // else on the site — mixing them would report practice profits as real.
    const { data, error } = await supabase()
      .from("trades")
      .select(
        "contract_id, bot_id, symbol, contract_type, stake, result, profit, opened_at, settled_at"
      )
      .eq("deriv_account_id", derivAccountId)
      .order("opened_at", { ascending: false })
      .limit(5000);

    if (error) return { trades: local, fromCloud: false, error: error.message };

    const cloud = (data ?? []).map((r) => fromRow(r as unknown as TradeRow));

    const byId = new Map<string, AnalyticsTrade>();
    // Cloud first, then local fills gaps. A trade in both is the same trade, and
    // the database copy is the one a second device would also see.
    for (const t of cloud) byId.set(t.id, t);
    for (const t of local) if (!byId.has(t.id)) byId.set(t.id, t);

    return { trades: [...byId.values()], fromCloud: true, error: null };
  } catch (e) {
    return {
      trades: local,
      fromCloud: false,
      error: e instanceof Error ? e.message : "Could not load your trade history.",
    };
  }
}

export type Range = "today" | "7d" | "30d" | "all";

export const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "all", label: "All" },
];

export function since(range: Range, now = Date.now()): number {
  if (range === "all") return 0;
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return now - (range === "7d" ? 7 : 30) * 86_400_000;
}

export function withinRange(trades: AnalyticsTrade[], range: Range, now = Date.now()) {
  const from = since(range, now);
  return trades.filter((t) => (t.settledAt ?? t.openedAt) >= from);
}
