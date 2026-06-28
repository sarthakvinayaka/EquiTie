/**
 * Investor context resolver.
 *
 * Builds a fully populated, immutable InvestorContext from the database for
 * a given investor_id. Returns null if the investor does not exist.
 *
 * This is the single place where the "who is this request for?" question is
 * answered. All downstream policy guards and domain functions receive the
 * context object rather than re-deriving it from raw DB maps.
 */

import type { Database } from "../data/loader";
import type { InvestorContext } from "./types";

export function resolveInvestorContext(
  investorId: string,
  db: Database
): InvestorContext | null {
  const investor = db.investors.get(investorId);
  if (!investor) return null;

  // Collect every allocation ID for this investor
  const rawAllocIds = db.allocationsByInvestor.get(investorId) ?? [];
  const allocationIds = new Set(rawAllocIds);

  // Derive deal IDs and company IDs from those allocations
  const dealIds = new Set<string>();
  const companyIds = new Set<string>();
  const companyNamesLower = new Set<string>();

  for (const allocId of rawAllocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    dealIds.add(alloc.deal_id);

    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    companyIds.add(deal.company_id);

    const company = db.companies.get(deal.company_id);
    if (company) {
      companyNamesLower.add(company.company_name.toLowerCase());
    }
  }

  const age = investor.age ? parseFloat(investor.age) : null;

  return Object.freeze({
    investorId: investor.investor_id,
    investorName: investor.investor_name,
    reportingCurrency: investor.reporting_currency,
    techSavviness: investor.tech_savviness as InvestorContext["techSavviness"],
    age: Number.isFinite(age) ? age : null,
    companyIds: Object.freeze(companyIds),
    dealIds: Object.freeze(dealIds),
    allocationIds: Object.freeze(allocationIds),
    companyNamesLower: Object.freeze(companyNamesLower),
  });
}
