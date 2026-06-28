/**
 * Build a human-readable diagnostics summary from the loaded database.
 * Aggregates parse issues, validation results, and coverage stats.
 * Designed to power the /admin/diagnostics dev page and the /api/diagnostics endpoint.
 */

import { getDatabase } from "./loader";
import type { ParseIssue, RowRef } from "./parser";
import type { ValidationReport, JoinCheck, Anomaly } from "./validate";
import { SCHEMAS } from "./schema";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface TableStats {
  tableKey: string;
  file: string;
  rowCount: number;
  columnCount: number;
  parseErrors: number;
  parseWarnings: number;
}

export interface FxCoverage {
  currency: string;
  toUsd: number;
  asOf: string;
}

export interface MultiRoundCompany {
  companyId: string;
  companyName: string;
  dealCount: number;
  dealIds: string[];
}

export interface InvestorCoverage {
  totalInvestors: number;
  withAllocations: number;
  withoutAllocations: number;
  byTechSavviness: Record<string, number>;
  byType: Record<string, number>;
}

export interface DiagnosticsSummary {
  generatedAt: string;
  tableStats: TableStats[];
  parseIssues: ParseIssue[];
  validationReport: ValidationReport;
  fxCoverage: FxCoverage[];
  multiRoundCompanies: MultiRoundCompany[];
  investorCoverage: InvestorCoverage;
  rowRefs: Record<string, RowRef>;
}

// ─── Builder ───────────────────────────────────────────────────────────────────

export function buildDiagnostics(): DiagnosticsSummary {
  const db = getDatabase();

  // ── Table stats ────────────────────────────────────────────────────────────
  const tableStats: TableStats[] = Object.keys(SCHEMAS).map((key) => {
    const schema = SCHEMAS[key];
    const colCount = Object.keys(schema.columns).length;

    const errors   = db.parseIssues.filter((i) => i.file === schema.file && i.severity === "error").length;
    const warnings = db.parseIssues.filter((i) => i.file === schema.file && i.severity === "warn").length;

    // Row count from the appropriate Map in the db
    const rowCountMap: Record<string, number> = {
      investors:           db.investors.size,
      portfolio_companies: db.companies.size,
      deals:               db.deals.size,
      allocations:         db.allocations.size,
      valuations:          db.valuationsByDeal.size, // unique deals with valuations
      capital_calls:       db.capitalCalls.size,
      fees:                db.fees.size,
      distributions:       db.distributions.size,
      statement_lines:     [...db.statementLines.values()].reduce((sum, arr) => sum + arr.length, 0),
      fx_rates:            db.fxRates.size,
    };

    return {
      tableKey: key,
      file: schema.file,
      rowCount: rowCountMap[key] ?? 0,
      columnCount: colCount,
      parseErrors: errors,
      parseWarnings: warnings,
    };
  });

  // ── FX coverage ────────────────────────────────────────────────────────────
  const fxCoverage: FxCoverage[] = [...db.fxRates.entries()].map(([currency, toUsd]) => {
    const rawRow = db.rawRows.get(currency);
    return {
      currency,
      toUsd,
      asOf: rawRow?.as_of ?? "unknown",
    };
  });

  // ── Multi-round companies ──────────────────────────────────────────────────
  const multiRoundCompanies: MultiRoundCompany[] = [];
  for (const [companyId, dealIds] of db.dealsByCompany.entries()) {
    if (dealIds.length > 1) {
      const company = db.companies.get(companyId);
      multiRoundCompanies.push({
        companyId,
        companyName: company?.company_name ?? companyId,
        dealCount: dealIds.length,
        dealIds,
      });
    }
  }
  multiRoundCompanies.sort((a, b) => b.dealCount - a.dealCount);

  // ── Investor coverage ──────────────────────────────────────────────────────
  const withAllocations = new Set(
    [...db.allocationsByInvestor.entries()]
      .filter(([, ids]) => ids.length > 0)
      .map(([id]) => id)
  );

  const byTechSavviness: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const investor of db.investors.values()) {
    const ts = investor.tech_savviness || "Unknown";
    byTechSavviness[ts] = (byTechSavviness[ts] ?? 0) + 1;
    const t = investor.investor_type || "Unknown";
    byType[t] = (byType[t] ?? 0) + 1;
  }

  const investorCoverage: InvestorCoverage = {
    totalInvestors: db.investors.size,
    withAllocations: withAllocations.size,
    withoutAllocations: db.investors.size - withAllocations.size,
    byTechSavviness,
    byType,
  };

  // ── Row refs (serialisable for JSON API) ───────────────────────────────────
  const rowRefs: Record<string, RowRef> = {};
  for (const [pk, ref] of db.rowRefs.entries()) {
    rowRefs[pk] = ref;
  }

  return {
    generatedAt: new Date().toISOString(),
    tableStats,
    parseIssues: db.parseIssues,
    validationReport: db.validationReport,
    fxCoverage,
    multiRoundCompanies,
    investorCoverage,
    rowRefs,
  };
}
