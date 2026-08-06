import type { RiskCheckResult, RiskGuardianConfig, TradeLogEntry } from "./types";

// Pure functions only — no storage, no timers, no platform APIs.
// The web app and mobile app each own how they persist trade history
// (Supabase, AsyncStorage, etc.) and just pass the day's trades in here
// before every buy action.

export const DEFAULT_RISK_CONFIG: RiskGuardianConfig = {
  enabled: false,
  dailyLossLimit: 0,
  maxConsecutiveLosses: 0,
  cooldownSeconds: 300,
  maxStakePercentOfBalance: 0,
};

function tradesToday(trades: TradeLogEntry[], now: number): TradeLogEntry[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  return trades.filter((t) => t.timestamp >= startOfDay.getTime());
}

function currentLossStreak(trades: TradeLogEntry[]): { count: number; lastLossAt: number | null } {
  const sorted = [...trades].sort((a, b) => b.timestamp - a.timestamp);
  let count = 0;
  let lastLossAt: number | null = null;
  for (const t of sorted) {
    if (t.result === "lost") {
      count += 1;
      if (lastLossAt === null) lastLossAt = t.timestamp;
    } else if (t.result === "won") {
      break;
    }
  }
  return { count, lastLossAt };
}

/**
 * Call this before every buy action. Returns whether the trade is
 * allowed, and if not, a plain-language reason to show the trader.
 */
export function checkTradeAllowed(
  config: RiskGuardianConfig,
  trades: TradeLogEntry[],
  proposedStake: number,
  accountBalance: number,
  now: number = Date.now()
): RiskCheckResult {
  // Opt-in. A trader who hasn't turned this on is never blocked by it.
  if (!config.enabled) return { allowed: true };

  const today = tradesToday(trades, now);

  if (config.dailyLossLimit > 0) {
    const lossToday = today
      .filter((t) => t.result === "lost")
      .reduce((sum, t) => sum + Math.abs(t.profit), 0);
    if (lossToday >= config.dailyLossLimit) {
      return {
        allowed: false,
        reason: `Daily loss limit reached (${lossToday.toFixed(2)} of ${config.dailyLossLimit}). Trading is paused until tomorrow.`,
      };
    }
  }

  if (config.maxConsecutiveLosses > 0) {
    const { count, lastLossAt } = currentLossStreak(today);
    if (count >= config.maxConsecutiveLosses && lastLossAt !== null) {
      const cooldownEndsAt = lastLossAt + config.cooldownSeconds * 1000;
      if (now < cooldownEndsAt) {
        return {
          allowed: false,
          reason: `${count} losses in a row. Take a ${config.cooldownSeconds / 60}-minute break before the next trade.`,
          cooldownEndsAt,
        };
      }
    }
  }

  if (config.maxStakePercentOfBalance > 0 && accountBalance > 0) {
    const maxStake = (config.maxStakePercentOfBalance / 100) * accountBalance;
    if (proposedStake > maxStake) {
      return {
        allowed: false,
        reason: `Stake exceeds your ${config.maxStakePercentOfBalance}% per-trade limit (max ${maxStake.toFixed(2)}).`,
      };
    }
  }

  return { allowed: true };
}

/** Summary stats for the end-of-session recap. */
export function sessionSummary(trades: TradeLogEntry[], now: number = Date.now()) {
  const today = tradesToday(trades, now);
  const closed = today.filter((t) => t.result !== "open");
  const wins = closed.filter((t) => t.result === "won").length;
  const netProfit = closed.reduce((sum, t) => sum + t.profit, 0);

  return {
    tradeCount: today.length,
    winRate: closed.length > 0 ? wins / closed.length : 0,
    netProfit,
  };
}
