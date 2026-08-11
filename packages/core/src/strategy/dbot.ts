import { findAll, findFirst, fieldOf, isBlock, parseXml, slotOf, XmlError, type XmlNode } from "./xml";
import type { ContractSpec, StakingPlan, Strategy } from "./types";

/**
 * Imports a Deriv DBot (.xml) strategy.
 *
 * ## What this can and cannot do — read before trusting an import
 *
 * A DBot file is not configuration. Surveying 22 real community strategies, the
 * most common blocks by far are `variables_get`, `variables_set`,
 * `logic_compare`, `controls_if` and `math_arithmetic` — DBot is a general
 * imperative language drawn as blocks, and `before_purchase` / `after_purchase`
 * hold arbitrary programs.
 *
 * So this importer extracts the parts that ARE declarative and consistent
 * across every file — market, symbol, contract types, duration, stake, and a
 * recognisable martingale — and reports everything it could not translate.
 *
 * **It never silently substitutes `always` for logic it didn't understand.**
 * An import whose entry conditions weren't translatable comes back with
 * `needsReview: true`, and the caller must not run it until a human has set the
 * entry rules. Quietly turning "buy when RSI < 30" into "buy on every tick"
 * would drain an account in minutes while looking like it worked.
 */

export interface ImportWarning {
  /** Machine-readable so the UI can group them. */
  code:
    | "entry-logic-not-imported"
    | "exit-logic-not-imported"
    | "staking-not-recognised"
    | "unsupported-block"
    | "assumed-value";
  message: string;
}

export interface ImportResult {
  strategy: Strategy;
  warnings: ImportWarning[];
  /** True when the file's trading logic could not be fully translated. */
  needsReview: boolean;
  /** Block types present in the file that this importer ignored. */
  ignoredBlocks: string[];
}

export class DbotImportError extends Error {}

/** Maps DBot's trade-type names onto the contract types they buy. */
const TRADETYPE_CONTRACTS: Record<string, string[]> = {
  callput: ["CALL", "PUT"],
  risefall: ["CALL", "PUT"],
  risefallequals: ["CALLE", "PUTE"],
  callputequal: ["CALLE", "PUTE"],
  higherlower: ["HIGHER", "LOWER"],
  touchnotouch: ["ONETOUCH", "NOTOUCH"],
  evenodd: ["DIGITEVEN", "DIGITODD"],
  overunder: ["DIGITOVER", "DIGITUNDER"],
  matchesdiffers: ["DIGITMATCH", "DIGITDIFF"],
  asians: ["ASIANU", "ASIAND"],
  reset: ["RESETCALL", "RESETPUT"],
  runs: ["RUNHIGH", "RUNLOW"],
  highlowticks: ["TICKHIGH", "TICKLOW"],
  staysinout: ["RANGE", "UPORDOWN"],
  endsinout: ["EXPIRYRANGE", "EXPIRYMISS"],
};

/**
 * Contracts with no expiry. Sending them a duration is rejected outright, and
 * they each need their own parameter instead — which is why an imported
 * Accumulator was failing with "Buy rejected": it carried a duration it must
 * not have, and lacked the growth rate it must have.
 */
const NO_EXPIRY: Record<string, "growth" | "multiplier"> = {
  ACCU: "growth",
  MULTUP: "multiplier",
  MULTDOWN: "multiplier",
};

/** Blocks that are structural or that we translate; anything else is reported. */
const UNDERSTOOD = new Set([
  "trade",
  "trade_definition",
  "trade_definition_market",
  "trade_definition_tradetype",
  "trade_definition_contracttype",
  "trade_definition_candleinterval",
  "trade_definition_restartbuysell",
  "trade_definition_restartonerror",
  "trade_definition_tradeoptions",
  "tradeOptions",
  "before_purchase",
  "after_purchase",
  "during_purchase",
  "purchase",
  "trade_again",
  "math_number",
  "variables_set",
  "variables_get",
  "text",
]);

