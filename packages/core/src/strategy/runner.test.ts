import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluate, lastDigitOf, validateCondition } from "./conditions";
import { ladderExhausted, nextStep, stakeFor, worstCaseLoss } from "./staking";
import { StrategyRunner } from "./runner";
import { initialSession, type Strategy, type TickPoint } from "./types";

const ticks = (...quotes: number[]): TickPoint[] =>
  quotes.map((quote, i) => ({ quote, epoch: 1000 + i }));

const ctx = (quotes: number[], session = initialSession(), decimals = 2) => ({
  ticks: ticks(...quotes),
  session,
  decimals,
});

// ------------------------------------------------------------------ digits

describe("lastDigitOf", () => {
  it("reads the final decimal, not the final character of the float", () => {
    // 810.9 stringifies as "810.9"; at 2dp the digit is 0, not 9.
    assert.equal(lastDigitOf(810.9, 2), 0);
    assert.equal(lastDigitOf(810.97, 2), 7);
    assert.equal(lastDigitOf(1234.5678, 3), 8);
  });
});

// -------------------------------------------------------------- conditions

describe("conditions", () => {
  it("always is unconditional", () => {
    assert.equal(evaluate({ op: "always" }, ctx([1])), true);
  });

  it("treats a flat tick as neither up nor down", () => {
    const c = ctx([100, 100]);
    assert.equal(evaluate({ op: "tickDirection", is: "up" }, c), false);
    assert.equal(evaluate({ op: "tickDirection", is: "down" }, c), false);
  });

  it("counts a directional streak", () => {
    const c = ctx([1, 2, 3, 4]);
    assert.equal(evaluate({ op: "streak", direction: "up", cmp: ">=", value: 3 }, c), true);
    assert.equal(evaluate({ op: "streak", direction: "up", cmp: ">=", value: 4 }, c), false);
  });

  it("measures percentage change over a window", () => {
    const c = ctx([100, 105, 110]);
    assert.equal(evaluate({ op: "priceChange", overTicks: 2, cmp: ">", pct: 9 }, c), true);
    assert.equal(evaluate({ op: "priceChange", overTicks: 2, cmp: ">", pct: 11 }, c), false);
  });

  it("returns false rather than throwing when history is too short", () => {
    assert.equal(evaluate({ op: "priceChange", overTicks: 50, cmp: ">", pct: 1 }, ctx([1, 2])), false);
    assert.equal(evaluate({ op: "lastDigit", cmp: "==", value: 1 }, ctx([])), false);
  });

  it("combines with and/or/not", () => {
    const c = ctx([1, 2]);
    assert.equal(
      evaluate(
        { op: "and", terms: [{ op: "always" }, { op: "tickDirection", is: "up" }] },
        c
      ),
      true
    );
    assert.equal(evaluate({ op: "not", term: { op: "always" } }, c), false);
    assert.equal(
      evaluate({ op: "or", terms: [{ op: "tickDirection", is: "down" }, { op: "always" }] }, c),
      true
    );
  });

  it("refuses to trade on an unknown operator", () => {
    // A future strategy format must not be interpreted as "always buy".
    assert.equal(evaluate({ op: "wat" } as never, ctx([1, 2])), false);
  });

  it("rejects malformed and absurdly nested conditions", () => {
    assert.ok(validateCondition({ op: "nope" }));
    assert.ok(validateCondition(null));
    let deep: unknown = { op: "always" };
    for (let i = 0; i < 40; i += 1) deep = { op: "not", term: deep };
    assert.ok(validateCondition(deep));
    assert.equal(validateCondition({ op: "and", terms: [{ op: "always" }] }), null);
  });
});

// ----------------------------------------------------------------- staking

