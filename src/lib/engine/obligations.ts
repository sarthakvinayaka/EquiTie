import type { Database } from "../data/loader";
import type { Obligations } from "../domain/types";
import type { EngineResult } from "./types";
import { getObligations } from "../domain/obligations";

const REPORT_DATE = "2026-06-25";

export function getInvestorUpcomingObligations(
  investorId: string,
  db: Database
): EngineResult<Obligations> {
  const raw = getObligations(investorId, db);
  const warnings: string[] = [];

  // Overdue fees
  const overdueFees = raw.fees.filter((f) => f.status === "Overdue");
  if (overdueFees.length > 0) {
    const lines = overdueFees
      .map((f) => `${f.companyName} ${f.round} — ${f.feeType} (due ${f.dueDate})`)
      .join("; ");
    warnings.push(`Overdue fee(s) detected: ${lines}.`);
  }

  // Capital calls due within 30 days of report date
  const reportMs = new Date(REPORT_DATE).getTime();
  const soonCalls = raw.capitalCalls.filter(
    (c) => new Date(c.dueDate).getTime() - reportMs <= 30 * 86_400_000
  );
  if (soonCalls.length > 0) {
    const names = soonCalls
      .map((c) => `${c.companyName} ${c.round} #${c.callNumber} (${c.dueDate})`)
      .join("; ");
    warnings.push(`Capital call(s) due within 30 days of report date: ${names}.`);
  }

  if (raw.capitalCalls.length === 0 && raw.fees.length === 0) {
    warnings.push("No upcoming or overdue obligations found for this investor.");
  }

  // Currency warning
  const feeCcys = new Set(raw.fees.map((f) => f.feeCurrency));
  feeCcys.delete(raw.reportingCurrency);
  const callCcys = new Set(raw.capitalCalls.map((c) => c.dealCurrency));
  callCcys.delete(raw.reportingCurrency);
  const allForeignCcys = new Set([...feeCcys, ...callCcys]);
  if (allForeignCcys.size > 0) {
    warnings.push(
      `Obligation amounts in [${[...allForeignCcys].join(", ")}] converted to ${raw.reportingCurrency} using static FX rates as of ${REPORT_DATE}.`
    );
  }

  return {
    result: raw,
    evidence: raw.evidence,
    assumptions: [
      `Report date: ${REPORT_DATE}. "Upcoming" = status is "Upcoming" in the dataset; "Overdue" = status is "Overdue".`,
      "Only non-Paid obligations are included. Paid capital calls and fees are excluded.",
      "Capital calls are sorted by due date (earliest first). Fees are sorted overdue-first, then by due date.",
      "Admin fees are denominated in USD regardless of deal currency (per dataset convention).",
      "All amounts converted to reporting currency via USD bridge at static rates.",
    ],
    warnings,
  };
}