/** Resolves a numeric slot: a literal, or a variable we saw assigned a literal. */
function numberFrom(slot: XmlNode | null, vars: Map<string, number>): number | null {
  if (!slot) return null;
  const block = slot.children.find((c) => isBlock(c));
  // Blockly puts the default in a <shadow> and the override in a <block>;
  // both are children of the same <value>, so prefer a real block.
  const real = slot.children.find((c) => c.tag === "block") ?? block;
  if (!real) return null;

  if (real.attrs.type === "math_number") {
    const n = Number(fieldOf(real, "NUM"));
    return Number.isFinite(n) ? n : null;
  }
  if (real.attrs.type === "variables_get") {
    const name = fieldOf(real, "VAR");
    if (name && vars.has(name)) return vars.get(name)!;
    return null;
  }
  return null;
}

/** Collects `variables_set` assignments whose value is a plain number. */
function collectVariables(root: XmlNode): Map<string, number> {
  const vars = new Map<string, number>();
  for (const set of findAll(root, (n) => isBlock(n, "variables_set"))) {
    const name = fieldOf(set, "VAR");
    if (!name) continue;
    const value = slotOf(set, "VALUE");
    const literal = value?.children.find((c) => isBlock(c, "math_number"));
    if (literal) {
      const n = Number(fieldOf(literal, "NUM"));
      if (Number.isFinite(n)) vars.set(name, n);
    }
  }
  return vars;
}

/**
 * Looks for the martingale shape: a stake variable multiplied by a constant
 * inside `after_purchase`. This is a heuristic on hand-written programs, so a
 * miss is reported rather than guessed at.
 */
function detectStaking(root: XmlNode, baseStake: number, vars: Map<string, number>): {
  plan: StakingPlan;
  recognised: boolean;
} {
  const after = findFirst(root, (n) => isBlock(n, "after_purchase"));
  if (after) {
    for (const arith of findAll(after, (n) => isBlock(n, "math_arithmetic"))) {
      if (fieldOf(arith, "OP") !== "MULTIPLY") continue;
      for (const slot of ["A", "B"]) {
        const v = numberFrom(slotOf(arith, slot), vars);
        // A multiplier of 1 isn't a martingale, and huge values are almost
        // certainly something else in the program.
        if (v !== null && v > 1 && v <= 10) {
          return {
            plan: {
              type: "martingale",
              base: baseStake,
              multiplier: v,
              // Not stated in the file. Capped conservatively — the user raises
              // it deliberately, having seen the worst-case exposure.
              maxSteps: 5,
            },
            recognised: true,
          };
        }
      }
    }
  }
  return { plan: { type: "fixed", amount: baseStake }, recognised: false };
}