describe("staking", () => {
  it("martingale doubles on loss and resets on win", () => {
    const plan = { type: "martingale", base: 1, multiplier: 2, maxSteps: 5 } as const;
    const s = initialSession();
    assert.equal(stakeFor(plan, { ...s, step: 0 }), 1);
    assert.equal(stakeFor(plan, { ...s, step: 3 }), 8);
    assert.equal(nextStep(plan, 3, false), 4);
    assert.equal(nextStep(plan, 3, true), 0);
  });

  it("caps the martingale stake at maxSteps", () => {
    const plan = { type: "martingale", base: 1, multiplier: 2, maxSteps: 3 } as const;
    // Step 9 must not price a $512 trade.
    assert.equal(stakeFor(plan, { ...initialSession(), step: 9 }), 8);
    assert.equal(ladderExhausted(plan, 4), true);
    assert.equal(ladderExhausted(plan, 3), false);
  });

  it("d'Alembert steps by one unit each way", () => {
    const plan = { type: "dalembert", base: 1, unit: 0.5, maxSteps: 10 } as const;
    assert.equal(stakeFor(plan, { ...initialSession(), step: 4 }), 3);
    assert.equal(nextStep(plan, 2, true), 1);
    assert.equal(nextStep(plan, 0, true), 0); // never goes negative
  });

  it("states worst-case exposure honestly", () => {
    // base 1, x2, 8 steps: 1+2+4+...+256 = 511, not "a $1 bot"
    const plan = { type: "martingale", base: 1, multiplier: 2, maxSteps: 8 } as const;
    assert.equal(worstCaseLoss(plan), 511);
  });
});

// ------------------------------------------------------------------ runner

const baseStrategy = (over: Partial<Strategy> = {}): Strategy => ({
  name: "test",
  symbol: "R_75",
  contract: { contractType: "CALL", basis: "stake", duration: 5, durationUnit: "t" },
  entry: { op: "always" },
  staking: { type: "fixed", amount: 1 },
  limits: {},
  ...over,
});

