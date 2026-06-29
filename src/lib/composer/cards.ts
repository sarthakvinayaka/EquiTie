/**
 * Structured card builders for UI-rich responses.
 *
 * Card builders sit at the boundary between the engine layer and the
 * presentation layer. They take typed engine results and produce plain
 * serializable objects the UI can render without any further computation.
 *
 * Intentionally deterministic — no LLM calls, no async, no side effects.
 * Called by the route orchestrator after engine computation completes.
 *
 * Layer: Presentation formatting (between Engine and UI)
 */

import { fmt, fmtMultiple, fmtNum } from "@/lib/domain/fx";
import type { FeeBreakdownResult } from "@/lib/engine/fees";
import type { ValuationTimelineResult } from "@/lib/engine/valuations";
import type { StatementSummaryResult } from "@/lib/engine/statement";

const REPORT_DATE = "2026-06-25";

// ─── Statement card ────────────────────────────────────────────────────────────

const STMT_CONTRIBUTION_TYPES = new Set(["Capital Contribution"]);
const STMT_FEE_TYPES = new Set(["Management Fee", "Structuring Fee", "Admin Fee"]);
const STMT_DISTRIBUTION_TYPES = new Set(["Exit Proceeds", "Secondary Sale"]);

type StatementLineItem = {
  lineId: string;
  date: string;
  type: string;
  company: string;
  round: string;
  amountDisplay: string;
  amountRptDisplay: string;
  dealCurrency: string;
  direction: "in" | "out";
  referenceId: string;
};

export function buildStatementCard(data: StatementSummaryResult, investorName: string) {
  const {
    lines,
    reportingCurrency,
    totalContributionsRpt,
    totalFeesRpt,
    totalDistributionsRpt,
    netCashFlowRpt,
    earliestDate,
    latestDate,
  } = data;

  const contribLines: StatementLineItem[] = [];
  const feeLines: StatementLineItem[] = [];
  const distLines: StatementLineItem[] = [];

  for (const l of lines) {
    const item: StatementLineItem = {
      lineId: l.lineId,
      date: l.date,
      type: l.type,
      company: l.companyName,
      round: l.round,
      amountDisplay: fmt(Math.abs(l.amountDealCcy), l.dealCurrency),
      amountRptDisplay: fmt(Math.abs(l.amountRpt), reportingCurrency),
      dealCurrency: l.dealCurrency,
      direction: l.amountDealCcy < 0 ? "out" : "in",
      referenceId: l.referenceId,
    };
    if (STMT_CONTRIBUTION_TYPES.has(l.type)) contribLines.push(item);
    else if (STMT_FEE_TYPES.has(l.type)) feeLines.push(item);
    else if (STMT_DISTRIBUTION_TYPES.has(l.type)) distLines.push(item);
  }

  for (const arr of [contribLines, feeLines, distLines]) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }

  const categories = [
    {
      name: "Capital Deployed",
      subLabel: "capital contributions (funds deployed to portfolio companies)",
      direction: "out" as const,
      totalDisplay: fmt(totalContributionsRpt, reportingCurrency),
      lineCount: contribLines.length,
      lines: contribLines,
    },
    {
      name: "Fees",
      subLabel: "management, structuring, and admin fees",
      direction: "out" as const,
      totalDisplay: fmt(totalFeesRpt, reportingCurrency),
      lineCount: feeLines.length,
      lines: feeLines,
    },
    {
      name: "Distributions & Exits",
      subLabel: "exit proceeds and secondary sale distributions",
      direction: "in" as const,
      totalDisplay: fmt(totalDistributionsRpt, reportingCurrency),
      lineCount: distLines.length,
      lines: distLines,
    },
  ].filter((c) => c.lineCount > 0);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const dateRange =
    earliestDate && latestDate
      ? `Between ${fmtDate(earliestDate)} and ${fmtDate(latestDate)},`
      : "";
  const netLabel =
    netCashFlowRpt >= 0 ? "more received than deployed" : "more deployed than received";
  const plainSummary = [
    `${dateRange} your account shows ${lines.length} transaction${lines.length !== 1 ? "s" : ""}.`,
    `You deployed ${fmt(totalContributionsRpt, reportingCurrency)} in capital contributions`,
    totalFeesRpt > 0
      ? `and paid ${fmt(totalFeesRpt, reportingCurrency)} in fees.`
      : "with no fee charges on record.",
    totalDistributionsRpt > 0
      ? `You received ${fmt(totalDistributionsRpt, reportingCurrency)} in distributions and exit proceeds.`
      : "No distributions have been received yet.",
    `The net cash flow is ${fmt(Math.abs(netCashFlowRpt), reportingCurrency)} (${netLabel}).`,
  ].join(" ");

  const dealCurrencies = new Set(lines.map((l) => l.dealCurrency));
  dealCurrencies.delete(reportingCurrency);
  const fxNote =
    dealCurrencies.size > 0
      ? `Reporting-currency amounts are converted from ${[...dealCurrencies].join(", ")} at static rates as of ${REPORT_DATE}. Original deal-currency amounts are shown alongside.`
      : null;

  return {
    reportingCurrency,
    reportDate: REPORT_DATE,
    investorName,
    earliestDate,
    latestDate,
    summary: {
      totalContributions: fmt(totalContributionsRpt, reportingCurrency),
      totalFees: fmt(totalFeesRpt, reportingCurrency),
      totalDistributions: fmt(totalDistributionsRpt, reportingCurrency),
      netCashFlow: fmt(Math.abs(netCashFlowRpt), reportingCurrency),
      netCashFlowRaw: netCashFlowRpt,
    },
    categories,
    totalLines: lines.length,
    plainSummary,
    fxNote,
  };
}