export function importDbotXml(xml: string, fallbackName = "Imported strategy"): ImportResult {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (err) {
    throw new DbotImportError(
      err instanceof XmlError ? err.message : "That file isn't valid XML."
    );
  }

  // DBot has shipped two layouts. The older one puts every field on a single
  // `trade` block; the newer one nests `trade_definition_*` blocks under
  // `trade_definition`. Both are in active circulation, so support both — a
  // third of the community files tested used the newer shape.
  const trade =
    findFirst(root, (n) => isBlock(n, "trade")) ??
    findFirst(root, (n) => isBlock(n, "trade_definition"));
  if (!trade) {
    throw new DbotImportError(
      "No trade definition found. Is this a Deriv Bot strategy file?"
    );
  }

  // Fields live either directly on the block, or on a nested definition block.
  const tradeField = (name: string): string | null => {
    const direct = fieldOf(trade, name);
    if (direct !== null) return direct;
    for (const b of findAll(trade, (n) => isBlock(n) && n.attrs.type?.startsWith("trade_definition"))) {
      const v = fieldOf(b, name);
      if (v !== null) return v;
    }
    return null;
  };

  const symbol = tradeField("SYMBOL_LIST");
  if (!symbol) throw new DbotImportError("The strategy doesn't specify a market.");

  const warnings: ImportWarning[] = [];

  const vars = collectVariables(root);

  // ---- contract types, from the purchase blocks that actually run ----------
  const purchases = findAll(root, (n) => isBlock(n, "purchase"))
    .map((p) => fieldOf(p, "PURCHASE_LIST"))
    .filter((v): v is string => !!v);
  let types = [...new Set(purchases)];

  // Fall back to the declared trade type when purchases are computed at runtime.
  if (types.length === 0) {
    const cat = tradeField("TRADETYPE_LIST") ?? tradeField("TRADETYPECAT_LIST");
    const typeList = tradeField("TYPE_LIST");
    const pair = cat ? TRADETYPE_CONTRACTS[cat] : undefined;
    if (pair) {
      types =
        typeList && typeList !== "both" && pair.includes(typeList) ? [typeList] : [...pair];
      warnings.push({
        code: "assumed-value",
        message: `Contract types weren't stated literally, so they were taken from the "${cat}" trade type. Check them before running.`,
      });
    }
  }

  if (types.length === 0) {
    throw new DbotImportError("Couldn't work out which contract this strategy buys.");
  }

  // ---- trade options -------------------------------------------------------
  const options =
    findFirst(root, (n) => isBlock(n, "tradeOptions")) ??
    findFirst(root, (n) => isBlock(n, "trade_definition_tradeoptions"));
  const durationUnit = (options && fieldOf(options, "DURATIONTYPE_LIST")) || "t";
  const duration = (options && numberFrom(slotOf(options, "DURATION"), vars)) ?? 5;
  let stake = (options && numberFrom(slotOf(options, "AMOUNT"), vars)) ?? null;

  if (stake === null) {
    stake = 1;
    warnings.push({
      code: "assumed-value",
      message: "Couldn't read the stake from the file, so it's set to 1. Check it before running.",
    });
  }

  const barrierType = options ? fieldOf(options, "BARRIEROFFSETTYPE_LIST") : null;
  const barrierValue = options ? numberFrom(slotOf(options, "BARRIEROFFSET"), vars) : null;
  const barrier =
    barrierType && barrierValue !== null ? `${barrierType}${barrierValue}` : undefined;

  const spec = (contractType: string): ContractSpec => {
    const special = NO_EXPIRY[contractType];
    if (special === "growth") {
      // 3% is Deriv's middle option and the common default.
      return { contractType, basis: "stake", growthRate: 0.03 };
    }
    if (special === "multiplier") {
      return { contractType, basis: "stake", multiplier: 100 };
    }
    return {
      contractType,
      basis: "stake",
      duration,
      durationUnit: durationUnit as ContractSpec["durationUnit"],
      ...(barrier ? { barrier } : {}),
    };
  };

  // ---- staking -------------------------------------------------------------
  const { plan, recognised } = detectStaking(root, stake, vars);
  if (!recognised) {
    warnings.push({
      code: "staking-not-recognised",
      message:
        "No martingale pattern was recognised, so the stake is fixed. If the original raised the stake after a loss, set that up yourself.",
    });
  }

  if (types.some((t) => t in NO_EXPIRY)) {
    warnings.push({
      code: "assumed-value",
      message:
        "This strategy trades a contract with no expiry (Accumulator or Multiplier). Its growth rate / multiplier isn't in the file, so a default was used — check it, and note these can't be dry-run.",
    });
  }

  // ---- the part that cannot be translated ---------------------------------
  // DBot's before_purchase is a program. We do not attempt to interpret it, and
  // we refuse to pretend "always" was what the author meant.
  warnings.push({
    code: "entry-logic-not-imported",
    message:
      "The original's entry conditions are a Blockly program and were not imported. Set when this should trade before running it.",
  });

  const during = findFirst(root, (n) => isBlock(n, "during_purchase"));
  if (during && during.children.some((c) => c.children.length > 0)) {
    warnings.push({
      code: "exit-logic-not-imported",
      message: "The original had sell-while-open logic, which was not imported.",
    });
  }

  const ignoredBlocks = [
    ...new Set(
      findAll(root, (n) => isBlock(n))
        .map((n) => n.attrs.type)
        .filter((t): t is string => !!t && !UNDERSTOOD.has(t))
    ),
  ].sort();

  const strategy: Strategy = {
    name: fallbackName,
    symbol,
    contract: spec(types[0]),
    ...(types[1]
      ? { contractAlt: spec(types[1]), entryAlt: { op: "always" as const } }
      : {}),
    // NOT a real entry rule — deliberately paired with needsReview so the caller
    // has to make the user choose one.
    entry: { op: "always" },
    staking: plan,
    limits: { maxStake: Math.max(stake * 20, stake) },
    cooldownTicks: 1,
  };

  return { strategy, warnings, needsReview: true, ignoredBlocks };
}
