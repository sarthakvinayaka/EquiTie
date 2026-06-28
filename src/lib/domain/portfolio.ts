import type { Database } from "../data/loader";
import type { EvidenceItem, PortfolioOverview, PositionSummary } from "./types";
import { convertCurrency, fmt, fmtNum } from "./fx";

export function getPortfolioOverview(
  investorId: string,
  db: Database
): PortfolioOverview {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const fxRates = db.fxRates;
  const toRpt = (amount: number, fromCcy: string) =>
    convertCurrency(amount, fromCcy, rptCcy, fxRates);

  const allocationIds = db.allocationsByInvestor.get(investorId) ?? [];
  const positions: PositionSummary[] = [];
  const evidence: EvidenceItem[] = [];

  let totalCommittedRpt = 0;
  let totalContributedRpt = 0;
  let totalCurrentValueRpt = 0;
  let totalDistributionsRpt = 0;
  let activePositions = 0;
  let pendingPositions = 0;

  for (const allocId of allocationIds) {
    const alloc = db.allocations.get(allocId)!;
    const deal = db.deals.get(alloc.deal_id)!;
    const company = db.companies.get(deal.company_id)!;
    const dealCcy = alloc.deal_currency;

    const commitment = parseFloat(alloc.commitment_amount);
    const contributed = parseFloat(alloc.contributed_amount);
    const units = parseFloat(alloc.units);
    const effectiveSP = parseFloat(alloc.effective_share_price);
    const entryPrice = parseFloat(deal.entry_share_price);
    const priceDiscountPct = parseFloat(alloc.price_discount_pct || "0");

    // Fraction already realised via distributions on this allocation
    const distIds = db.distributionsByAllocation.get(allocId) ?? [];
    const dists = distIds.map((id) => db.distributions.get(id)!);
    const realisedFraction = dists.reduce(
      (sum, d) => sum + parseFloat(d.fraction_of_units),
      0
    );
    const unrealisedFraction = Math.max(0, 1 - realisedFraction);

    // Current unrealised value in deal currency
    const latestVal = db.latestValuation.get(alloc.deal_id);
    let currentValueDealCcy = 0;
    if (
      (deal.status === "Active") &&
      latestVal
    ) {
      currentValueDealCcy =
        units * parseFloat(latestVal.share_price) * unrealisedFraction;
    }
    // Exited / Written Off → current unrealised = 0 (distributions capture proceeds)

    // Net distributions on this allocation (already net of carry)
    const distributionsNetDealCcy = dists.reduce(
      (sum, d) => sum + parseFloat(d.net_amount),
      0
    );

    // Convert to reporting currency
    const commitmentRpt = toRpt(commitment, dealCcy);
    const contributedRpt = toRpt(contributed, dealCcy);
    const currentValueRpt = toRpt(currentValueDealCcy, dealCcy);
    const distributionsNetRpt = toRpt(distributionsNetDealCcy, dealCcy);

    totalCommittedRpt += commitmentRpt;
    totalContributedRpt += contributedRpt;
    totalCurrentValueRpt += currentValueRpt;
    totalDistributionsRpt += distributionsNetRpt;

    if (alloc.allocation_status === "Pending") {
      pendingPositions++;
    } else {
      activePositions++;
    }

    // MOIC only meaningful when capital has been deployed
    const moic =
      contributed > 0
        ? (currentValueRpt + distributionsNetRpt) / contributedRpt
        : null;

    positions.push({
      allocationId: allocId,
      dealId: alloc.deal_id,
      companyId: deal.company_id,
      companyName: company.company_name,
      round: deal.round,
      sector: company.sector,
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
    });

    // Allocation evidence
    evidence.push({
      id: allocId,
      sourceType: "allocation",
      label: `${company.company_name} — ${deal.round}`,
      detail: `Commitment: ${fmt(commitment, dealCcy)} | Contributed: ${fmt(contributed, dealCcy)} | Units: ${fmtNum(units)}`,
      amount: commitmentRpt,
      currency: rptCcy,
      date: alloc.allocation_date,
    });

    // Valuation evidence
    if (latestVal) {
      evidence.push({
        id: latestVal.valuation_id,
        sourceType: "valuation",
        label: `${company.company_name} latest mark (${latestVal.valuation_date})`,
        detail: `Share price: ${latestVal.share_price} ${dealCcy} | Source: ${latestVal.mark_source} | ${latestVal.multiple_vs_entry}× entry`,
        date: latestVal.valuation_date,
      });
    }

    // Distribution evidence
    for (const dist of dists) {
      evidence.push({
        id: dist.distribution_id,
        sourceType: "distribution",
        label: `${company.company_name} distribution (${dist.distribution_date})`,
        detail: `${dist.distribution_type} | Net: ${fmt(parseFloat(dist.net_amount), dist.currency)} | Carry: ${dist.performance_fee_pct}%`,
        amount: distributionsNetRpt,
        currency: rptCcy,
        date: dist.distribution_date,
      });
    }
  }

  const portfolioMoic =
    totalContributedRpt > 0
      ? (totalCurrentValueRpt + totalDistributionsRpt) / totalContributedRpt
      : null;

  return {
    investorId,
    reportingCurrency: rptCcy,
    totalCommittedRpt,
    totalContributedRpt,
    totalCurrentValueRpt,
    totalDistributionsRpt,
    totalValueRpt: totalCurrentValueRpt + totalDistributionsRpt,
    portfolioMoic,
    activePositions,
    pendingPositions,
    positions,
    evidence,
  };
}
