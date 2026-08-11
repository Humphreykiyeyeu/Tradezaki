import type { Strategy } from "./types";

/**
 * Ready-made strategies.
 *
 * These are starting points, not recommendations. Every one of these is a
 * negative-expectancy game before markup and a slightly worse one after it —
 * `edge` says so per preset, in plain numbers, because a preset library that
 * only describes the upside is how people talk themselves into a martingale.
 *
 * All of them ship with a stop loss and a capped staking ladder already set.
 */

export interface StrategyPreset {
  id: string;
  name: string;
  blurb: string;
  /** What has to be true for this to make money, stated honestly. */
  edge: string;
  risk: "low" | "medium" | "high";
  /** Contract types it needs, so the UI can hide it on markets that lack them. */
  requires: string[];
  build: (symbol: string, stake: number) => Strategy;
}

const limits = (stake: number) => ({
  stopLoss: stake * 20,
  takeProfit: stake * 20,
  maxStake: stake * 10,
});

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "even-odd-flat",
    name: "Even / Odd, flat stake",
    blurb: "Buys Even on every opportunity with a fixed stake. The simplest possible bot.",
    edge:
      "Digits are close to a coin flip, but a payout near 1.85 means you need about 54% wins just to break even. Use this to see how the runner behaves, not to make money.",
    risk: "low",
    requires: ["DIGITEVEN", "DIGITODD"],
    build: (symbol, stake) => ({
      name: "Even / Odd, flat stake",
      symbol,
      contract: { contractType: "DIGITEVEN", basis: "stake", duration: 1, durationUnit: "t" },
      entry: { op: "always" },
      staking: { type: "fixed", amount: stake },
      limits: limits(stake),
      cooldownTicks: 1,
    }),
  },
  {
    id: "differs-flat",
    name: "Digit Differs, flat stake",
    blurb: "Bets the last digit won't be the one you picked. Wins often, pays little.",
    edge:
      "Wins roughly 9 times in 10, but pays around 1.06 — a single loss wipes out about nine wins. Frequent small wins feel like an edge and are not one.",
    risk: "medium",
    requires: ["DIGITDIFF"],
    build: (symbol, stake) => ({
      name: "Digit Differs, flat stake",
      symbol,
      contract: {
        contractType: "DIGITDIFF",
        basis: "stake",
        duration: 1,
        durationUnit: "t",
        barrier: "5",
      },
      entry: { op: "always" },
      staking: { type: "fixed", amount: stake },
      limits: limits(stake),
      cooldownTicks: 1,
    }),
  },
  {
    id: "rise-after-downs",
    name: "Rise after three downs",
    blurb: "Waits for three falling ticks, then buys Rise. A mean-reversion guess.",
    edge:
      "Assumes a run of falls makes a rise more likely. On synthetic indices each tick is independent, so this assumption is false — the appeal is psychological, not statistical.",
    risk: "medium",
    requires: ["CALL", "PUT"],
    build: (symbol, stake) => ({
      name: "Rise after three downs",
      symbol,
      contract: { contractType: "CALL", basis: "stake", duration: 5, durationUnit: "t" },
      entry: { op: "streak", direction: "down", cmp: ">=", value: 3 },
      contractAlt: { contractType: "PUT", basis: "stake", duration: 5, durationUnit: "t" },
      entryAlt: { op: "streak", direction: "up", cmp: ">=", value: 3 },
      staking: { type: "fixed", amount: stake },
      limits: limits(stake),
      cooldownTicks: 2,
    }),
  },
  {
    id: "over-2",
    name: "Digit Over 2",
    blurb: "Wins when the last digit is 3 or higher — seven outcomes in ten.",
    edge:
      "The payout is priced for the 70% hit rate, so there is no free win here. Included because it is the most-copied shape in community bots.",
    risk: "medium",
    requires: ["DIGITOVER"],
    build: (symbol, stake) => ({
      name: "Digit Over 2",
      symbol,
      contract: {
        contractType: "DIGITOVER",
        basis: "stake",
        duration: 1,
        durationUnit: "t",
        barrier: "2",
      },
      entry: { op: "always" },
      staking: { type: "fixed", amount: stake },
      limits: limits(stake),
      cooldownTicks: 1,
    }),
  },
  {
    id: "martingale-even",
    name: "Even / Odd with martingale",
    blurb: "Doubles the stake after each loss, resets on a win. Capped at four steps.",
    edge:
      "Recovers a losing run — until it doesn't. Four doublings off a base stake commits 31x that stake, and the ladder is one long run away from its cap. This is included because people ask for it, not because it works.",
    risk: "high",
    requires: ["DIGITEVEN"],
    build: (symbol, stake) => ({
      name: "Even / Odd with martingale",
      symbol,
      contract: { contractType: "DIGITEVEN", basis: "stake", duration: 1, durationUnit: "t" },
      entry: { op: "always" },
      staking: { type: "martingale", base: stake, multiplier: 2, maxSteps: 4 },
      limits: { ...limits(stake), stopLoss: stake * 31, maxStake: stake * 16 },
      cooldownTicks: 1,
    }),
  },
  {
    id: "dalembert-rise",
    name: "Rise / Fall with D'Alembert",
    blurb: "Stake up one unit after a loss, down one after a win. Gentler than martingale.",
    edge:
      "Grows exposure far more slowly than doubling, so a losing run hurts less and recovers more slowly. It changes the shape of the ride, not the expected value.",
    risk: "medium",
    requires: ["CALL", "PUT"],
    build: (symbol, stake) => ({
      name: "Rise / Fall with D'Alembert",
      symbol,
      contract: { contractType: "CALL", basis: "stake", duration: 5, durationUnit: "t" },
      entry: { op: "tickDirection", is: "up" },
      contractAlt: { contractType: "PUT", basis: "stake", duration: 5, durationUnit: "t" },
      entryAlt: { op: "tickDirection", is: "down" },
      staking: { type: "dalembert", base: stake, unit: stake, maxSteps: 8 },
      limits: limits(stake),
      cooldownTicks: 1,
    }),
  },
];

export function presetById(id: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find((p) => p.id === id);
}