describe("StrategyRunner", () => {
  it("buys when the entry condition holds", () => {
    const r = new StrategyRunner({ strategy: baseStrategy(), decimals: 2 });
    const action = r.onTick({ quote: 100, epoch: 1 });
    assert.equal(action?.kind, "buy");
    assert.equal(action.kind === "buy" && action.amount, 1);
  });

  it("holds one contract at a time by default", () => {
    const r = new StrategyRunner({ strategy: baseStrategy(), decimals: 2 });
    assert.equal(r.onTick({ quote: 100, epoch: 1 })?.kind, "buy");
    // Without this guard an `always` strategy fires on every single tick.
    assert.equal(r.onTick({ quote: 101, epoch: 2 }), null);
    r.onSettle(0.8);
    assert.equal(r.onTick({ quote: 102, epoch: 3 })?.kind, "buy");
  });

  it("honours a cooldown after settlement", () => {
    const r = new StrategyRunner({ strategy: baseStrategy({ cooldownTicks: 3 }), decimals: 2 });
    r.onTick({ quote: 100, epoch: 1 });
    r.onSettle(-1);
    assert.equal(r.onTick({ quote: 101, epoch: 2 }), null);
    assert.equal(r.onTick({ quote: 102, epoch: 3 }), null);
    assert.equal(r.onTick({ quote: 103, epoch: 4 })?.kind, "buy");
  });

  it("stops on take profit and places nothing further", () => {
    const r = new StrategyRunner({
      strategy: baseStrategy({ limits: { takeProfit: 5 } }),
      decimals: 2,
    });
    r.onTick({ quote: 100, epoch: 1 });
    const stop = r.onSettle(6);
    assert.equal(stop?.kind, "stop");
    assert.equal(stop.kind === "stop" && stop.reason, "take-profit");
    assert.equal(r.onTick({ quote: 101, epoch: 2 }), null);
    assert.equal(r.isStopped, true);
  });

  it("stops on stop loss", () => {
    const r = new StrategyRunner({
      strategy: baseStrategy({ limits: { stopLoss: 3 } }),
      decimals: 2,
    });
    r.onTick({ quote: 100, epoch: 1 });
    const stop = r.onSettle(-4);
    assert.equal(stop?.kind === "stop" && stop.reason, "stop-loss");
  });

  it("checks limits before entry on the same tick", () => {
    // maxTrades 1: the second tick must stop, not squeeze in one more trade.
    const r = new StrategyRunner({
      strategy: baseStrategy({ limits: { maxTrades: 1 }, allowConcurrent: true }),
      decimals: 2,
    });
    assert.equal(r.onTick({ quote: 100, epoch: 1 })?.kind, "buy");
    const next = r.onTick({ quote: 101, epoch: 2 });
    assert.equal(next?.kind, "stop");
    assert.equal(next.kind === "stop" && next.reason, "max-trades");
  });

  it("stops when the staking ladder is exhausted", () => {
    const r = new StrategyRunner({
      strategy: baseStrategy({
        staking: { type: "martingale", base: 1, multiplier: 2, maxSteps: 2 },
      }),
      decimals: 2,
    });
    for (let i = 0; i < 3; i += 1) {
      r.onTick({ quote: 100 + i, epoch: i });
      const a = r.onSettle(-1);
      if (i < 2) assert.equal(a, null);
      else assert.equal(a?.kind === "stop" && a.reason, "staking-ladder-exhausted");
    }
  });

  it("never stakes above maxStake", () => {
    const r = new StrategyRunner({
      strategy: baseStrategy({
        staking: { type: "martingale", base: 1, multiplier: 2, maxSteps: 10 },
        limits: { maxStake: 4 },
      }),
      decimals: 2,
    });
    for (let i = 0; i < 5; i += 1) {
      r.onTick({ quote: 100 + i, epoch: i });
      r.onSettle(-1);
    }
    assert.ok(r.nextStake() <= 4, `stake ${r.nextStake()} exceeded the cap`);
  });

  it("releases the slot when a buy fails", () => {
    const r = new StrategyRunner({ strategy: baseStrategy(), decimals: 2 });
    r.onTick({ quote: 100, epoch: 1 });
    r.onBuyFailed();
    // A failed buy must not wedge the bot into "one contract already open".
    assert.equal(r.state.openContracts, 0);
    assert.equal(r.state.trades, 0);
    assert.equal(r.onTick({ quote: 101, epoch: 2 })?.kind, "buy");
  });

  it("picks the alternate contract when only its condition matches", () => {
    const r = new StrategyRunner({
      strategy: baseStrategy({
        entry: { op: "tickDirection", is: "up" },
        contractAlt: { contractType: "PUT", basis: "stake", duration: 5, durationUnit: "t" },
        entryAlt: { op: "tickDirection", is: "down" },
      }),
      decimals: 2,
    });
    r.seed([{ quote: 100, epoch: 0 }]);
    const a = r.onTick({ quote: 99, epoch: 1 });
    assert.equal(a?.kind === "buy" && a.contract.contractType, "PUT");
  });

  it("seeding history does not place trades", () => {
    const r = new StrategyRunner({ strategy: baseStrategy(), decimals: 2 });
    r.seed(ticks(1, 2, 3, 4, 5));
    assert.equal(r.state.trades, 0);
  });

  it("tracks session stats across wins and losses", () => {
    const r = new StrategyRunner({ strategy: baseStrategy(), decimals: 2 });
    r.onTick({ quote: 100, epoch: 1 });
    r.onSettle(0.8);
    r.onTick({ quote: 101, epoch: 2 });
    r.onSettle(-1);
    r.onTick({ quote: 102, epoch: 3 });
    r.onSettle(-1);

    const s = r.state;
    assert.equal(s.trades, 3);
    assert.equal(s.wins, 1);
    assert.equal(s.losses, 2);
    assert.equal(s.consecutiveLosses, 2);
    assert.equal(s.profit, -1.2);
  });
});
