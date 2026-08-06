/**
 * Presentation metadata for Deriv contract types.
 *
 * Deriv returns raw codes ("DIGITOVER", "EXPIRYRANGEE"). This maps them to
 * something a human can pick from, and records what extra input each one needs
 * so the trade panel can render the right controls.
 *
 * What's *tradable* still comes from `getContractsFor()` at runtime — this only
 * describes how to display and configure a type once the API says it exists.
 */

export type BarrierKind =
  | "none"
  /** A price offset like "+0.35" / "-1.20", relative to the current spot. */
  | "offset"
  /** A single digit 0–9, sent in the barrier field. */
  | "digit"
  /** An upper and a lower bound. */
  | "range"
  /** Pick which tick of the series to bet on (High/Low Tick). */
  | "tick";

export interface ContractPair {
  /** Deriv's `contract_category`, used to group the tabs. */
  category: string;
  label: string;
  /** One-line explanation shown under the tab. */
  blurb: string;
  barrier: BarrierKind;
  /** The two opposing sides, rendered as the buy buttons. */
  sides: { type: string; label: string; tone: "up" | "down" }[];
}

export const CONTRACT_PAIRS: ContractPair[] = [
  {
    category: "callput",
    label: "Rise / Fall",
    blurb: "Will the market finish above or below where it started?",
    barrier: "none",
    sides: [
      { type: "CALL", label: "Rise", tone: "up" },
      { type: "PUT", label: "Fall", tone: "down" },
    ],
  },
  {
    category: "callputequal",
    label: "Rise / Fall (equals)",
    blurb: "Same as Rise/Fall, but an exact tie also pays out.",
    barrier: "none",
    sides: [
      { type: "CALLE", label: "Rise or equal", tone: "up" },
      { type: "PUTE", label: "Fall or equal", tone: "down" },
    ],
  },
  {
    category: "higherlower",
    label: "Higher / Lower",
    blurb: "Will the market finish above or below a barrier you choose?",
    barrier: "offset",
    sides: [
      { type: "HIGHER", label: "Higher", tone: "up" },
      { type: "LOWER", label: "Lower", tone: "down" },
    ],
  },
  {
    category: "touchnotouch",
    label: "Touch / No Touch",
    blurb: "Will the market ever touch the barrier before expiry?",
    barrier: "offset",
    sides: [
      { type: "ONETOUCH", label: "Touch", tone: "up" },
      { type: "NOTOUCH", label: "No Touch", tone: "down" },
    ],
  },
  {
    category: "digits",
    label: "Even / Odd",
    blurb: "Will the last digit of the final tick be even or odd?",
    barrier: "none",
    sides: [
      { type: "DIGITEVEN", label: "Even", tone: "up" },
      { type: "DIGITODD", label: "Odd", tone: "down" },
    ],
  },
  {
    category: "digits-overunder",
    label: "Over / Under",
    blurb: "Will the last digit be over or under the one you pick?",
    barrier: "digit",
    sides: [
      { type: "DIGITOVER", label: "Over", tone: "up" },
      { type: "DIGITUNDER", label: "Under", tone: "down" },
    ],
  },
  {
    category: "digits-matchdiff",
    label: "Matches / Differs",
    blurb: "Will the last digit exactly match the one you pick?",
    barrier: "digit",
    sides: [
      { type: "DIGITMATCH", label: "Matches", tone: "up" },
      { type: "DIGITDIFF", label: "Differs", tone: "down" },
    ],
  },
  {
    category: "staysinout",
    label: "Stays In / Goes Out",
    blurb: "Will the market stay between two barriers, or break out?",
    barrier: "range",
    sides: [
      { type: "RANGE", label: "Stays in", tone: "up" },
      { type: "UPORDOWN", label: "Goes out", tone: "down" },
    ],
  },
  {
    category: "endsinout",
    label: "Ends In / Out",
    blurb: "Will the market *finish* between two barriers?",
    barrier: "range",
    sides: [
      { type: "EXPIRYRANGE", label: "Ends in", tone: "up" },
      { type: "EXPIRYMISS", label: "Ends out", tone: "down" },
    ],
  },
  {
    category: "asian",
    label: "Asians",
    blurb: "Will the last tick land above or below the average of all ticks?",
    barrier: "none",
    sides: [
      { type: "ASIANU", label: "Asian Up", tone: "up" },
      { type: "ASIAND", label: "Asian Down", tone: "down" },
    ],
  },
  {
    category: "reset",
    label: "Reset Call / Put",
    blurb: "The barrier resets to the spot at the halfway point.",
    barrier: "none",
    sides: [
      { type: "RESETCALL", label: "Reset Call", tone: "up" },
      { type: "RESETPUT", label: "Reset Put", tone: "down" },
    ],
  },
  {
    category: "highlowticks",
    label: "High / Low Tick",
    blurb: "Will the selected tick be the highest or lowest of the series?",
    barrier: "tick",
    sides: [
      { type: "TICKHIGH", label: "High Tick", tone: "up" },
      { type: "TICKLOW", label: "Low Tick", tone: "down" },
    ],
  },
  {
    category: "runs",
    label: "Only Ups / Only Downs",
    blurb: "Will every tick move consecutively in one direction?",
    barrier: "none",
    sides: [
      { type: "RUNHIGH", label: "Only Ups", tone: "up" },
      { type: "RUNLOW", label: "Only Downs", tone: "down" },
    ],
  },
];

export const MARKET_LABELS: Record<string, string> = {
  synthetic_index: "Synthetics",
  forex: "Forex",
  indices: "Stock Indices",
  cryptocurrency: "Crypto",
  commodities: "Commodities",
};

export function marketLabel(market: string): string {
  return MARKET_LABELS[market] ?? market.replace(/_/g, " ");
}

export const DURATION_UNIT_LABELS: Record<string, string> = {
  t: "ticks",
  s: "seconds",
  m: "minutes",
  h: "hours",
  d: "days",
};
