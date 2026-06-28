import type { Database } from "../data/loader";
import type { EvidenceItem, Obligations, UpcomingCapitalCall, UpcomingFee } from "./types";
import { convertCurrency, fmt } from "./fx";

export function getObligations(
  investorId: string,
  db: Database
): Obligations {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const fxRates = db.fxRates;
  const toRpt = (amount: number, fromCcy: string) =>
    convertCurrency(amount, fromCcy, rptCcy, fxRates);

  const evidence: EvidenceItem[] = [];

  // ─── Capital calls ────────────────────────────────────────────────────────
  const callIds = db.capitalCallsByInvestor.get(investorId) ?? [];
  const capitalCalls: UpcomingCapitalCall[] = [];

  for (const callId of callIds) {
    const call = db.capitalCalls.get(callId)!;
    if (call.status !== "Upcoming") continue;

    const deal = db.deals.get(call.deal_id)!;
    const company = db.companies.get(deal.company_id)!;
    const amountDealCcy = parseFloat(call.amount);
    const amountRpt = toRpt(amountDealCcy, call.currency);

    capitalCalls.push({
      callId: call.call_id,
      dealId: call.deal_id,
      companyName: company.company_name,
      round: deal.round,
      callNumber: parseInt(call.call_number, 10),
      dueDate: call.due_date,
      amountDealCcy,
      amountRpt,
      dealCurrency: call.currency,
      reportingCurrency: rptCcy,
      status: call.status,
    });

    evidence.push({
      id: call.call_id,
      sourceType: "capital_call",
      label: `${company.company_name} ${deal.round} — Capital Call #${call.call_number}`,
      detail: `Due: ${call.due_date} | Amount: ${fmt(amountDealCcy, call.currency)}`,
      amount: amountRpt,
      currency: rptCcy,
      date: call.due_date,
    });
  }

  // Sort by due date
  capitalCalls.sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );

  // ─── Fees ─────────────────────────────────────────────────────────────────
  const feeIds = db.feesByInvestor.get(investorId) ?? [];
  const fees: UpcomingFee[] = [];

  for (const feeId of feeIds) {
    const fee = db.fees.get(feeId)!;
    if (fee.status === "Paid") continue;

    const deal = db.deals.get(fee.deal_id)!;
    const company = db.companies.get(deal.company_id)!;
    const amountNative = parseFloat(fee.amount);
    // Admin fees are always in USD; management/structuring in deal currency
    const amountRpt = toRpt(amountNative, fee.currency);

    fees.push({
      feeId: fee.fee_id,
      dealId: fee.deal_id,
      companyName: company.company_name,
      round: deal.round,
      feeType: fee.fee_type,
      period: fee.period,
      amountFeeNativeCcy: amountNative,
      amountRpt,
      feeCurrency: fee.currency,
      reportingCurrency: rptCcy,
      dueDate: fee.due_date,
      status: fee.status as "Upcoming" | "Overdue",
    });

    evidence.push({
      id: fee.fee_id,
      sourceType: "fee",
      label: `${company.company_name} ${deal.round} — ${fee.fee_type} (${fee.period})`,
      detail: `Status: ${fee.status} | Due: ${fee.due_date} | Amount: ${fmt(amountNative, fee.currency)}${fee.fee_rate_pct ? ` @ ${fee.fee_rate_pct}%` : ""}`,
      amount: amountRpt,
      currency: rptCcy,
      date: fee.due_date,
    });
  }

  // Sort: Overdue first, then by due date
  fees.sort((a, b) => {
    if (a.status === "Overdue" && b.status !== "Overdue") return -1;
    if (b.status === "Overdue" && a.status !== "Overdue") return 1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const totalCapitalCallsRpt = capitalCalls.reduce((s, c) => s + c.amountRpt, 0);
  const totalFeesRpt = fees.reduce((s, f) => s + f.amountRpt, 0);

  return {
    investorId,
    reportingCurrency: rptCcy,
    capitalCalls,
    fees,
    totalCapitalCallsRpt,
    totalFeesRpt,
    totalObligationsRpt: totalCapitalCallsRpt + totalFeesRpt,
    evidence,
  };
}
