import type { Database } from "../data/loader";
import type {
  EvidenceItem,
  PositionDetail,
  RoundDetail,
} from "./types";
import { convertCurrency, fmt, fmtNum } from "./fx";

export function getPositionDetail(
  investorId: string,
  companyName: string,
  db: Database
): PositionDetail | null {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const fxRates = db.fxRates;
  const toRpt = (amount: number, fromCcy: string) =>
    convertCurrency(amount, fromCcy, rptCcy, fxRates);

  // Find the company (case-insensitive, partial match allowed)
  const lowerQuery = companyName.toLowerCase();
  let matchedCompany = db.companiesByName.get(lowerQuery);
  if (!matchedCompany) {
    // Try partial match
    for (const [name, co] of db.companiesByName) {
      if (name.includes(lowerQuery) || lowerQuery.includes(name.split(" ")[0])) {
        matchedCompany = co;
        break;
      }
    }
  }
  if (!matchedCompany) return null;

  // Find all deals for this company where this investor has an allocation
  const dealIds = db.dealsByCompany.get(matchedCompany.company_id) ?? [];
  const rounds: RoundDetail[] = [];
  const evidence: EvidenceItem[] = [];

  let totalCommittedRpt = 0;
  let totalContributedRpt = 0;
  let totalCurrentValueRpt = 0;
  let totalDistributionsRpt = 0;

  for (const dealId of dealIds) {
    const deal = db.deals.get(dealId)!;
    const allocIds = (db.allocationsByDeal.get(dealId) ?? []).filter((aid) => {
      const a = db.allocations.get(aid);
      return a?.investor_id === investorId;
    });

    if (allocIds.length === 0) continue; // investor not in this round

    const alloc = db.allocations.get(allocIds[0])!;
    const dealCcy = alloc.deal_currency;

    const commitment = parseFloat(alloc.commitment_amount);
    const contributed = parseFloat(alloc.contributed_amount);
    const units = parseFloat(alloc.units);
    const effectiveSP = parseFloat(alloc.effective_share_price);
    const entryPrice = parseFloat(deal.entry_share_price);
    const priceDiscountPct = parseFloat(alloc.price_discount_pct || "0");

    // Distributions for this allocation
    const distIds = db.distributionsByAllocation.get(alloc.allocation_id) ?? [];
    const dists = distIds.map((id) => db.distributions.get(id)!);
    const realisedFraction = dists.reduce(
      (sum, d) => sum + parseFloat(d.fraction_of_units),
      0
    );
    const unrealisedFraction = Math.max(0, 1 - realisedFraction);

    const latestVal = db.latestValuation.get(dealId);
    let currentValueDealCcy = 0;
    if (deal.status === "Active" && latestVal) {
      currentValueDealCcy =
        units * parseFloat(latestVal.share_price) * unrealisedFraction;
    }

    const distributionsNetDealCcy = dists.reduce(
      (sum, d) => sum + parseFloat(d.net_amount),
      0
    );

    const commitmentRpt = toRpt(commitment, dealCcy);
    const contributedRpt = toRpt(contributed, dealCcy);
    const currentValueRpt = toRpt(currentValueDealCcy, dealCcy);
    const distributionsNetRpt = toRpt(distributionsNetDealCcy, dealCcy);

    totalCommittedRpt += commitmentRpt;
    totalContributedRpt += contributedRpt;
    totalCurrentValueRpt += currentValueRpt;
    totalDistributionsRpt += distributionsNetRpt;

    const moic =
      contributed > 0
        ? (currentValueRpt + distributionsNetRpt) / contributedRpt
        : null;

    const distributionDetails = dists.map((d) => ({
      distributionId: d.distribution_id,
      date: d.distribution_date,
      type: d.distribution_type,
      grossDealCcy: parseFloat(d.gross_amount),
      performanceFeePct: parseFloat(d.performance_fee_pct),
      performanceFeeAmount: parseFloat(d.performance_fee_amount),
      netDealCcy: parseFloat(d.net_amount),
      netRpt: toRpt(parseFloat(d.net_amount), d.currency),
      fractionOfUnits: parseFloat(d.fraction_of_units),
    }));

    rounds.push({
      allocationId: alloc.allocation_id,
      dealId,
      companyId: matchedCompany.company_id,
      companyName: matchedCompany.company_name,
      round: deal.round,
      sector: matchedCompany.sector,
      dealStatus: deal.status,
      allocationStatus: alloc.allocation_status as "Active" | "Pending",
      dealCurrency: dealCcy,
      reportingCurrency: rptCcy,
      commitmentDealCcy: commitment,
      contributedDealCcy: contributed,
      currentValueDealCcy,
      distributionsNetDealCcy,
      commitmentRpt,
      contributedRpt,
      currentValueRpt,
      distributionsNetRpt,
      moic,
      latestSharePrice: latestVal ? parseFloat(latestVal.share_price) : null,
      entrySharePrice: entryPrice,
      effectiveSharePrice: effectiveSP,
      units,
      priceDiscountPct,
      distributionDetails,
    });

    // Evidence
    evidence.push({
      id: alloc.allocation_id,
      sourceType: "allocation",
      label: `${matchedCompany.company_name} — ${deal.round}`,
      detail: `Commitment: ${fmt(commitment, dealCcy)} | Contributed: ${fmt(contributed, dealCcy)} | Units: ${fmtNum(units)} @ ${fmt(effectiveSP, dealCcy)} effective price${priceDiscountPct > 0 ? ` (${priceDiscountPct}% discount)` : ""}`,
      amount: commitmentRpt,
      currency: rptCcy,
      date: alloc.allocation_date,
    });

    if (latestVal) {
      evidence.push({
        id: latestVal.valuation_id,
        sourceType: "valuation",
        label: `${matchedCompany.company_name} ${deal.round} — latest mark`,
        detail: `Share price: ${latestVal.share_price} ${dealCcy} on ${latestVal.valuation_date} (${latestVal.mark_source}) | ${latestVal.multiple_vs_entry}× entry`,
        date: latestVal.valuation_date,
      });
    }

    for (const dist of dists) {
      evidence.push({
        id: dist.distribution_id,
        sourceType: "distribution",
        label: `${matchedCompany.company_name} ${dist.distribution_type} (${dist.distribution_date})`,
        detail: `Gross: ${fmt(parseFloat(dist.gross_amount), dist.currency)} | Carry: ${dist.performance_fee_pct}% (${fmt(parseFloat(dist.performance_fee_amount), dist.currency)}) | Net: ${fmt(parseFloat(dist.net_amount), dist.currency)}`,
        amount: toRpt(parseFloat(dist.net_amount), dist.currency),
        currency: rptCcy,
        date: dist.distribution_date,
      });
    }
  }

  if (rounds.length === 0) return null;

  const companyMoic =
    totalContributedRpt > 0
      ? (totalCurrentValueRpt + totalDistributionsRpt) / totalContributedRpt
      : null;

  return {
    companyName: matchedCompany.company_name,
    sector: matchedCompany.sector,
    hqCountry: matchedCompany.hq_country,
    companyStatus: matchedCompany.status,
    rounds,
    totalCommittedRpt,
    totalContributedRpt,
    totalCurrentValueRpt,
    totalDistributionsRpt,
    totalValueRpt: totalCurrentValueRpt + totalDistributionsRpt,
    companyMoic,
    reportingCurrency: rptCcy,
    evidence,
  };
}
