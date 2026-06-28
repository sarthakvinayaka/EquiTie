import type { Database } from "../data/loader";
import type { AccountStatement, StatementLine } from "../domain/types";
import type { EngineResult } from "./types";
import { getAccountStatement } from "../domain/statement";
import { fmt } from "../domain/fx";

const REPORT_DATE = "2026-06-25";

// ─── Timeline group ────────────────────────────────────────────────────────────

export interface StatementGroup {
  period: string; // "YYYY-MM" for monthly grouping
  lines: StatementLine[];
  netFlowRpt: number; // positive = inflow to investor
  contributionsRpt: number;
  feesRpt: number;
  distributionsRpt: number;
}

export interface StatementSummaryResult extends AccountStatement {
  groups: StatementGroup[];
  earliestDate: string | null;
  latestDate: string | null;
}

// ─── getInvestorStatementSummary ──────────────────────────────────────────────

export function getInvestorStatementSummary(
  investorId: string,
  db: Database
): EngineResult<StatementSummaryResult> {
  const raw = getAccountStatement(investorId, db);
  const warnings: string[] = [];

  if (raw.lines.length === 0) {
    return {
      result: {
        ...raw,
        groups: [],
        earliestDate: null,
        latestDate: null,
      },
      evidence: [],
      assumptions: ["No statement lines found for this investor."],
      warnings: ["No transaction history available."],
    };
  }

  // Group lines by year-month
  const groupMap = new Map<string, StatementGroup>();
  for (const line of raw.lines) {
    const period = line.date.slice(0, 7); // "YYYY-MM"
    if (!groupMap.has(period)) {
      groupMap.set(period, {
        period,
        lines: [],
        netFlowRpt: 0,
        contributionsRpt: 0,
        feesRpt: 0,
        distributionsRpt: 0,
      });
    }
    const group = groupMap.get(period)!;
    group.lines.push(line);

    const isContribution = line.type === "Capital Contribution";
    const isFee = ["Management Fee", "Structuring Fee", "Admin Fee"].includes(line.type);
    const isDist = ["Exit Proceeds", "Secondary Sale"].includes(line.type);

    const absAmt = Math.abs(line.amountRpt);
    if (isContribution) group.contributionsRpt += absAmt;
    else if (isFee) group.feesRpt += absAmt;
    else if (isDist) group.distributionsRpt += absAmt;

    group.netFlowRpt += line.amountRpt; // sign preserved: negative = outflow
  }

  const groups = [...groupMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, g]) => g);

  const sortedDates = raw.lines.map((l) => l.date).sort();
  const earliestDate = sortedDates[0] ?? null;
  const latestDate = sortedDates[sortedDates.length - 1] ?? null;

  // Warnings
  if (raw.netCashFlowRpt > 0) {
    warnings.push(
      `Net cash flow is positive (${fmt(raw.netCashFlowRpt, raw.reportingCurrency)}) — investor has received more than deployed to date.`
    );
  }

  const currencies = new Set(raw.lines.map((l) => l.dealCurrency));
  currencies.delete(raw.reportingCurrency);
  if (currencies.size > 0) {
    warnings.push(
      `Statement includes transactions in [${[...currencies].join(", ")}] converted to ${raw.reportingCurrency} at static rates as of ${REPORT_DATE}.`
    );
  }

  // Largest single transaction
  const largest = raw.lines.reduce(
    (max, l) => (Math.abs(l.amountRpt) > Math.abs(max.amountRpt) ? l : max),
    raw.lines[0]
  );
  warnings.push(
    `Largest transaction: ${largest.type} for ${largest.companyName} ${largest.round} on ${largest.date} (${fmt(Math.abs(largest.amountRpt), raw.reportingCurrency)}).`
  );

  return {
    result: {
      ...raw,
      groups,
      earliestDate,
      latestDate,
    },
    evidence: raw.evidence,
    assumptions: [
      `Report date: ${REPORT_DATE}. Statement covers all transactions in the dataset.`,
      "Amounts are signed: negative = cash outflow from investor (contributions, fees); positive = inflow (distributions).",
      "Net cash flow = Distributions − Contributions − Fees.",
      "Grouped by calendar month (YYYY-MM) in chronological order.",
      "All amounts converted to reporting currency via USD bridge at static rates.",
    ],
    warnings,
  };
}
