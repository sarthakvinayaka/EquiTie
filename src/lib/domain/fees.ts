import type { Database } from "../data/loader";
import type { DealFeeBreakdown, EvidenceItem, FeeLineItem } from "./types";
import { convertCurrency, fmt } from "./fx";

export function getFeeBreakdown(
  investorId: string,
  companyName: string,
  db: Database
): DealFeeBreakdown[] {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const fxRates = db.fxRates;
  const toRpt = (amount: number, fromCcy: string) =>
    convertCurrency(amount, fromCcy, rptCcy, fxRates);

  // Find matching company (case-insensitive, partial)
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

  // If no specific company, return fees for all investor deals
  const targetCompanyId = matchedCompany?.company_id;

  const allocationIds = db.allocationsByInvestor.get(investorId) ?? [];
  const breakdowns: DealFeeBreakdown[] = [];

  for (const allocId of allocationIds) {
    const alloc = db.allocations.get(allocId)!;
    const deal = db.deals.get(alloc.deal_id)!;
    const company = db.companies.get(deal.company_id)!;

    // Filter to the requested company if one was specified
    if (targetCompanyId && company.company_id !== targetCompanyId) continue;

    const feeIds = db.feesByAllocation.get(allocId) ?? [];
    const feeItems: FeeLineItem[] = [];
    const evidence: EvidenceItem[] = [];

    let totalPaidRpt = 0;
    let totalUpcomingRpt = 0;

    for (const feeId of feeIds) {
      const fee = db.fees.get(feeId)!;
      const amountNative = parseFloat(fee.amount);
      const amountRpt = toRpt(amountNative, fee.currency);

      if (fee.status === "Paid") totalPaidRpt += amountRpt;
      else totalUpcomingRpt += amountRpt;

      // Standard rate for comparison
      let stdRatePct: number | null = null;
      if (fee.fee_type === "Management Fee") {
        stdRatePct = parseFloat(deal.std_mgmt_fee_pct);
      } else if (fee.fee_type === "Structuring Fee") {
        stdRatePct = parseFloat(deal.std_structuring_fee_pct);
      } else if (fee.fee_type === "Admin Fee") {
        stdRatePct = null; // flat fee, not a %
      }

      const effectiveRatePct =
        fee.fee_rate_pct ? parseFloat(fee.fee_rate_pct) : null;

      const hasDiscount =
        stdRatePct !== null &&
        effectiveRatePct !== null &&
        effectiveRatePct < stdRatePct;

      feeItems.push({
        feeId: fee.fee_id,
        feeType: fee.fee_type,
        period: fee.period,
        effectiveRatePct,
        standardRatePct: stdRatePct,
        hasDiscount,
        amountNativeCcy: amountNative,
        amountRpt,
        nativeCurrency: fee.currency,
        dueDate: fee.due_date,
        status: fee.status,
      });

      evidence.push({
        id: fee.fee_id,
        sourceType: "fee",
        label: `${company.company_name} ${deal.round} — ${fee.fee_type} (${fee.period})`,
        detail: `Effective rate: ${effectiveRatePct !== null ? effectiveRatePct + "%" : "flat"} (deal standard: ${stdRatePct !== null ? stdRatePct + "%" : fmt(parseFloat(deal.std_admin_fee_usd), "USD")}) | Amount: ${fmt(amountNative, fee.currency)} | Status: ${fee.status}`,
        amount: amountRpt,
        currency: rptCcy,
        date: fee.due_date,
      });
    }

    breakdowns.push({
      dealId: alloc.deal_id,
      companyName: company.company_name,
      round: deal.round,
      dealCurrency: alloc.deal_currency,
      reportingCurrency: rptCcy,
      allocationId: allocId,
      feeDiscount: alloc.fee_discount === "Yes",
      stdMgmtFeePct: parseFloat(deal.std_mgmt_fee_pct),
      stdPerfFeePct: parseFloat(deal.std_performance_fee_pct),
      stdStructuringFeePct: parseFloat(deal.std_structuring_fee_pct),
      stdAdminFeeUsd: parseFloat(deal.std_admin_fee_usd),
      effMgmtFeePct: parseFloat(alloc.mgmt_fee_pct),
      effPerfFeePct: parseFloat(alloc.performance_fee_pct),
      effStructuringFeePct: parseFloat(alloc.structuring_fee_pct),
      effAdminFeeUsd: parseFloat(alloc.admin_fee_usd),
      fees: feeItems,
      totalPaidRpt,
      totalUpcomingRpt,
      evidence,
    });
  }

  return breakdowns;
}
