import type { Database } from "../data/loader";
import type { AccountStatement, EvidenceItem, StatementLine } from "./types";
import { convertCurrency, fmt } from "./fx";

export function getAccountStatement(
  investorId: string,
  db: Database
): AccountStatement {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const fxRates = db.fxRates;
  const toRpt = (amount: number, fromCcy: string) =>
    convertCurrency(amount, fromCcy, rptCcy, fxRates);

  const rawLines = db.statementLines.get(investorId) ?? [];
  const lines: StatementLine[] = [];
  const evidence: EvidenceItem[] = [];

  let totalContributionsRpt = 0;
  let totalFeesRpt = 0;
  let totalDistributionsRpt = 0;

  for (const raw of rawLines) {
    const deal = db.deals.get(raw.deal_id);
    const company = deal ? db.companies.get(deal.company_id) : undefined;
    const companyName = company?.company_name ?? raw.deal_id;
    const round = deal?.round ?? "";

    const amountDealCcy = parseFloat(raw.amount);
    const amountRpt = toRpt(amountDealCcy, raw.currency);

    lines.push({
      lineId: raw.line_id,
      date: raw.date,
      type: raw.type,
      dealId: raw.deal_id,
      companyName,
      round,
      amountDealCcy,
      amountRpt,
      dealCurrency: raw.currency,
      referenceId: raw.reference_id,
    });

    // Classify by sign/type
    const isContribution = raw.type === "Capital Contribution";
    const isFee = ["Management Fee", "Structuring Fee", "Admin Fee"].includes(raw.type);
    const isDistribution = ["Exit Proceeds", "Secondary Sale"].includes(raw.type);

    // Amounts are signed (negative = outflow). We accumulate absolute values.
    if (isContribution) totalContributionsRpt += Math.abs(amountRpt);
    else if (isFee) totalFeesRpt += Math.abs(amountRpt);
    else if (isDistribution) totalDistributionsRpt += Math.abs(amountRpt);

    evidence.push({
      id: raw.line_id,
      sourceType: "statement_line",
      label: `${companyName} ${round} — ${raw.type}`,
      detail: `Date: ${raw.date} | Amount: ${fmt(Math.abs(amountDealCcy), raw.currency)} ${amountDealCcy < 0 ? "(outflow)" : "(inflow)"} | Ref: ${raw.reference_id}`,
      amount: amountRpt,
      currency: rptCcy,
      date: raw.date,
    });
  }

  // Net cash flow: positive = money received; negative = money deployed
  const netCashFlowRpt =
    totalDistributionsRpt - totalContributionsRpt - totalFeesRpt;

  return {
    investorId,
    reportingCurrency: rptCcy,
    lines,
    totalContributionsRpt,
    totalFeesRpt,
    totalDistributionsRpt,
    netCashFlowRpt,
    evidence,
  };
}
