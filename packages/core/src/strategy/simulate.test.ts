import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { canSimulate, simulateSettlement, type SimulateInput } from "./simulate";
import type { TickPoint } from "./types";

const after = (...q: number[]): TickPoint[] => q.map((quote, i) => ({ quote, epoch: i }));

const base = (over: Partial<SimulateInput> = {}): SimulateInput => ({
  contractType: "CALL",
  entrySpot: 100,
  after: after(101, 102, 103, 104, 105),
  durationTicks: 5,
  stake: 1,
  payout: 1.9,
  decimals: 2,
  ...over,
});

describe("simulateSettlement", () => {
  it("settles Rise on the exit tick, not the highest tick", () => {
    // Price peaks mid-window then closes below entry: this is a loss.
    const r = simulateSettlement(base({ after: after(105, 110, 108, 102, 99) }));
    assert.equal(r.kind, "lost");
    assert.equal(r.kind === "lost" && r.exitSpot, 99);
  });

  it("pays payout minus stake on a win", () => {
    const r = simulateSettlement(base());
    assert.equal(r.kind, "won");
    assert.equal(r.kind === "won" && r.profit, 0.9);
  });

  it("forfeits only the stake on a loss", () => {
    const r = simulateSettlement(base({ contractType: "PUT" }));
    assert.equal(r.kind, "lost");
    assert.equal(r.kind === "lost" && r.profit, -1);
  });

  it("distinguishes Rise from Rise-or-equal on an exact tie", () => {
    const tie = { after: after(100, 100, 100, 100, 100) };
    assert.equal(simulateSettlement(base({ contractType: "CALL", ...tie })).kind, "lost");
    assert.equal(simulateSettlement(base({ contractType: "CALLE", ...tie })).kind, "won");
    assert.equal(simulateSettlement(base({ contractType: "PUTE", ...tie })).kind, "won");
  });

  it("reads digits from the exit tick at the symbol's precision", () => {
    // 104.30 at 2dp has last digit 0 — even.
    const t = { after: after(1, 2, 3, 4, 104.3), decimals: 2 };
    assert.equal(simulateSettlement(base({ contractType: "DIGITEVEN", ...t })).kind, "won");
    assert.equal(simulateSettlement(base({ contractType: "DIGITODD", ...t })).kind, "lost");
  });

  it("compares digits against the barrier", () => {
    const t = { after: after(1, 2, 3, 4, 100.07), decimals: 2, barrier: "5" };
    assert.equal(simulateSettlement(base({ contractType: "DIGITOVER", ...t })).kind, "won");
    assert.equal(simulateSettlement(base({ contractType: "DIGITUNDER", ...t })).kind, "lost");
    assert.equal(simulateSettlement(base({ contractType: "DIGITDIFF", ...t })).kind, "won");
    assert.equal(
      simulateSettlement(base({ contractType: "DIGITMATCH", ...t, barrier: "7" })).kind,
      "won"
    );
  });

  it("settles Asians against the window average", () => {
    // avg(10,20,30,40,50) = 30; exit 50 is above it.
    const t = { after: after(10, 20, 30, 40, 50) };
    assert.equal(simulateSettlement(base({ contractType: "ASIANU", ...t })).kind, "won");
    assert.equal(simulateSettlement(base({ contractType: "ASIAND", ...t })).kind, "lost");
  });

  it("treats Touch as path-dependent, not exit-only", () => {
    // Touches +5 at tick 2, then falls back. Exit-only logic would call this a
    // loss; Deriv calls it a win the moment it touches.
    const t = { after: after(102, 106, 103, 101, 100), barrier: "+5" };
    assert.equal(simulateSettlement(base({ contractType: "ONETOUCH", ...t })).kind, "won");
    assert.equal(simulateSettlement(base({ contractType: "NOTOUCH", ...t })).kind, "lost");
  });

  it("requires every tick to move one way for Only Ups", () => {
    assert.equal(
      simulateSettlement(base({ contractType: "RUNHIGH", after: after(101, 102, 103, 104, 105) }))
        .kind,
      "won"
    );
    assert.equal(
      simulateSettlement(base({ contractType: "RUNHIGH", after: after(101, 102, 102, 104, 105) }))
        .kind,
      "lost"
    );
  });

  it("uses only the contract's own window, ignoring later ticks", () => {
    // 3-tick contract that loses, even though the stream later rises.
    const r = simulateSettlement(
      base({ durationTicks: 3, after: after(99, 98, 97, 200, 300) })
    );
    assert.equal(r.kind, "lost");
    assert.equal(r.kind === "lost" && r.exitSpot, 97);
  });

  it("waits rather than guessing when ticks are short", () => {
    const r = simulateSettlement(base({ after: after(101, 102) }));
    assert.equal(r.kind, "unsupported");
  });

  it("refuses contract types a tick stream cannot decide", () => {
    // Accumulators and multipliers are priced on Deriv's model; inventing a
    // result here would produce false confidence.
    assert.equal(canSimulate("ACCU"), false);
    assert.equal(canSimulate("MULTUP"), false);
    assert.equal(simulateSettlement(base({ contractType: "ACCU" })).kind, "unsupported");
    assert.equal(canSimulate("CALL"), true);
  });
});
