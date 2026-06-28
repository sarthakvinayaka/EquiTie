import type { Database } from "../data/loader";
import type { EvidenceItem, ValuationHistory, ValuationMark } from "./types";
import { convertCurrency, fmt } from "./fx";

export function getValuationHistory(
  investorId: string,
  companyName: string,
  db: Database
): ValuationHistory[] {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const fxRates = db.fxRates;
  const toRpt = (amount: number, fromCcy: string) =>
    convertCurrency(amount, fromCcy, rptCcy, fxRates);

  // Find matching company
  const lowerQuery = companyName.toLowerCase();
  let matchedCompany = db.companiesByName.get(lowerQuery);
  if (!matchedCompany) {
    for (const [name, co] of db.companiesByName) {
      if (name.includes(lowerQuery) || lowerQuery.includes(name.split(" ")[0])) {
        matchedCompany = co;
        break;
      }
    }
  }
  if (!matchedCompany) return [];

  const dealIds = db.dealsByCompany.get(matchedCompany.company_id) ?? [];
  const histories: ValuationHistory[] = [];

  for (const dealId of dealIds) {
    const deal = db.deals.get(dealId)!;

    // Does this investor have an allocation in this deal?
    const allocIds = (db.allocationsByDeal.get(dealId) ?? []).filter((aid) => {
      const a = db.allocations.get(aid);
      return a?.investor_id === investorId;
    });
    if (allocIds.length === 0) continue;

    const alloc = db.allocations.get(allocIds[0])!;
    const dealCcy = alloc.deal_currency;
    const units = parseFloat(alloc.units);
    const contributed = parseFloat(alloc.contributed_amount);
    const effectiveSP = parseFloat(alloc.effective_share_price);
    const entryPrice = parseFloat(deal.entry_share_price);

    // Fraction already realised (for partial secondaries/exits)
    const distIds = db.distributionsByAllocation.get(alloc.allocation_id) ?? [];
    const dists = distIds.map((id) => db.distributions.get(id)!);
    const realisedFraction = dists.reduce(
      (sum, d) => sum + parseFloat(d.fraction_of_units),
      0
    );
    const distNetTotal = dists.reduce(
      (sum, d) => sum + parseFloat(d.net_amount),
      0
    );

    const rawMarks = db.valuationsByDeal.get(dealId) ?? [];
    const evidence: EvidenceItem[] = [];

    const marks: ValuationMark[] = rawMarks.map((val) => {
      const sharePrice = parseFloat(val.share_price);
      const companyValM = parseFloat(val.company_valuation_m);
      const multipleVsEntry = parseFloat(val.multiple_vs_entry);

      // Investor value at this mark: units × share_price × (1 - realised fraction)
      // For historical marks, use full unrealised (except final exit/write-off)
      let investorValueDealCcy: number | null = null;
      let moicAtMark: number | null = null;

      if (contributed > 0) {
        const unrealisedAtMark =
          val.mark_source === "Exit" || val.mark_source === "Write Off"
            ? 0
            : Math.max(0, 1 - realisedFraction) * units;
        investorValueDealCcy = unrealisedAtMark * sharePrice;
        const investorValueRpt = toRpt(investorValueDealCcy, dealCcy);
        const distNetRpt = toRpt(distNetTotal, dealCcy);
        moicAtMark = (investorValueRpt + distNetRpt) / toRpt(contributed, dealCcy);
      }

      const investorValueRpt =
        investorValueDealCcy !== null
          ? toRpt(investorValueDealCcy, dealCcy)
          : null;

      evidence.push({
        id: val.valuation_id,
        sourceType: "valuation",
        label: `${matchedCompany!.company_name} ${deal.round} — ${val.mark_source} (${val.valuation_date})`,
        detail: `Share price: ${fmt(sharePrice, dealCcy)} | Company: ${fmt(companyValM, dealCcy)}M | ${multipleVsEntry}× entry`,
        date: val.valuation_date,
      });

      return {
        valuationId: val.valuation_id,
        date: val.valuation_date,
        sharePrice,
        companyValuationM: companyValM,
        markSource: val.mark_source,
        multipleVsEntry,
        investorValueDealCcy,
        investorValueRpt,
        moicAtMark,
      };
    });

    histories.push({
      dealId,
      companyName: matchedCompany.company_name,
      round: deal.round,
      dealCurrency: dealCcy,
      reportingCurrency: rptCcy,
      entrySharePrice: entryPrice,
      effectiveSharePrice: effectiveSP,
      units,
      contributed: toRpt(contributed, dealCcy),
      marks,
      evidence,
    });
  }

  return histories;
}
