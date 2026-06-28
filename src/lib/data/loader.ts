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
import { parseCsv } from "./parser";
import type { ParseIssue, RowRef } from "./parser";
import { runValidation } from "./validate";
import type { ValidationReport } from "./validate";

export interface Database {
  // ── Core entity maps ───────────────────────────────────────────────────────
  investors: Map<string, RawInvestor>;
  companies: Map<string, RawPortfolioCompany>;
  companiesByName: Map<string, RawPortfolioCompany>; // lowercase name → company
  deals: Map<string, RawDeal>;
  dealsByCompany: Map<string, string[]>;             // company_id → deal_id[]
  allocations: Map<string, RawAllocation>;           // allocation_id → allocation
  allocationsByInvestor: Map<string, string[]>;      // investor_id → allocation_id[]
  allocationsByDeal: Map<string, string[]>;          // deal_id → allocation_id[]
  valuationsByDeal: Map<string, RawValuation[]>;     // deal_id → valuations sorted asc
  latestValuation: Map<string, RawValuation>;        // deal_id → latest mark
  capitalCalls: Map<string, RawCapitalCall>;         // call_id → call
  capitalCallsByAllocation: Map<string, string[]>;   // allocation_id → call_id[]
  capitalCallsByInvestor: Map<string, string[]>;     // investor_id → call_id[]
  fees: Map<string, RawFee>;                         // fee_id → fee
  feesByAllocation: Map<string, string[]>;           // allocation_id → fee_id[]
  feesByInvestor: Map<string, string[]>;             // investor_id → fee_id[]
  distributions: Map<string, RawDistribution>;       // dist_id → dist
  distributionsByAllocation: Map<string, string[]>;  // allocation_id → dist_id[]
  distributionsByInvestor: Map<string, string[]>;    // investor_id → dist_id[]
  statementLines: Map<string, RawStatementLine[]>;   // investor_id → lines sorted asc
  fxRates: Map<string, number>;                      // currency → to_usd

