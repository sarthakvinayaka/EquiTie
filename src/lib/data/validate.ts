/**
 * Referential integrity checks and data anomaly detection.
 *
 * Takes raw row arrays (not the indexed maps) so there is no import cycle
 * with loader.ts. Called from loader.ts after all CSVs are parsed.
 */

import type {
  RawInvestor,
  RawPortfolioCompany,
  RawDeal,
  RawAllocation,
  RawValuation,
  RawCapitalCall,
  RawFee,
  RawDistribution,
  RawStatementLine,
  RawFxRate,
} from "./types";

// ─── Result types ──────────────────────────────────────────────────────────────

export interface JoinCheck {
  label: string;           // human-readable description
  sourceFile: string;
  sourceField: string;
  targetFile: string;
  targetField: string;
  total: number;           // rows checked
  matched: number;         // rows with a valid FK target
  dangling: string[];      // FK values that had no matching target (up to 20)
}

export type AnomalyType =
  | "zero_allocation_investor"   // investor with no allocations
  | "missing_valuation"          // active deal with no valuations
  | "contributed_zero"           // allocation where contributed_amount = 0
  | "fraction_overflow"          // allocation where sum(fraction_of_units) > 1
  | "fraction_underflow"         // exited deal where sum(fraction_of_units) < 1
  | "duplicate_pk"               // duplicate primary key in a file
  | "fx_currency_gap"            // currency in allocations/fees/distributions with no FX rate
  | "negative_amount";           // unexpected negative in a nominally positive field

export interface Anomaly {
  type: AnomalyType;
  description: string;
  ids: string[];               // relevant row or investor/deal IDs
}

export interface ValidationReport {
  joinChecks: JoinCheck[];
  anomalies: Anomaly[];
  generatedAt: string;         // ISO timestamp
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function buildSet(rows: Record<string, string>[], field: string): Set<string> {
  return new Set(rows.map((r) => r[field]).filter(Boolean));
}

function joinCheck(
  label: string,
  sourceFile: string,
  sourceRows: Record<string, string>[],
  sourceField: string,
  targetFile: string,
  targetKeys: Set<string>
): JoinCheck {
  const dangling: string[] = [];
  let matched = 0;

  for (const row of sourceRows) {
    const val = row[sourceField]?.trim() ?? "";
    if (!val) continue;
    if (targetKeys.has(val)) {
      matched++;
    } else {
      if (dangling.length < 20) dangling.push(val);
    }
  }

  return {
    label,
    sourceFile,
    sourceField,
    targetFile,
    targetField: sourceField,
    total: sourceRows.length,
    matched,
    dangling,
  };
}

function detectDuplicatePks(
  file: string,
  rows: Record<string, string>[],
  pkField: string
): Anomaly | null {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const pk = row[pkField]?.trim();
    if (!pk) continue;
    seen.set(pk, (seen.get(pk) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, count]) => count > 1).map(([k]) => k);
  if (dups.length === 0) return null;
  return {
    type: "duplicate_pk",
    description: `Duplicate primary keys in ${file}`,
    ids: dups,
  };
}

// ─── Main function ─────────────────────────────────────────────────────────────