// ─── Fee card ──────────────────────────────────────────────────────────────────

export function buildFeeCard(feeData: FeeBreakdownResult) {
  return {
    reportingCurrency: feeData.reportingCurrency,
    hasAnyDiscount: feeData.hasAnyDiscount,
    totalPaid: fmt(feeData.totalPaidRpt, feeData.reportingCurrency),
    totalUpcoming: fmt(feeData.totalUpcomingRpt, feeData.reportingCurrency),
    deals: feeData.deals.map((d) => ({
      company: d.companyName,
      round: d.round,
      dealCurrency: d.dealCurrency,
      hasDiscount: d.hasNegotiatedDiscount,
      noFeesYet: d.noFeesYet,
      plainSummary: d.plainSummary,
      performanceFeeNote: d.performanceFeeNote,
      schedule: d.schedule.map((s) => ({
        feeType: s.feeType,
        basis: s.basis,
        standardDisplay:
          s.basis === "flat USD"
            ? `USD ${s.standardRate.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
            : `${s.standardRate}%`,
        effectiveDisplay:
          s.basis === "flat USD"
            ? `USD ${s.effectiveRate.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
            : `${s.effectiveRate}%`,
        discounted: s.discounted,
        savingDisplay: s.savingUndeterminable
          ? null
          : s.savingPp !== null
          ? `−${s.savingPp.toFixed(2)} pp`
          : s.savingUsd !== null
          ? `USD ${s.savingUsd.toFixed(0)} saved`
          : null,
        savingRptDisplay:
          s.savingRpt !== null ? fmt(s.savingRpt, feeData.reportingCurrency) : null,
        undeterminable: s.savingUndeterminable,
        undeterminableReason: s.undeterminableReason,
      })),
      feeLines: d.feeLines.map((f) => ({
        feeId: f.feeId,
        feeType: f.feeType,
        period: f.period,
        amountDisplay: fmt(f.amountNativeCcy, f.nativeCurrency),
        amountRptDisplay: fmt(f.amountRpt, d.reportingCurrency),
        status: f.status,
        hasDiscount: f.hasDiscount,
        dueDate: f.dueDate,
      })),
      totalPaid: fmt(d.totalPaidRpt, d.reportingCurrency),
      totalUpcoming: fmt(d.totalUpcomingRpt, d.reportingCurrency),
      totalOverdue:
        d.totalOverdueRpt > 0 ? fmt(d.totalOverdueRpt, d.reportingCurrency) : null,
      estimatedAnnualMgmtSaving:
        d.estimatedAnnualMgmtSavingRpt !== null
          ? fmt(d.estimatedAnnualMgmtSavingRpt, d.reportingCurrency)
          : null,
    })),
  };
}

// ─── Valuation card ────────────────────────────────────────────────────────────

export function buildValuationCard(valData: ValuationTimelineResult) {
  return {
    reportingCurrency: valData.reportingCurrency,
    timelines: valData.timelines.map((tl) => ({
      company: tl.companyName,
      round: tl.round,
      dealCurrency: tl.dealCurrency,
      reportingCurrency: tl.reportingCurrency,
      dealStatus: tl.dealStatus,
      isWrittenOff: tl.isWrittenOff,
      isExited: tl.isExited,
      hasDownRound: tl.hasDownRound,
      isSparse: tl.isSparse,
      markCount: tl.markCount,
      spanDays: tl.spanDays,
      maxGapDays: tl.maxGapDays,
      entrySharePrice: tl.entrySharePrice,
      effectiveSharePrice: tl.effectiveSharePrice,
      contributedDisplay: fmt(tl.contributedRpt, tl.reportingCurrency),
      latestSharePrice: tl.latestSharePrice,
      latestSharePriceDisplay:
        tl.latestSharePrice !== null
          ? fmt(tl.latestSharePrice, tl.dealCurrency)
          : null,
      latestMoic: tl.latestMoic,
      latestMoicDisplay: fmtMultiple(tl.latestMoic),
      latestInvestorValueDisplay:
        tl.latestInvestorValueRpt !== null
          ? fmt(tl.latestInvestorValueRpt, tl.reportingCurrency)
          : null,
      currentUnrealisedGainLoss: tl.currentUnrealisedGainLossRpt,
      currentUnrealisedGainLossDisplay:
        tl.currentUnrealisedGainLossRpt !== null
          ? fmt(tl.currentUnrealisedGainLossRpt, tl.reportingCurrency)
          : null,
      peakMoic: tl.peakMoic,
      peakMoicDisplay: fmtMultiple(tl.peakMoic),
      peakMoicDate: tl.peakMoicDate,
      downRounds: tl.downRounds.map((dr) => ({
        date: dr.date,
        prevDate: dr.prevDate,
        fromPrice: dr.fromPrice,
        toPrice: dr.toPrice,
        pctDrop: dr.pctDrop,
        dealCurrency: dr.dealCurrency,
      })),
      marks: tl.marks.map((m) => ({
        valuationId: m.valuationId,
        date: m.date,
        sharePrice: m.sharePrice,
        sharePriceDisplay: fmt(m.sharePrice, tl.dealCurrency),
        companyValuationM: m.companyValuationM,
        markSource: m.markSource,
        multipleVsEntry: m.multipleVsEntry,
        priceChangePct: m.priceChangePct,
        isDownRound: m.isDownRound,
        daysSincePreviousMark: m.daysSincePreviousMark,
        investorValueRpt: m.investorValueRpt,
        investorValueDisplay: fmt(m.investorValueRpt, tl.reportingCurrency),
        moicAtMark: m.moicAtMark,
        moicDisplay: m.moicAtMark !== null ? fmtMultiple(m.moicAtMark) : "N/A",
        unrealisedGainLossRpt: m.unrealisedGainLossRpt,
        unrealisedGainLossDisplay: fmt(m.unrealisedGainLossRpt, tl.reportingCurrency),
      })),
    })),
  };
}
