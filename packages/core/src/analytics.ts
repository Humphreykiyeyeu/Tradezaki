import type { TradeLogEntry } from "./types";

/**
 * Trading analytics — pure functions over a list of settled trades.
 *
 * No storage, no clock of its own, no platform APIs, in keeping with the rest
 * of core. The caller supplies the trades and, where it matters, the time.
 *
 * A deliberate note on what is NOT here. Sharpe ratio, alpha, beta and their
 * relatives assume a continuously-valued position and a returns series measured
 * over equal periods. A Deriv digital option is a discrete binary bet that
 * resolves in seconds; computing a Sharpe over those produces a number that
 * looks authoritative and means nothing. The metrics below are the ones that
 * survive contact with this instrument: they all reduce to counting money,
 * counting outcomes, or measuring the worst stretch.
 */

export interface AnalyticsTrade {
  id: string;
  /** When the contract was bought. */
  openedAt: number;
  /** When it settled, if it has. */
  settledAt: number | null;
  symbol: string;
  contractType: string;
  stake: number;
  result: "open" | "won" | "lost";
  profit: number;
  /** Bot trades and hand-placed trades are worth telling apart. */
  source: "bot" | "manual";
}

export interface Streak {
  kind: "won" | "lost" | "none";
  count: number;
}

export interface PerformanceSummary {
  trades: number;
  wins: number;
  losses: number;
  /** 0–1. Null when nothing has settled, which is not the same as zero. */
  winRate: number | null;
  netProfit: number;
  grossWin: number;
  /** Positive number representing total losses. */
  grossLoss: number;
  /**
   * Gross win ÷ gross loss. Above 1 means the wins outweigh the losses.
   * Null when nothing has been lost yet — dividing by zero would report an
   * infinitely good strategy on the back of a single winning trade.
   */
  profitFactor: number | null;
  avgTrade: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  bestTrade: AnalyticsTrade | null;
  worstTrade: AnalyticsTrade | null;
  /** Worst peak-to-trough fall of cumulative profit, as a positive number. */
  maxDrawdown: number;
  currentStreak: Streak;
  longestWinStreak: number;
  longestLossStreak: number;
  totalStaked: number;
  /** Net profit as a fraction of everything staked. */
  returnOnStake: number | null;
  /** Median seconds from buy to settle, for trades that have settled. */
  medianHoldSeconds: number | null;
}

const settledOnly = (trades: AnalyticsTrade[]) => trades.filter((t) => t.result !== "open");

/** Oldest first. Every sequence metric below depends on this ordering. */
const chronological = (trades: AnalyticsTrade[]) =>
  [...trades].sort((a, b) => (a.settledAt ?? a.openedAt) - (b.settledAt ?? b.openedAt));

export function summarise(input: AnalyticsTrade[]): PerformanceSummary {
  const trades = chronological(settledOnly(input));
  const wins = trades.filter((t) => t.result === "won");
  const losses = trades.filter((t) => t.result === "lost");

  const grossWin = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const netProfit = grossWin - grossLoss;
  const totalStaked = trades.reduce((s, t) => s + t.stake, 0);

  // Drawdown walks the cumulative curve and remembers the highest point seen.
  // The answer is the deepest fall below a previous peak, which is what a
  // trader actually felt, rather than the gap between the best and worst days.
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    cumulative += t.profit;
    if (cumulative > peak) peak = cumulative;
    const fall = peak - cumulative;
    if (fall > maxDrawdown) maxDrawdown = fall;
  }

  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let runKind: "won" | "lost" | null = null;
  let run = 0;
  for (const t of trades) {
    const kind = t.result as "won" | "lost";
    run = kind === runKind ? run + 1 : 1;
    runKind = kind;
    if (kind === "won") longestWinStreak = Math.max(longestWinStreak, run);
    else longestLossStreak = Math.max(longestLossStreak, run);
  }

  const currentStreak: Streak =
    runKind === null ? { kind: "none", count: 0 } : { kind: runKind, count: run };

  const holds = trades
    .filter((t) => t.settledAt !== null)
    .map((t) => (t.settledAt! - t.openedAt) / 1000)
    .sort((a, b) => a - b);

  const best = trades.reduce<AnalyticsTrade | null>(
    (b, t) => (b === null || t.profit > b.profit ? t : b),
    null
  );
  const worst = trades.reduce<AnalyticsTrade | null>(
    (w, t) => (w === null || t.profit < w.profit ? t : w),
    null
  );

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : null,
    netProfit,
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgTrade: trades.length > 0 ? netProfit / trades.length : null,
    avgWin: wins.length > 0 ? grossWin / wins.length : null,
    avgLoss: losses.length > 0 ? -grossLoss / losses.length : null,
    bestTrade: best,
    worstTrade: worst,
    maxDrawdown,
    currentStreak,
    longestWinStreak,
    longestLossStreak,
    totalStaked,
    returnOnStake: totalStaked > 0 ? netProfit / totalStaked : null,
    medianHoldSeconds: holds.length > 0 ? holds[Math.floor(holds.length / 2)] : null,
  };
}