export function runValidation(
  investors: RawInvestor[],
  companies: RawPortfolioCompany[],
  deals: RawDeal[],
  allocations: RawAllocation[],
  valuations: RawValuation[],
  capitalCalls: RawCapitalCall[],
  fees: RawFee[],
  distributions: RawDistribution[],
  statementLines: RawStatementLine[],
  fxRates: RawFxRate[]
): ValidationReport {
  const anomalies: Anomaly[] = [];

  // Cast to generic for reuse in helpers
  const r = <T>(arr: T[]): Record<string, string>[] =>
    arr as unknown as Record<string, string>[];

  // ── Build key sets ─────────────────────────────────────────────────────────
  const investorIds  = buildSet(r(investors),  "investor_id");
  const companyIds   = buildSet(r(companies),  "company_id");
  const dealIds      = buildSet(r(deals),      "deal_id");
  const allocationIds = buildSet(r(allocations), "allocation_id");
  const fxCurrencies = buildSet(r(fxRates),    "currency");

  // ── FK join checks ─────────────────────────────────────────────────────────
  const joinChecks: JoinCheck[] = [
    // deals → portfolio_companies
    joinCheck(
      "deals.company_id → portfolio_companies.company_id",
      "deals.csv", r(deals), "company_id",
      "portfolio_companies.csv", companyIds
    ),
    // allocations → deals
    joinCheck(
      "allocations.deal_id → deals.deal_id",
      "allocations.csv", r(allocations), "deal_id",
      "deals.csv", dealIds
    ),
    // allocations → investors
    joinCheck(
      "allocations.investor_id → investors.investor_id",
      "allocations.csv", r(allocations), "investor_id",
      "investors.csv", investorIds
    ),
    // valuations → deals
    joinCheck(
      "valuations.deal_id → deals.deal_id",
      "valuations.csv", r(valuations), "deal_id",
      "deals.csv", dealIds
    ),
    // capital_calls → allocations
    joinCheck(
      "capital_calls.allocation_id → allocations.allocation_id",
      "capital_calls.csv", r(capitalCalls), "allocation_id",
      "allocations.csv", allocationIds
    ),
    // capital_calls → investors
    joinCheck(
      "capital_calls.investor_id → investors.investor_id",
      "capital_calls.csv", r(capitalCalls), "investor_id",
      "investors.csv", investorIds
    ),
    // capital_calls → deals
    joinCheck(
      "capital_calls.deal_id → deals.deal_id",
      "capital_calls.csv", r(capitalCalls), "deal_id",
      "deals.csv", dealIds
    ),
    // fees → allocations
    joinCheck(
      "fees.allocation_id → allocations.allocation_id",
      "fees.csv", r(fees), "allocation_id",
      "allocations.csv", allocationIds
    ),
    // fees → investors
    joinCheck(
      "fees.investor_id → investors.investor_id",
      "fees.csv", r(fees), "investor_id",
      "investors.csv", investorIds
    ),
    // distributions → allocations
    joinCheck(
      "distributions.allocation_id → allocations.allocation_id",
      "distributions.csv", r(distributions), "allocation_id",
      "allocations.csv", allocationIds
    ),
    // distributions → investors
    joinCheck(
      "distributions.investor_id → investors.investor_id",
      "distributions.csv", r(distributions), "investor_id",
      "investors.csv", investorIds
    ),
    // statement_lines → investors
    joinCheck(
      "statement_lines.investor_id → investors.investor_id",
      "statement_lines.csv", r(statementLines), "investor_id",
      "investors.csv", investorIds
    ),
    // statement_lines → deals
    joinCheck(
      "statement_lines.deal_id → deals.deal_id",
      "statement_lines.csv", r(statementLines), "deal_id",
      "deals.csv", dealIds
    ),
  ];

  // ── Duplicate PK detection ─────────────────────────────────────────────────
  const pkChecks: [string, Record<string, string>[], string][] = [
    ["investors.csv",          r(investors),      "investor_id"],
    ["portfolio_companies.csv", r(companies),     "company_id"],
    ["deals.csv",              r(deals),          "deal_id"],
    ["allocations.csv",        r(allocations),    "allocation_id"],
    ["valuations.csv",         r(valuations),     "valuation_id"],
    ["capital_calls.csv",      r(capitalCalls),   "call_id"],
    ["fees.csv",               r(fees),           "fee_id"],
    ["distributions.csv",      r(distributions),  "distribution_id"],
    ["statement_lines.csv",    r(statementLines), "line_id"],
  ];
  for (const [file, rows, pk] of pkChecks) {
    const a = detectDuplicatePks(file, rows, pk);
    if (a) anomalies.push(a);
  }

  // ── Investors with zero allocations ───────────────────────────────────────
  const investorsWithAllocs = new Set(allocations.map((a) => a.investor_id));
  const zeroAllocInvestors = investors
    .filter((i) => !investorsWithAllocs.has(i.investor_id))
    .map((i) => i.investor_id);
  if (zeroAllocInvestors.length > 0) {
    anomalies.push({
      type: "zero_allocation_investor",
      description: "Investors with no allocation rows",
      ids: zeroAllocInvestors,
    });
  }

  // ── Active deals with no valuations ──────────────────────────────────────
  const dealsWithValuations = new Set(valuations.map((v) => v.deal_id));
  const missingValuation = deals
    .filter((d) => d.status === "Active" && !dealsWithValuations.has(d.deal_id))
    .map((d) => d.deal_id);
  if (missingValuation.length > 0) {
    anomalies.push({
      type: "missing_valuation",
      description: "Active deals with no valuation marks",
      ids: missingValuation,
    });
  }

  // ── Allocations where contributed_amount = 0 (pending) ───────────────────
  const zeroCont = allocations
    .filter((a) => parseFloat(a.contributed_amount) === 0)
    .map((a) => a.allocation_id);
  if (zeroCont.length > 0) {
    anomalies.push({
      type: "contributed_zero",
      description: "Pending allocations (contributed_amount = 0); excluded from MOIC",
      ids: zeroCont,
    });
  }

  // ── Fraction-of-units anomalies ────────────────────────────────────────────
  const fractionByAlloc = new Map<string, number>();
  for (const d of distributions) {
    const prev = fractionByAlloc.get(d.allocation_id) ?? 0;
    fractionByAlloc.set(d.allocation_id, prev + parseFloat(d.fraction_of_units || "0"));
  }

  const fractionOverflow: string[] = [];
  const fractionUnderflow: string[] = [];

  for (const [allocId, fraction] of fractionByAlloc) {
    if (fraction > 1.001) fractionOverflow.push(allocId);  // 0.1% tolerance
  }

  // For exited deals: sum should be ≥ 1 across all allocations for that deal
  const exitedDealIds = new Set(
    deals.filter((d) => d.status === "Exited").map((d) => d.deal_id)
  );
  const fractionByDeal = new Map<string, number>();
  for (const d of distributions) {
    if (!exitedDealIds.has(d.deal_id)) continue;
    const prev = fractionByDeal.get(d.allocation_id) ?? 0;
    fractionByDeal.set(d.allocation_id, prev + parseFloat(d.fraction_of_units || "0"));
  }
  for (const [allocId, fraction] of fractionByDeal) {
    if (fraction < 0.999) fractionUnderflow.push(allocId);
  }

  if (fractionOverflow.length > 0) {
    anomalies.push({
      type: "fraction_overflow",
      description: "Allocations where sum(fraction_of_units) > 1 (distributions exceed 100% of units)",
      ids: fractionOverflow,
    });
  }
  if (fractionUnderflow.length > 0) {
    anomalies.push({
      type: "fraction_underflow",
      description: "Exited-deal allocations where sum(fraction_of_units) < 1 (partial exit?)",
      ids: fractionUnderflow,
    });
  }

  // ── FX currency gaps ───────────────────────────────────────────────────────
  const currenciesInData = new Set<string>();
  for (const a of allocations)     { if (a.deal_currency) currenciesInData.add(a.deal_currency); }
  for (const f of fees)            { if (f.currency)      currenciesInData.add(f.currency); }
  for (const d of distributions)   { if (d.currency)      currenciesInData.add(d.currency); }
  for (const c of capitalCalls)    { if (c.currency)      currenciesInData.add(c.currency); }

  const missingFx = [...currenciesInData].filter((c) => !fxCurrencies.has(c));
  if (missingFx.length > 0) {
    anomalies.push({
      type: "fx_currency_gap",
      description: "Currencies used in data that have no FX rate",
      ids: missingFx,
    });
  }

  // ── Negative amounts where positive expected ───────────────────────────────
  const negativeCapCalls = capitalCalls
    .filter((c) => parseFloat(c.amount) < 0)
    .map((c) => c.call_id);
  const negativeFees = fees
    .filter((f) => parseFloat(f.amount) < 0)
    .map((f) => f.fee_id);

  if (negativeCapCalls.length > 0) {
    anomalies.push({
      type: "negative_amount",
      description: "Capital calls with negative amount (expected positive)",
      ids: negativeCapCalls,
    });
  }
  if (negativeFees.length > 0) {
    anomalies.push({
      type: "negative_amount",
      description: "Fees with negative amount (expected positive)",
      ids: negativeFees,
    });
  }

  return {
    joinChecks,
    anomalies,
    generatedAt: new Date().toISOString(),
  };
}
