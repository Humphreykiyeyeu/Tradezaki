import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { digitStreakOf, evaluate } from "./conditions";
import { StrategyRunner } from "./runner";
import type { Strategy, TickPoint } from "./types";

/** Quotes on R_10 carry three decimals; the last one is what digit contracts settle on. */
const t = (quote: number, epoch: number): TickPoint => ({ quote, epoch });

/** Builds ticks whose last digits are exactly the sequence given. */
const fromDigits = (digits: number[]): TickPoint[] =>
  digits.map((d, i) => t(Number(`100.00${d}`), 1000 + i));

describe("digitStreakOf", () => {
  test("a single tick is a streak of one", () => {
    assert.equal(digitStreakOf(fromDigits([7]), 3), 1);
  });

  test("counts repeats of the newest digit only", () => {
    assert.equal(digitStreakOf(fromDigits([3, 7, 7, 7]), 3), 3);
  });

  test("stops at the first digit that differs", () => {
    assert.equal(digitStreakOf(fromDigits([7, 7, 7, 2]), 3), 1);
  });

  test("no ticks is zero, not one", () => {
    assert.equal(digitStreakOf([], 3), 0);
  });

  test("a whole history of one digit counts all of it", () => {
    assert.equal(digitStreakOf(fromDigits([5, 5, 5, 5, 5]), 3), 5);
  });
});

describe("digitStreak condition", () => {
  const ctx = (digits: number[]) => ({
    ticks: fromDigits(digits),
    session: {
      trades: 0,
      wins: 0,
      losses: 0,
      profit: 0,
      consecutiveLosses: 0,
      lastResult: null,
      openContracts: 0,
      ticksSinceSettle: 999,
      step: 0,
    },
    decimals: 3,
  });

  test("fires on the fourth repeat, not the third", () => {
    const cond = { op: "digitStreak", cmp: ">=", value: 4 } as const;
    assert.equal(evaluate(cond, ctx([7, 7, 7])), false);
    assert.equal(evaluate(cond, ctx([7, 7, 7, 7])), true);
  });

  test("a different digit resets it", () => {
    const cond = { op: "digitStreak", cmp: ">=", value: 4 } as const;
    assert.equal(evaluate(cond, ctx([7, 7, 7, 7, 2])), false);
  });
});

describe("barrierFrom: lastDigit", () => {
  const strategy: Strategy = {
    name: "repeat four then differs",
    symbol: "R_10",
    contract: {
      contractType: "DIGITDIFF",
      basis: "stake",
      duration: 1,
      durationUnit: "t",
      barrierFrom: "lastDigit",
    },
    entry: { op: "digitStreak", cmp: ">=", value: 4 },
    staking: { type: "martingale", base: 1, multiplier: 2, maxSteps: 4 },
    limits: { maxStake: 100 },
    cooldownTicks: 0,
    allowConcurrent: false,
  };

  test("buys with the repeating digit as the barrier", () => {
    const r = new StrategyRunner({ strategy, decimals: 3 });
    const ticks = fromDigits([7, 7, 7, 7]);

    let action = null;
    for (const tick of ticks) action = r.onTick(tick) ?? action;

    assert.ok(action, "expected a buy on the fourth repeat");
    assert.equal(action!.kind, "buy");
    if (action!.kind === "buy") {
      assert.equal(action!.contract.barrier, "7", "barrier must be the digit that repeated");
      // The instruction is for the runner; Deriv would reject it on a proposal.
      assert.equal("barrierFrom" in action!.contract, false);
    }
  });

  test("follows whichever digit repeats, not a fixed one", () => {
    const r = new StrategyRunner({ strategy, decimals: 3 });
    let action = null;
    for (const tick of fromDigits([3, 3, 3, 3])) action = r.onTick(tick) ?? action;

    assert.ok(action);
    if (action!.kind === "buy") assert.equal(action!.contract.barrier, "3");
  });

  test("does not buy before the fourth repeat", () => {
    const r = new StrategyRunner({ strategy, decimals: 3 });
    const actions = fromDigits([9, 9, 9]).map((tick) => r.onTick(tick));
    assert.deepEqual(actions, [null, null, null]);
  });
});
