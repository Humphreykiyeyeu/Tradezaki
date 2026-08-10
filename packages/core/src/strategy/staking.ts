import type { SessionState, StakingPlan } from "./types";

/**
 * Stake sizing.
 *
 * Every plan is capped by `maxSteps`. Martingale in particular doubles after
 * each loss, so eight losses on a $1 base is a $256 stake and a $511 hole — a
 * ladder without a ceiling is how accounts die in an afternoon. The cap is not
 * a nicety; it is the difference between a bad session and a blown account.
 */

export function stakeFor(plan: StakingPlan, session: SessionState): number {
  switch (plan.type) {
    case "fixed":
      return plan.amount;

    case "martingale": {
      const step = Math.min(session.step, plan.maxSteps);
      return round(plan.base * plan.multiplier ** step);
    }

    case "dalembert": {
      const step = Math.min(session.step, plan.maxSteps);
      return round(plan.base + plan.unit * step);
    }

    default:
      return 0;
  }
}

/** How the ladder moves after a settled trade. */
export function nextStep(plan: StakingPlan, currentStep: number, won: boolean): number {
  switch (plan.type) {
    case "fixed":
      return 0;

    case "martingale":
      // All the way back down on a win — that's the whole premise of the plan.
      return won ? 0 : currentStep + 1;

    case "dalembert":
      return won ? Math.max(0, currentStep - 1) : currentStep + 1;

    default:
      return 0;
  }
}

/** True once the ladder has run past its cap, which stops the bot. */
export function ladderExhausted(plan: StakingPlan, step: number): boolean {
  if (plan.type === "fixed") return false;
  return step > plan.maxSteps;
}

/**
 * Worst-case total exposure if every rung loses. Shown before a bot starts, so
 * "base $1, x2, 8 steps" reads as the $255 commitment it actually is rather
 * than the $1 it looks like.
 */
export function worstCaseLoss(plan: StakingPlan): number {
  if (plan.type === "fixed") return plan.amount;
  let total = 0;
  for (let step = 0; step <= plan.maxSteps; step += 1) {
    total +=
      plan.type === "martingale"
        ? plan.base * plan.multiplier ** step
        : plan.base + plan.unit * step;
  }
  return round(total);
}

// Deriv rejects stakes with more than 2 decimal places.
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
