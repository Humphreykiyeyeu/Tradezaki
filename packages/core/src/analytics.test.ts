import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { activityBuckets, breakdownBy, equityCurve, summarise } from "./analytics";
import type { AnalyticsTrade } from "./analytics";

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

function trade(over: Partial<AnalyticsTrade> & { profit: number }): AnalyticsTrade {
  return {
    id: Math.random().toString(36).slice(2),
    openedAt: T0,
    settledAt: T0 + 5000,
    symbol: "R_100",
    contractType: "DIGITEVEN",
    stake: 1,
    result: over.profit >= 0 ? "won" : "lost",
    source: "bot",
    ...over,
  };
}

/** A run with a deliberate peak then a dip, so drawdown has something to find. */
const RUN: AnalyticsTrade[] = [
  trade({ profit: 1, settledAt: T0 + 1000 }),
  trade({ profit: 2, settledAt: T0 + 2000 }),
  trade({ profit: -1, settledAt: T0 + 3000 }),
  trade({ profit: -2, settledAt: T0 + 4000 }),
  trade({ profit: 3, settledAt: T0 + 5000 }),
];

describe("summarise", () => {
  test("counts outcomes and money", () => {
    const s = summarise(RUN);
    assert.equal(s.trades, 5);
    assert.equal(s.wins, 3);
    assert.equal(s.losses, 2);
    assert.equal(s.netProfit, 3);
    assert.equal(s.grossWin, 6);
    assert.equal(s.grossLoss, 3);
    assert.equal(s.profitFactor, 2);
    assert.equal(s.winRate, 3 / 5);
  });

  test("drawdown is the deepest fall from a running peak, not high minus low", () => {
    // Curve: 1, 3, 2, 0, 3. Peak 3, trough after it 0 → drawdown 3.
    assert.equal(summarise(RUN).maxDrawdown, 3);
  });

  test("open trades are excluded from every settled metric", () => {
    const withOpen = [...RUN, trade({ profit: 0, result: "open", settledAt: null })];
    const s = summarise(withOpen);
    assert.equal(s.trades, 5);
    assert.equal(s.netProfit, 3);
  });

  test("profit factor is null rather than infinite when nothing has been lost", () => {
    const s = summarise([trade({ profit: 5 })]);
    assert.equal(s.profitFactor, null);
    assert.equal(s.grossLoss, 0);
  });

  test("empty input reports null rates, not zero", () => {
    const s = summarise([]);
    assert.equal(s.trades, 0);
    // A win rate of 0 would claim every trade lost; there were no trades.
    assert.equal(s.winRate, null);
    assert.equal(s.avgTrade, null);
    assert.equal(s.currentStreak.kind, "none");
  });

  test("streaks follow settlement order", () => {
    const s = summarise(RUN);
    assert.equal(s.longestWinStreak, 2);
    assert.equal(s.longestLossStreak, 2);
    assert.deepEqual(s.currentStreak, { kind: "won", count: 1 });
  });

  test("order of the input does not change the answer", () => {
    const shuffled = [RUN[3], RUN[0], RUN[4], RUN[2], RUN[1]];
    assert.equal(summarise(shuffled).maxDrawdown, summarise(RUN).maxDrawdown);
    assert.equal(summarise(shuffled).longestWinStreak, 2);
  });

  test("best and worst pick out the extremes", () => {
    const s = summarise(RUN);
    assert.equal(s.bestTrade?.profit, 3);
    assert.equal(s.worstTrade?.profit, -2);
  });

  test("return on stake divides by everything risked", () => {
    const s = summarise(RUN);
    assert.equal(s.totalStaked, 5);
    assert.equal(s.returnOnStake, 3 / 5);
  });
});

describe("equityCurve", () => {
  test("accumulates in settlement order", () => {
    assert.deepEqual(
      equityCurve(RUN).map((p) => p.cumulative),
      [1, 3, 2, 0, 3]
    );
  });

  test("is empty when nothing has settled", () => {
    assert.deepEqual(equityCurve([trade({ profit: 0, result: "open", settledAt: null })]), []);
  });
});

describe("breakdownBy", () => {
  test("groups and ranks by profit", () => {
    const rows = breakdownBy(
      [
        trade({ profit: 5, symbol: "R_100" }),
        trade({ profit: -2, symbol: "RDBEAR" }),
        trade({ profit: 1, symbol: "R_100" }),
      ],
      "symbol"
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].key, "R_100");
    assert.equal(rows[0].netProfit, 6);
    assert.equal(rows[0].trades, 2);
    assert.equal(rows[1].key, "RDBEAR");
    assert.equal(rows[1].netProfit, -2);
  });

  test("win rate is per group", () => {
    const rows = breakdownBy(
      [trade({ profit: 1, symbol: "A" }), trade({ profit: -1, symbol: "A" })],
      "symbol"
    );
    assert.equal(rows[0].winRate, 0.5);
  });
});

describe("activityBuckets", () => {
  test("places trades in the right bucket and keeps empty ones", () => {
    const now = T0 + 3 * HOUR;
    const rows = activityBuckets(
      [
        trade({ profit: 1, settledAt: T0 + 3 * HOUR }),
        trade({ profit: -1, settledAt: T0 + 1 * HOUR }),
      ],
      HOUR,
      now,
      4
    );
    assert.equal(rows.length, 4);
    // Buckets start at now - 3h = T0.
    assert.equal(rows[0].wins + rows[0].losses, 0);
    assert.equal(rows[1].losses, 1);
    assert.equal(rows[2].wins + rows[2].losses, 0);
    assert.equal(rows[3].wins, 1);
  });

  test("trades outside the window are dropped, not clamped into the edges", () => {
    const now = T0 + 2 * HOUR;
    const rows = activityBuckets([trade({ profit: 1, settledAt: T0 - 50 * HOUR })], HOUR, now, 3);
    assert.equal(
      rows.reduce((s, r) => s + r.wins + r.losses, 0),
      0
    );
  });
});