  // ── Provenance + diagnostics ───────────────────────────────────────────────
  parseIssues: ParseIssue[];                         // all issues from every CSV
  validationReport: ValidationReport;                // FK + anomaly report
  rowRefs: Map<string, RowRef>;                      // any PK → (file, rowIndex, pk)
  rawRows: Map<string, Record<string, string>>;      // any PK → raw CSV row
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _db: Database | null = null;

export function getDatabase(): Database {
  if (_db) return _db;

  // ── Parse every CSV with provenance tracking ───────────────────────────────
  const inv    = parseCsv<RawInvestor>("investors");
  const comp   = parseCsv<RawPortfolioCompany>("portfolio_companies");
  const dl     = parseCsv<RawDeal>("deals");
  const alloc  = parseCsv<RawAllocation>("allocations");
  const val    = parseCsv<RawValuation>("valuations");
  const cc     = parseCsv<RawCapitalCall>("capital_calls");
  const fee    = parseCsv<RawFee>("fees");
  const dist   = parseCsv<RawDistribution>("distributions");
  const stmt   = parseCsv<RawStatementLine>("statement_lines");
  const fx     = parseCsv<RawFxRate>("fx_rates");

  const investors      = inv.rows;
  const companies      = comp.rows;
  const deals          = dl.rows;
  const allocations    = alloc.rows;
  const valuations     = val.rows;
  const capitalCalls   = cc.rows;
  const fees           = fee.rows;
  const distributions  = dist.rows;
  const statementLines = stmt.rows;
  const fxRates        = fx.rows;

  // Merge all parse issues into a single list
  const parseIssues: ParseIssue[] = [
    ...inv.issues, ...comp.issues, ...dl.issues, ...alloc.issues,
    ...val.issues, ...cc.issues,  ...fee.issues, ...dist.issues,
    ...stmt.issues, ...fx.issues,
  ];

  // Merge all provenance maps (PK is globally unique across files by convention)
  const rowRefs   = new Map<string, RowRef>();
  const rawRows   = new Map<string, Record<string, string>>();
  for (const result of [inv, comp, dl, alloc, val, cc, fee, dist, stmt, fx]) {
    for (const [pk, ref] of result.rowRefs)  rowRefs.set(pk, ref);
    for (const [pk, row] of result.rawRows)  rawRows.set(pk, row);
  }

  // ── Build indexed maps (identical logic to original) ───────────────────────
  const db: Database = {
    investors: new Map(investors.map((i) => [i.investor_id, i])),
    companies: new Map(companies.map((c) => [c.company_id, c])),
    companiesByName: new Map(
      companies.map((c) => [c.company_name.toLowerCase(), c])
    ),
    deals: new Map(deals.map((d) => [d.deal_id, d])),
    dealsByCompany: new Map(),
    allocations: new Map(allocations.map((a) => [a.allocation_id, a])),
    allocationsByInvestor: new Map(),
    allocationsByDeal: new Map(),
    valuationsByDeal: new Map(),
    latestValuation: new Map(),
    capitalCalls: new Map(capitalCalls.map((c) => [c.call_id, c])),
    capitalCallsByAllocation: new Map(),
    capitalCallsByInvestor: new Map(),
    fees: new Map(fees.map((f) => [f.fee_id, f])),
    feesByAllocation: new Map(),
    feesByInvestor: new Map(),
    distributions: new Map(distributions.map((d) => [d.distribution_id, d])),
    distributionsByAllocation: new Map(),
    distributionsByInvestor: new Map(),
    statementLines: new Map(),
    fxRates: new Map(fxRates.map((r) => [r.currency, parseFloat(r.to_usd)])),
    parseIssues,
    validationReport: null as unknown as ValidationReport, // filled below
    rowRefs,
    rawRows,
  };

  // Index deals by company
  for (const deal of deals) {
    push(db.dealsByCompany, deal.company_id, deal.deal_id);
  }

  // Index allocations
  for (const a of allocations) {
    push(db.allocationsByInvestor, a.investor_id, a.allocation_id);
    push(db.allocationsByDeal, a.deal_id, a.allocation_id);
  }

  // Index and sort valuations; pick latest per deal
  for (const v of valuations) {
    const existing = db.valuationsByDeal.get(v.deal_id) ?? [];
    existing.push(v);
    db.valuationsByDeal.set(v.deal_id, existing);
  }
  for (const [dealId, vals] of db.valuationsByDeal) {
    const sorted = [...vals].sort(
      (a, b) =>
        new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
    );
    db.valuationsByDeal.set(dealId, sorted);
    db.latestValuation.set(dealId, sorted[sorted.length - 1]);
  }

  // Index capital calls
  for (const c of capitalCalls) {
    push(db.capitalCallsByAllocation, c.allocation_id, c.call_id);
    push(db.capitalCallsByInvestor, c.investor_id, c.call_id);
  }

  // Index fees
  for (const f of fees) {
    push(db.feesByAllocation, f.allocation_id, f.fee_id);
    push(db.feesByInvestor, f.investor_id, f.fee_id);
  }

  // Index distributions
  for (const d of distributions) {
    push(db.distributionsByAllocation, d.allocation_id, d.distribution_id);
    push(db.distributionsByInvestor, d.investor_id, d.distribution_id);
  }

  // Index statement lines sorted by date
  const stmtByInvestor = new Map<string, RawStatementLine[]>();
  for (const line of statementLines) {
    if (!stmtByInvestor.has(line.investor_id)) stmtByInvestor.set(line.investor_id, []);
    stmtByInvestor.get(line.investor_id)!.push(line);
  }
  for (const [invId, lines] of stmtByInvestor) {
    db.statementLines.set(
      invId,
      lines.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    );
  }

  // ── Run validation after all indexes are built ─────────────────────────────
  db.validationReport = runValidation(
    investors, companies, deals, allocations, valuations,
    capitalCalls, fees, distributions, statementLines, fxRates
  );

  if (parseIssues.length > 0) {
    const errors = parseIssues.filter((i) => i.severity === "error").length;
    const warns  = parseIssues.filter((i) => i.severity === "warn").length;
    console.warn(`[loader] Parse complete: ${errors} errors, ${warns} warnings across all CSVs`);
  } else {
    console.log("[loader] All CSVs parsed cleanly");
  }

  const anomalyCount = db.validationReport.anomalies.length;
  const failedJoins  = db.validationReport.joinChecks.filter(
    (j) => j.dangling.length > 0
  ).length;
  if (anomalyCount > 0 || failedJoins > 0) {
    console.warn(
      `[loader] Validation: ${failedJoins} FK issues, ${anomalyCount} anomalies`
    );
  } else {
    console.log("[loader] Validation: all FK checks passed, no anomalies");
  }

  _db = db;
  return _db;
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(value);
}

/** List all investors as { id, name } for the selector */
export function listInvestors(
  db: Database
): { id: string; name: string; type: string; reportingCurrency: string }[] {
  return [...db.investors.values()]
    .map((i) => ({
      id: i.investor_id,
      name: i.investor_name,
      type: i.investor_type,
      reportingCurrency: i.reporting_currency,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
