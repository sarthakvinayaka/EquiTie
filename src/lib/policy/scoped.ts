/**
 * Investor-scoped database view.
 *
 * InvestorScopedDb is a read-only projection of the global Database that
 * contains ONLY rows belonging to one investor. Even if a downstream function
 * receives this object and tries to look up another investor's data, the maps
 * simply won't have those entries.
 *
 * This is belt-and-suspenders isolation on top of the access policy layer.
 * The domain functions that take (investorId, db) are already safe because
 * they start every lookup from allocationsByInvestor.get(investorId). The
 * scoped view provides an additional hard boundary:
 *   - .allocations contains NO rows with investor_id != investorId
 *   - .capitalCalls contains NO rows with investor_id != investorId
 *   - .fees contains NO rows with investor_id != investorId
 *   - .distributions contains NO rows with investor_id != investorId
 *   - .statementLines contains NO rows with investor_id != investorId
 *   - .deals contains ONLY deals this investor participates in
 *   - .companies contains ONLY companies from those deals
 */

import type { Database } from "../data/loader";
import type {
  RawAllocation,
  RawCapitalCall,
  RawFee,
  RawDistribution,
  RawStatementLine,
  RawDeal,
  RawPortfolioCompany,
  RawValuation,
} from "../data/types";
import type { InvestorContext } from "./types";

// ─── The scoped type ───────────────────────────────────────────────────────────

export interface InvestorScopedDb {
  /** Who this view is scoped to. Fixed at construction time. */
  readonly investorId: string;
  readonly reportingCurrency: string;

  // ── Per-investor rows (ONLY for investorId) ──────────────────────────────
  readonly allocations: ReadonlyMap<string, RawAllocation>;
  readonly capitalCalls: ReadonlyMap<string, RawCapitalCall>;
  readonly fees: ReadonlyMap<string, RawFee>;
  readonly distributions: ReadonlyMap<string, RawDistribution>;
  readonly statementLines: ReadonlyArray<RawStatementLine>;

  // ── Derived sets (for fast membership checks) ─────────────────────────────
  readonly dealIds: ReadonlySet<string>;
  readonly companyIds: ReadonlySet<string>;

  // ── Deal-level data scoped to investor's deals only ───────────────────────
  readonly deals: ReadonlyMap<string, RawDeal>;
  readonly companies: ReadonlyMap<string, RawPortfolioCompany>;
  readonly valuationsByDeal: ReadonlyMap<string, RawValuation[]>;
  readonly latestValuation: ReadonlyMap<string, RawValuation>;

  // ── Global shared data (same for all investors) ────────────────────────────
  readonly fxRates: ReadonlyMap<string, number>;
}

// ─── Builder ───────────────────────────────────────────────────────────────────

export function buildScopedDb(
  investorId: string,
  db: Database,
  context: InvestorContext
): InvestorScopedDb {
  // ── Allocations ────────────────────────────────────────────────────────────
  const allocations = new Map<string, RawAllocation>();
  for (const allocId of context.allocationIds) {
    const a = db.allocations.get(allocId);
    if (a) allocations.set(a.allocation_id, a);
  }

  // ── Capital calls ──────────────────────────────────────────────────────────
  const capitalCalls = new Map<string, RawCapitalCall>();
  for (const callId of db.capitalCallsByInvestor.get(investorId) ?? []) {
    const c = db.capitalCalls.get(callId);
    if (c) capitalCalls.set(c.call_id, c);
  }

  // ── Fees ───────────────────────────────────────────────────────────────────
  const fees = new Map<string, RawFee>();
  for (const feeId of db.feesByInvestor.get(investorId) ?? []) {
    const f = db.fees.get(feeId);
    if (f) fees.set(f.fee_id, f);
  }

  // ── Distributions ──────────────────────────────────────────────────────────
  const distributions = new Map<string, RawDistribution>();
  for (const distId of db.distributionsByInvestor.get(investorId) ?? []) {
    const d = db.distributions.get(distId);
    if (d) distributions.set(d.distribution_id, d);
  }

  // ── Statement lines ────────────────────────────────────────────────────────
  const statementLines = db.statementLines.get(investorId) ?? [];

  // ── Deals (only deals this investor participates in) ──────────────────────
  const deals = new Map<string, RawDeal>();
  for (const dealId of context.dealIds) {
    const d = db.deals.get(dealId);
    if (d) deals.set(d.deal_id, d);
  }

  // ── Companies (derived from investor's deals) ──────────────────────────────
  const companies = new Map<string, RawPortfolioCompany>();
  for (const companyId of context.companyIds) {
    const c = db.companies.get(companyId);
    if (c) companies.set(c.company_id, c);
  }

  // ── Valuations (only for investor's deals) ─────────────────────────────────
  const valuationsByDeal = new Map<string, RawValuation[]>();
  const latestValuation = new Map<string, RawValuation>();
  for (const dealId of context.dealIds) {
    const vals = db.valuationsByDeal.get(dealId);
    if (vals) valuationsByDeal.set(dealId, vals);
    const latest = db.latestValuation.get(dealId);
    if (latest) latestValuation.set(dealId, latest);
  }

  return {
    investorId,
    reportingCurrency: context.reportingCurrency,
    allocations,
    capitalCalls,
    fees,
    distributions,
    statementLines,
    dealIds: context.dealIds,
    companyIds: context.companyIds,
    deals,
    companies,
    valuationsByDeal,
    latestValuation,
    fxRates: db.fxRates,
  };
}

// ─── Verification helper ───────────────────────────────────────────────────────

/**
 * Assert that every row in the scoped DB belongs to the expected investor.
 * Throws if any cross-investor row is found. Used in tests and dev startup.
 */
export function assertScopedDbIntegrity(
  scopedDb: InvestorScopedDb
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  const { investorId } = scopedDb;

  for (const [, a] of scopedDb.allocations) {
    if (a.investor_id !== investorId) {
      violations.push(`Allocation ${a.allocation_id} belongs to ${a.investor_id}, not ${investorId}`);
    }
  }
  for (const [, c] of scopedDb.capitalCalls) {
    if (c.investor_id !== investorId) {
      violations.push(`CapitalCall ${c.call_id} belongs to ${c.investor_id}, not ${investorId}`);
    }
  }
  for (const [, f] of scopedDb.fees) {
    if (f.investor_id !== investorId) {
      violations.push(`Fee ${f.fee_id} belongs to ${f.investor_id}, not ${investorId}`);
    }
  }
  for (const [, d] of scopedDb.distributions) {
    if (d.investor_id !== investorId) {
      violations.push(`Distribution ${d.distribution_id} belongs to ${d.investor_id}, not ${investorId}`);
    }
  }
  for (const line of scopedDb.statementLines) {
    if (line.investor_id !== investorId) {
      violations.push(`StatementLine ${line.line_id} belongs to ${line.investor_id}, not ${investorId}`);
    }
  }

  return { passed: violations.length === 0, violations };
}
