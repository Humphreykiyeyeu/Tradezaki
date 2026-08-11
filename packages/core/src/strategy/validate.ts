import { validateCondition } from "./conditions";
import type { Strategy } from "./types";

/**
 * Validates a strategy before it is allowed to run or be saved.
 *
 * This is the gate for strategies that arrive as JSON — a shared file, an
 * export from another account, or a hand-edited one. Anything from outside must
 * be proven to fit the IR before the runner touches it: the IR's safety comes
 * from being a closed shape, and that only holds if it's actually checked.
 */

export interface ValidationIssue {
  field: string;
  message: string;
}

const MAX_STAKE = 100_000;

export function validateStrategy(input: unknown): {
  ok: boolean;
  issues: ValidationIssue[];
  strategy?: Strategy;
} {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  if (typeof input !== "object" || input === null) {
    return { ok: false, issues: [{ field: "strategy", message: "Not a strategy object." }] };
  }
  const s = input as Record<string, unknown>;

  if (typeof s.name !== "string" || !s.name.trim()) add("name", "Give the strategy a name.");
  if (typeof s.symbol !== "string" || !s.symbol.trim()) add("symbol", "Choose a market.");

  const checkContract = (c: unknown, field: string) => {
    if (typeof c !== "object" || c === null) return add(field, "Missing contract details.");
    const spec = c as Record<string, unknown>;
    if (typeof spec.contractType !== "string" || !spec.contractType) {
      add(field, "Choose a contract type.");
    }
    if (spec.duration !== undefined) {
      const d = Number(spec.duration);
      if (!Number.isFinite(d) || d < 1) add(field, "Duration must be at least 1.");
    }
  };

  checkContract(s.contract, "contract");
  if (s.contractAlt !== undefined) checkContract(s.contractAlt, "contractAlt");

  const entryErr = validateCondition(s.entry);
  if (entryErr) add("entry", entryErr);
  if (s.entryAlt !== undefined) {
    const altErr = validateCondition(s.entryAlt);
    if (altErr) add("entryAlt", altErr);
  }
  // An alternate contract with no condition would never fire, which looks like
  // the bot ignoring half its configuration.
  if (s.contractAlt !== undefined && s.entryAlt === undefined) {
    add("entryAlt", "The second contract has no condition, so it would never be bought.");
  }

  const plan = s.staking as Record<string, unknown> | undefined;
  if (!plan || typeof plan !== "object") {
    add("staking", "Choose a staking plan.");
  } else {
    const base = Number(plan.type === "fixed" ? plan.amount : plan.base);
    if (!Number.isFinite(base) || base <= 0) add("staking", "Stake must be more than zero.");
    else if (base > MAX_STAKE) add("staking", "That stake is implausibly large.");

    if (plan.type === "martingale") {
      const m = Number(plan.multiplier);
      if (!Number.isFinite(m) || m <= 1) add("staking", "Multiplier must be greater than 1.");
      const steps = Number(plan.maxSteps);
      if (!Number.isFinite(steps) || steps < 1) add("staking", "Set a maximum step count.");
      // An uncapped-in-practice ladder is the single most reliable way to lose
      // an account, so it is refused rather than warned about.
      else if (steps > 15) add("staking", "More than 15 martingale steps is not allowed.");
    }
    if (plan.type === "dalembert") {
      const steps = Number(plan.maxSteps);
      if (!Number.isFinite(steps) || steps < 1) add("staking", "Set a maximum step count.");
    }
    if (!["fixed", "martingale", "dalembert"].includes(String(plan.type))) {
      add("staking", "Unknown staking plan.");
    }
  }

  if (typeof s.limits !== "object" || s.limits === null) add("limits", "Missing limits.");

  return issues.length === 0
    ? { ok: true, issues: [], strategy: input as Strategy }
    : { ok: false, issues };
}

/** Serialises a strategy for download. */
export function exportStrategy(strategy: Strategy): string {
  return JSON.stringify({ format: "tradezaki-strategy", version: 1, strategy }, null, 2);
}

/** Reads a downloaded strategy back, validating it before returning. */
export function importStrategyJson(text: string): {
  ok: boolean;
  issues: ValidationIssue[];
  strategy?: Strategy;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ field: "file", message: "That isn't valid JSON." }] };
  }
  const body = parsed as Record<string, unknown>;
  const candidate = body?.format === "tradezaki-strategy" ? body.strategy : parsed;
  return validateStrategy(candidate);
}