export interface CurvePoint {
  /** Settlement time of the trade at this step. */
  t: number;
  /** Running total of profit after this trade. */
  cumulative: number;
  /** Index in the settled sequence, 1-based — the chart's x when time is lumpy. */
  n: number;
  profit: number;
}

/**
 * Running profit, one point per settled trade.
 *
 * Plotted against trade number rather than wall-clock time by default. Trades
 * arrive in bursts separated by long idle gaps, and a time axis renders that as
 * a flat line with a cliff, which hides the shape of the run.
 */
export function equityCurve(input: AnalyticsTrade[]): CurvePoint[] {
  const trades = chronological(settledOnly(input));
  let cumulative = 0;
  return trades.map((t, i) => {
    cumulative += t.profit;
    return { t: t.settledAt ?? t.openedAt, cumulative, n: i + 1, profit: t.profit };
  });
}

export interface Breakdown {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  netProfit: number;
  staked: number;
  winRate: number | null;
}

/** Groups settled trades by one of their own fields. Sorted by profit, best first. */
export function breakdownBy(
  input: AnalyticsTrade[],
  field: "symbol" | "contractType" | "source"
): Breakdown[] {
  const map = new Map<string, Breakdown>();

  for (const t of settledOnly(input)) {
    const key = String(t[field]);
    const row =
      map.get(key) ??
      { key, trades: 0, wins: 0, losses: 0, netProfit: 0, staked: 0, winRate: null };
    row.trades += 1;
    if (t.result === "won") row.wins += 1;
    else row.losses += 1;
    row.netProfit += t.profit;
    row.staked += t.stake;
    map.set(key, row);
  }

  return [...map.values()]
    .map((r) => ({ ...r, winRate: r.trades > 0 ? r.wins / r.trades : null }))
    .sort((a, b) => b.netProfit - a.netProfit);
}

export interface ActivityBucket {
  /** Start of the bucket. */
  t: number;
  label: string;
  wins: number;
  losses: number;
  netProfit: number;
}

/**
 * Trades grouped into equal time buckets, for the activity chart.
 *
 * Empty buckets are included on purpose: a gap in trading is information, and
 * omitting them would draw a continuous run of activity that never happened.
 */
export function activityBuckets(
  input: AnalyticsTrade[],
  bucketMs: number,
  now: number,
  buckets: number
): ActivityBucket[] {
  const start = now - bucketMs * (buckets - 1);
  const out: ActivityBucket[] = [];

  for (let i = 0; i < buckets; i++) {
    const t = start + i * bucketMs;
    out.push({ t, label: "", wins: 0, losses: 0, netProfit: 0 });
  }

  for (const trade of settledOnly(input)) {
    const at = trade.settledAt ?? trade.openedAt;
    const index = Math.floor((at - start) / bucketMs);
    if (index < 0 || index >= buckets) continue;
    const b = out[index];
    if (trade.result === "won") b.wins += 1;
    else b.losses += 1;
    b.netProfit += trade.profit;
  }

  return out;
}

/** Converts the app's existing trade-log shape into the analytics shape. */
export function fromTradeLog(entries: TradeLogEntry[]): AnalyticsTrade[] {
  return entries.map((t) => ({
    id: t.id,
    openedAt: t.timestamp,
    settledAt: t.result === "open" ? null : t.timestamp,
    symbol: t.symbol,
    contractType: t.contractType,
    stake: t.stake,
    result: t.result,
    profit: t.profit,
    source: "manual" as const,
  }));
}
