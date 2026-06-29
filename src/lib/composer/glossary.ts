import type { GlossaryEntry } from "./types";
import type { QueryIntent } from "../domain/types";

// ─── Master glossary ──────────────────────────────────────────────────────────

const GLOSSARY: Record<string, GlossaryEntry> = {
  moic: {
    term: "MOIC",
    abbreviation: "Multiple on Invested Capital",
    shortDef: "How many times your money has come back (or is currently worth) vs. what you put in.",
    formula: "MOIC = (Current value + Net distributions) ÷ Total contributed capital",
    context: "A MOIC of 2.0× means your position is currently worth twice what you invested, counting both unrealised value and cash received.",
  },
  irr: {
    term: "IRR",
    abbreviation: "Internal Rate of Return",
    shortDef: "The annualised return rate that makes the net present value of all cash flows equal to zero.",
    formula: "IRR solves: 0 = Σ(cashflow_t / (1 + IRR)^t)",
    context: "IRR accounts for when you invested and when you received returns, making it useful for comparing investments of different lengths.",
  },
  dpi: {
    term: "DPI",
    abbreviation: "Distributions to Paid-In",
    shortDef: "The multiple of invested capital actually returned to you as cash.",
    formula: "DPI = Total net distributions ÷ Total contributed capital",
    context: "DPI only counts money you have already received. A DPI of 1.0 means you have gotten back exactly what you put in.",
  },
  rvpi: {
    term: "RVPI",
    abbreviation: "Residual Value to Paid-In",
    shortDef: "The multiple of your remaining unrealised value vs. what you invested.",
    formula: "RVPI = Current unrealised value ÷ Total contributed capital",
    context: "RVPI reflects value still locked in the fund. MOIC = DPI + RVPI.",
  },
  tvpi: {
    term: "TVPI",
    abbreviation: "Total Value to Paid-In",
    shortDef: "The total value multiple — both what you've received and what's still held.",
    formula: "TVPI = (Current value + Net distributions) ÷ Contributed capital  (same as MOIC in this context)",
    context: "TVPI is another name for MOIC when used at the fund level.",
  },
  carry: {
    term: "Carry",
    abbreviation: "Carried interest / Performance fee",
    shortDef: "The share of profits taken by the fund manager when a deal is exited.",
    formula: "Carry = Performance fee % × Gross distribution",
    context: "For example, 20% carry on a USD 500,000 exit means the manager keeps USD 100,000 and you receive USD 400,000 net.",
  },
  management_fee: {
    term: "Management fee",
    shortDef: "An annual fee charged by the fund manager, typically as a percentage of your committed capital.",
    formula: "Annual management fee = Management fee % × Committed capital",
    context: "Unlike carry, management fees are charged regardless of performance — they cover the manager's operating costs.",
  },
  structuring_fee: {
    term: "Structuring fee",
    shortDef: "A one-time fee charged when a deal is structured, covering legal, advisory, and setup costs.",
    context: "Usually charged as a percentage of committed capital at the time of investment.",
  },
  admin_fee: {
    term: "Admin fee",
    shortDef: "A flat annual fee covering fund administration, reporting, and compliance costs.",
    context: "Admin fees are typically a fixed dollar amount (e.g. USD 450/year) rather than a percentage.",
  },
  capital_call: {
    term: "Capital call",
    shortDef: "A request from the fund manager to transfer a portion of your committed capital.",
    context: "You commit a total amount upfront, but only transfer it in instalments ('calls') as the fund identifies investments.",
  },
  nav: {
    term: "NAV",
    abbreviation: "Net Asset Value",
    shortDef: "The current estimated value of your holdings after subtracting any fees or liabilities.",
    context: "For private markets, NAV is based on the latest available valuation marks rather than real-time market prices.",
  },
  mark_to_market: {
    term: "Mark-to-market (valuation mark)",
    shortDef: "A periodic revaluation of an asset to its estimated current fair value.",
    context: "Private equity valuations are updated less frequently than public stocks — often quarterly or annually — so the stated value may lag the true market value.",
  },
  down_round: {
    term: "Down round",
    shortDef: "A funding round in which a company raises capital at a lower valuation than its previous round.",
    context: "A down round reduces the share price and the value of earlier investors' holdings.",
  },
  committed_capital: {
    term: "Committed capital",
    shortDef: "The total amount you have agreed to invest in a deal, including amounts not yet called.",
    context: "Committed capital ≥ contributed capital. The difference is the amount still to be called.",
  },
  contributed_capital: {
    term: "Contributed capital",
    shortDef: "The amount actually transferred to the fund — what you have paid in so far.",
    context: "MOIC is calculated on contributed capital, not committed capital. Pending allocations have contributed capital of zero.",
  },
  waterfall: {
    term: "Waterfall",
    shortDef: "The priority order in which profits are distributed: first to return capital to investors, then any preferred return, then carry to the manager.",
    context: "Different deals may use different waterfall structures, affecting how much carry is paid and when.",
  },
  hurdle_rate: {
    term: "Hurdle rate",
    shortDef: "The minimum return investors must receive before the fund manager is entitled to any carry.",
    context: "For example, an 8% hurdle means the fund must return 8% annually to investors before any carry is paid.",
  },
};

