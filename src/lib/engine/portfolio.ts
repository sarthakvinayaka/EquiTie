import type { Database } from "../data/loader";
import type { PortfolioOverview, PositionDetail, PositionSummary } from "../domain/types";
import type { EngineResult } from "./types";
import { getPortfolioOverview } from "../domain/portfolio";
import { getPositionDetail } from "../domain/positions";

const REPORT_DATE = "2026-06-25";

// Shared assumptions that apply to all portfolio calculations
const PORTFOLIO_ASSUMPTIONS = [
  `Report date: ${REPORT_DATE}. FX rates are fixed at the dataset snapshot — live rates may differ.`,
  "All amounts converted to the investor's reporting currency via USD as the bridge currency (amount × fromRate / toRate).",
  "MOIC = (Current Unrealised Value + Net Distributions) / Contributed Capital.",
  "Unrealised value = units × latest share price × (1 − sum(fraction_of_units from distributions)).",
  "Exited and Written Off deals contribute 0 to unrealised value; their proceeds appear in distributions.",
  "Pending allocations (contributed_amount = 0) are excluded from MOIC and contributed totals.",
];

// ─── getInvestorPortfolioOverview ─────────────────────────────────────────────

export function getInvestorPortfolioOverview(
  investorId: string,
  db: Database
): EngineResult<PortfolioOverview> {
  const raw = getPortfolioOverview(investorId, db);
  const warnings: string[] = [];

  // Warn about pending allocations
  if (raw.pendingPositions > 0) {
    warnings.push(
      `${raw.pendingPositions} pending allocation(s) excluded from MOIC and contributed totals (contributed_amount = 0).`
    );
  }

  // Warn about active positions with no valuation
  const allocIds = db.allocationsByInvestor.get(investorId) ?? [];
  for (const allocId of allocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    if (deal.status === "Active" && !db.latestValuation.has(deal.deal_id)) {
      const co = db.companies.get(deal.company_id);
      warnings.push(
        `No valuation found for active deal "${co?.company_name ?? deal.deal_id}" (${deal.round}) — current value shown as 0.`
      );
    }
  }

  // Warn about written-off positions
  const writtenOff = raw.positions.filter((p) => p.dealStatus === "Written Off");
  if (writtenOff.length > 0) {
    const names = [...new Set(writtenOff.map((p) => p.companyName))].join(", ");
    warnings.push(
      `Written-off position(s): ${names}. Unrealised value = 0; any proceeds are in distributions.`
    );
  }

  // Warn if FX conversion was needed but currencies are non-standard
  const currencies = new Set(raw.positions.map((p) => p.dealCurrency));
  currencies.delete(raw.reportingCurrency);
  if (currencies.size > 0) {
    warnings.push(
      `Multi-currency portfolio: deal currencies [${[...currencies].join(", ")}] converted to ${raw.reportingCurrency} using static FX rates as of ${REPORT_DATE}.`
    );
  }

  return {
    result: raw,
    evidence: raw.evidence,
    assumptions: PORTFOLIO_ASSUMPTIONS,
    warnings,
  };
}

// ─── getInvestorPositions ──────────────────────────────────────────────────────

/**
 * Returns the flat list of all positions (one row per allocation).
 * Unlike getPortfolioOverview, this does NOT group multi-round companies together.
 * Use getInvestorPositionByCompany for a grouped, multi-round view.
 */
export function getInvestorPositions(
  investorId: string,
  db: Database
): EngineResult<PositionSummary[]> {
  const raw = getPortfolioOverview(investorId, db);
  const warnings: string[] = [];

  const pending = raw.positions.filter((p) => p.allocationStatus === "Pending");
  if (pending.length > 0) {
    warnings.push(
      `${pending.length} pending position(s) included in list but MOIC is null (no capital contributed yet).`
    );
  }

  const active = raw.positions.filter((p) => p.dealStatus === "Active");
  const exited = raw.positions.filter((p) => p.dealStatus === "Exited");
  const writtenOff = raw.positions.filter((p) => p.dealStatus === "Written Off");

  if (writtenOff.length > 0) {
    warnings.push(
      `${writtenOff.length} written-off position(s) — current value = 0.`
    );
  }

  // Detect multi-round companies so callers know to use getInvestorPositionByCompany
  const companyCounts = new Map<string, number>();
  for (const pos of raw.positions) {
    companyCounts.set(pos.companyName, (companyCounts.get(pos.companyName) ?? 0) + 1);
  }
  const multiRound = [...companyCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([name]) => name);
  if (multiRound.length > 0) {
    warnings.push(
      `Multi-round positions detected for: ${multiRound.join(", ")}. Use getInvestorPositionByCompany for aggregated view.`
    );
  }

  return {
    result: raw.positions,
    evidence: raw.evidence,
    assumptions: [
      ...PORTFOLIO_ASSUMPTIONS,
      `Positions: ${active.length} active, ${exited.length} exited, ${writtenOff.length} written off, ${pending.length} pending.`,
    ],
    warnings,
  };
}

// ─── getInvestorPositionByCompany ─────────────────────────────────────────────

/**
 * Returns a detailed view of one company — all rounds aggregated.
 * result is null when the company is not found in the investor's portfolio.
 *
 * companyQuery: partial or full company name, case-insensitive.
 */
export function getInvestorPositionByCompany(
  investorId: string,
  companyQuery: string,
  db: Database
): EngineResult<PositionDetail | null> {
  const raw = getPositionDetail(investorId, companyQuery, db);
  const warnings: string[] = [];

  if (!raw) {
    return {
      result: null,
      evidence: [],
      assumptions: PORTFOLIO_ASSUMPTIONS,
      warnings: [`No position found matching "${companyQuery}" in investor ${investorId}'s portfolio.`],
    };
  }

  // Per-round warnings
  for (const round of raw.rounds) {
    if (round.allocationStatus === "Pending") {
      warnings.push(
        `${raw.companyName} ${round.round}: Pending — no capital contributed yet. MOIC = N/A.`
      );
    }
    if (round.dealStatus === "Active" && round.latestSharePrice === null) {
      warnings.push(
        `${raw.companyName} ${round.round}: No valuation mark found — current value shown as 0.`
      );
    }
    if (round.dealStatus === "Written Off") {
      warnings.push(
        `${raw.companyName} ${round.round}: Written off — unrealised value = 0.`
      );
    }
    if (round.priceDiscountPct > 0) {
      warnings.push(
        `${raw.companyName} ${round.round}: Investor received a ${round.priceDiscountPct}% price discount vs. standard entry price.`
      );
    }
  }

  // Multi-round note
  if (raw.rounds.length > 1) {
    const totalContributed = raw.rounds.reduce((s, r) => s + r.contributedRpt, 0);
    // Weighted average effective price in deal currency (use first round currency for simplicity)
    const dealCcys = [...new Set(raw.rounds.map((r) => r.dealCurrency))];
    warnings.push(
      `Multi-round position (${raw.rounds.length} rounds). Company MOIC and totals are aggregated across all rounds. Currencies: [${dealCcys.join(", ")}] → ${raw.reportingCurrency}.`
    );
    if (totalContributed === 0) {
      warnings.push("All rounds are pending — aggregated MOIC is null.");
    }
  }

  return {
    result: raw,
    evidence: raw.evidence,
    assumptions: [
      ...PORTFOLIO_ASSUMPTIONS,
      raw.rounds.length > 1
        ? "Weighted cost basis and company MOIC aggregate across all rounds in the investor's reporting currency."
        : "Single-round position.",
    ],
    warnings,
  };
}
