import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { accumulatorReducer, type AccumulatorState } from "./accumulator";
import type { AccumulatorDetails } from "./types";

function update(ticksStayedIn: number[], over: Partial<AccumulatorDetails> = {}): AccumulatorDetails {
  return {
    ticksStayedIn,
    highBarrier: 632.47,
    lowBarrier: 631.79,
    maximumTicks: 85,
    maximumPayout: 6000,
    minimumStake: 1,
    maximumStake: 1000,
    barrierPercentage: "0.05369%",
    ...over,
  };
}

/** The real sequence observed on the wire: a snapshot, then single live counts. */
describe("accumulatorReducer", () => {
  test("the opening snapshot becomes the history", () => {
    const s = accumulatorReducer(null, update([23, 18, 94, 28, 1]));
    assert.deepEqual(s.runs, [23, 18, 94, 28, 1]);
    assert.equal(s.currentRun, null);
  });

  test("a single value is the live count, not a new history entry", () => {
    let s = accumulatorReducer(null, update([23, 18, 94]));
    s = accumulatorReducer(s, update([60]));
    s = accumulatorReducer(s, update([61]));
    s = accumulatorReducer(s, update([62]));

    // This is the bug the reducer exists to prevent: the history must survive.
    assert.deepEqual(s.runs, [23, 18, 94]);
    assert.equal(s.currentRun, 62);
  });

  test("a drop ends the run and prepends it to the history", () => {
    let s = accumulatorReducer(null, update([23, 18]));
    s = accumulatorReducer(s, update([60]));
    s = accumulatorReducer(s, update([63]));
    s = accumulatorReducer(s, update([0]));

    assert.deepEqual(s.runs, [63, 23, 18]);
    assert.equal(s.currentRun, 0);
  });

  test("counting resumes cleanly after a break", () => {
    let s: AccumulatorState | null = null;
    for (const v of [[5, 5], [10], [11], [0], [1], [2]]) {
      s = accumulatorReducer(s, update(v));
    }
    assert.deepEqual(s!.runs, [11, 5, 5]);
    assert.equal(s!.currentRun, 2);
  });

  test("a later snapshot replaces the history rather than merging", () => {
    let s = accumulatorReducer(null, update([1, 2, 3]));
    s = accumulatorReducer(s, update([9]));
    // What a reconnect looks like.
    s = accumulatorReducer(s, update([7, 8, 9, 10]));
    assert.deepEqual(s.runs, [7, 8, 9, 10]);
    assert.equal(s.currentRun, null);
  });

  test("an empty array changes neither history nor count", () => {
    let s = accumulatorReducer(null, update([4, 5]));
    s = accumulatorReducer(s, update([12]));
    s = accumulatorReducer(s, update([]));
    assert.deepEqual(s.runs, [4, 5]);
    assert.equal(s.currentRun, 12);
  });

  test("barriers follow the newest message", () => {
    let s = accumulatorReducer(null, update([1]));
    s = accumulatorReducer(s, update([2], { highBarrier: 700, lowBarrier: 690 }));
    assert.equal(s.highBarrier, 700);
    assert.equal(s.lowBarrier, 690);
  });

  test("fields sent only with the snapshot are not blanked by later updates", () => {
    let s = accumulatorReducer(null, update([1, 2]));
    s = accumulatorReducer(
      s,
      update([3], { maximumTicks: null, maximumPayout: null, barrierPercentage: null })
    );
    assert.equal(s.maximumTicks, 85);
    assert.equal(s.maximumPayout, 6000);
    assert.equal(s.barrierPercentage, "0.05369%");
  });

  test("history is capped so a long session cannot grow without bound", () => {
    let s = accumulatorReducer(null, update(Array.from({ length: 100 }, (_, i) => i)));
    for (let i = 0; i < 10; i++) {
      s = accumulatorReducer(s, update([5]));
      s = accumulatorReducer(s, update([0]));
    }
    assert.equal(s.runs.length, 100);
    assert.equal(s.runs[0], 5);
  });
});