// ─── Intent → relevant terms ──────────────────────────────────────────────────

const INTENT_TERMS: Record<string, string[]> = {
  portfolio_overview: ["moic", "committed_capital", "contributed_capital", "mark_to_market"],
  position_detail: ["moic", "contributed_capital", "mark_to_market", "down_round"],
  obligations: ["capital_call", "management_fee", "admin_fee"],
  distributions: ["carry", "dpi", "moic"],
  fee_detail: ["management_fee", "carry", "structuring_fee", "admin_fee", "hurdle_rate"],
  valuation_history: ["mark_to_market", "down_round", "moic", "nav"],
  account_statement: ["capital_call", "committed_capital", "contributed_capital"],
  glossary_or_metric_explanation: [], // handled dynamically from entity
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the glossary entries relevant to this intent.
 * Also adds the specific term if the intent is glossary_or_metric_explanation.
 */
export function detectGlossaryTerms(
  intent: QueryIntent,
  metricOrTerm: string | null
): GlossaryEntry[] {
  const keys = [...(INTENT_TERMS[intent] ?? [])];

  // For glossary intent, add the specific term being asked about
  if (intent === "glossary_or_metric_explanation" && metricOrTerm) {
    const normalized = normalizeTerm(metricOrTerm);
    if (normalized && !keys.includes(normalized)) keys.unshift(normalized);
  }

  return keys
    .map((k) => GLOSSARY[k])
    .filter((e): e is GlossaryEntry => e !== undefined);
}

/** Look up a single glossary entry by approximate term name. */
export function lookupGlossaryTerm(term: string): GlossaryEntry | null {
  const key = normalizeTerm(term);
  return key ? (GLOSSARY[key] ?? null) : null;
}

function normalizeTerm(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  // Direct key match
  if (GLOSSARY[lower]) return lower;
  // Common aliases
  const aliases: Record<string, string> = {
    "carried interest": "carry",
    "performance fee": "carry",
    "management fee": "management_fee",
    "admin fee": "admin_fee",
    "administration fee": "admin_fee",
    "structuring fee": "structuring_fee",
    "capital call": "capital_call",
    "multiple on invested capital": "moic",
    "internal rate of return": "irr",
    "net asset value": "nav",
    "down round": "down_round",
    "committed capital": "committed_capital",
    "contributed capital": "contributed_capital",
    "mark to market": "mark_to_market",
    "mark-to-market": "mark_to_market",
    "hurdle": "hurdle_rate",
    "hurdle rate": "hurdle_rate",
  };
  return aliases[lower] ?? null;
}

export { GLOSSARY };
