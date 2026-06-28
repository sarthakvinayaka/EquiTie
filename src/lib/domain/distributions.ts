import type { Database } from "../data/loader";
import type { DistributionDetail, DistributionSummary, EvidenceItem } from "./types";
import { convertCurrency, fmt } from "./fx";

export function getDistributions(
  investorId: string,
  db: Database
): DistributionSummary {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const fxRates = db.fxRates;
  const toRpt = (amount: number, fromCcy: string) =>
    convertCurrency(amount, fromCcy, rptCcy, fxRates);

  const distIds = db.distributionsByInvestor.get(investorId) ?? [];
  const distributions: DistributionDetail[] = [];
  const evidence: EvidenceItem[] = [];

  let totalGrossRpt = 0;
  let totalNetRpt = 0;
  let totalPerformanceFeeRpt = 0;

  for (const distId of distIds) {
    const dist = db.distributions.get(distId)!;
    const deal = db.deals.get(dist.deal_id)!;
    const company = db.companies.get(deal.company_id)!;

    const grossDealCcy = parseFloat(dist.gross_amount);
    const perfFeeAmt = parseFloat(dist.performance_fee_amount);
    const netDealCcy = parseFloat(dist.net_amount);
    const perfFeePct = parseFloat(dist.performance_fee_pct);
    const fractionOfUnits = parseFloat(dist.fraction_of_units);

    const netRpt = toRpt(netDealCcy, dist.currency);
    const grossRpt = toRpt(grossDealCcy, dist.currency);
    const perfFeeRpt = toRpt(perfFeeAmt, dist.currency);

    totalGrossRpt += grossRpt;
    totalNetRpt += netRpt;
    totalPerformanceFeeRpt += perfFeeRpt;

    distributions.push({
      distributionId: dist.distribution_id,
      dealId: dist.deal_id,
      companyName: company.company_name,
      round: deal.round,
      date: dist.distribution_date,
      type: dist.distribution_type,
      grossDealCcy,
      performanceFeePct: perfFeePct,
      performanceFeeAmountDealCcy: perfFeeAmt,
      netDealCcy,
      netRpt,
      dealCurrency: dist.currency,
      reportingCurrency: rptCcy,
      fractionOfUnits,
    });

    evidence.push({
      id: dist.distribution_id,
      sourceType: "distribution",
      label: `${company.company_name} ${deal.round} — ${dist.distribution_type}`,
      detail: `Date: ${dist.distribution_date} | Gross: ${fmt(grossDealCcy, dist.currency)} | Carry (${perfFeePct}%): ${fmt(perfFeeAmt, dist.currency)} | Net: ${fmt(netDealCcy, dist.currency)} | ${(fractionOfUnits * 100).toFixed(0)}% of position`,
      amount: netRpt,
      currency: rptCcy,
      date: dist.distribution_date,
    });
  }

  // Sort by date descending (most recent first)
  distributions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return {
    investorId,
    reportingCurrency: rptCcy,
    distributions,
    totalGrossRpt,
    totalNetRpt,
    totalPerformanceFeeRpt,
    evidence,
  };
}
