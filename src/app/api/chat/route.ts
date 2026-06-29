import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getDatabase } from "@/lib/data/loader";
import { runPolicyChecks, runIntentPolicyChecks, runEvidenceIntegrityCheck } from "@/lib/policy/engine";
import { classifyIntent } from "@/lib/query/router";
// Engine wrappers — return EngineResult<T> with assumptions + warnings
import {
  getInvestorPortfolioOverview,
  getInvestorPositionByCompany,
  getInvestorUpcomingObligations,
  getInvestorDistributions,
  getInvestorStatementSummary,
} from "@/lib/engine";
import { getInvestorFeeBreakdown } from "@/lib/engine/fees";
import type { FeeBreakdownResult } from "@/lib/engine/fees";
import { getInvestorValuationTimeline } from "@/lib/engine/valuations";
import type { ValuationTimelineResult } from "@/lib/engine/valuations";
import type { StatementSummaryResult } from "@/lib/engine/statement";
import { getInvestorPersonalizationProfile } from "@/lib/engine";
import { composeAnswer } from "@/lib/composer";
import type { AnswerObject } from "@/lib/composer";
import type { ChatRequest, ChatResponse, EvidenceItem, QueryIntent, RouterOutput } from "@/lib/domain/types";
import { fmt, fmtMultiple, fmtNum } from "@/lib/domain/fx";

const REPORT_DATE = "2026-06-25";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ChatRequest;
    const { message, investorId, history = [] } = body;

    if (!investorId || !message) {
      return NextResponse.json(
        { error: "investorId and message are required" },
        { status: 400 }
      );
    }

    const db = getDatabase();

    // ── Policy layer: pre-computation checks ───────────────────────────────
    // Runs: investor exists → no cross-investor ref → no external data request
    const policyResult = runPolicyChecks(investorId, message, db);
    if (!policyResult.allowed) {
      return NextResponse.json(
        {
          answer: policyResult.safeResponse ?? "This request cannot be processed.",
          intent: "general_help" as const,
          evidence: [],
          fallbackMode: false,
          policyViolation: policyResult.violationCode,
        },
        { status: 200 } // 200 so the UI renders the safe message naturally
      );
    }

    // investorContext is guaranteed non-null after allowed=true
    const investorContext = policyResult.investorContext!;

    // ── Intent classification ──────────────────────────────────────────────
    const intentResult: RouterOutput = classifyIntent(message, investorId, db);
    const { intent, entities, clarificationPrompt, confidence } = intentResult;
    const companyName = entities.companyName ?? undefined;
    const ambiguous = entities.ambiguousCompanies ?? undefined;

    // ── Early exit: router requests clarification ──────────────────────────
    // Handles ambiguous entities and unsupported topics before any computation
    if (
      (intent === "unsupported_or_ambiguous" || intent === "glossary_or_metric_explanation") &&
      clarificationPrompt &&
      intent === "unsupported_or_ambiguous"
    ) {
      return NextResponse.json({
        answer: clarificationPrompt,
        intent,
        evidence: [],
        fallbackMode: false,
        routerDebug: buildRouterDebug(intentResult, 0),
      });
    }

    // ── Policy layer: post-intent checks ──────────────────────────────────
    // Runs: ambiguous entity → company in portfolio
    const intentPolicy = runIntentPolicyChecks({
      investorId,
      intent,
      companyName,
      ambiguous,
      investorContext,
      db,
    });
    if (!intentPolicy.allowed) {
      return NextResponse.json(
        {
          answer: intentPolicy.safeResponse ?? "Please clarify your request.",
          intent,
          evidence: [],
          fallbackMode: false,
          policyViolation: intentPolicy.violationCode,
          routerDebug: buildRouterDebug(intentResult, 0),
        },
        { status: 200 }
      );
    }

    // ── Deterministic computation ──────────────────────────────────────────
    let computedData: unknown = null;
    let evidence: EvidenceItem[] = [];
    let engineAssumptions: string[] = [];
    let engineWarnings: string[] = [];

    {
      switch (intent) {
        case "portfolio_overview": {
          const er = getInvestorPortfolioOverview(investorId, db);
          const data = er.result;
          evidence = er.evidence;
          engineAssumptions = er.assumptions;
          engineWarnings = er.warnings;
          computedData = {
            reportDate: REPORT_DATE,
            reportingCurrency: data.reportingCurrency,
            totalCommitted: fmt(data.totalCommittedRpt, data.reportingCurrency),
            totalContributed: fmt(data.totalContributedRpt, data.reportingCurrency),
            totalCurrentValue: fmt(data.totalCurrentValueRpt, data.reportingCurrency),
            totalDistributionsNet: fmt(data.totalDistributionsRpt, data.reportingCurrency),
            totalValue: fmt(data.totalValueRpt, data.reportingCurrency),
            portfolioMoic: data.portfolioMoic,
            portfolioMoicFormatted: fmtMultiple(data.portfolioMoic),
            activePositions: data.activePositions,
            pendingPositions: data.pendingPositions,
            positions: data.positions.map((p) => ({
              company: p.companyName,
              round: p.round,
              status: p.dealStatus,
              allocationStatus: p.allocationStatus,
              commitment: fmt(p.commitmentRpt, p.reportingCurrency),
              contributed: fmt(p.contributedRpt, p.reportingCurrency),
              currentValue: fmt(p.currentValueRpt, p.reportingCurrency),
              distributions: fmt(p.distributionsNetRpt, p.reportingCurrency),
              moic: fmtMultiple(p.moic),
              sector: p.sector,
            })),
          };
          break;
        }

        case "position_detail": {
          const name = companyName ?? "";
          if (!name) {
            computedData = { error: "Please specify which company you want to know about." };
            break;
          }
          const er2 = getInvestorPositionByCompany(investorId, name, db);
          evidence = er2.evidence;
          engineAssumptions = er2.assumptions;
          engineWarnings = er2.warnings;
          const data = er2.result;
          if (!data) {
            computedData = { error: `No position found for "${name}" in this investor's portfolio.` };
            break;
          }
          computedData = {
            reportDate: REPORT_DATE,
            company: data.companyName,
            sector: data.sector,
            hqCountry: data.hqCountry,
            companyStatus: data.companyStatus,
            reportingCurrency: data.reportingCurrency,
            totalCommitted: fmt(data.totalCommittedRpt, data.reportingCurrency),
            totalContributed: fmt(data.totalContributedRpt, data.reportingCurrency),
            totalCurrentValue: fmt(data.totalCurrentValueRpt, data.reportingCurrency),
            totalDistributions: fmt(data.totalDistributionsRpt, data.reportingCurrency),
            totalValue: fmt(data.totalValueRpt, data.reportingCurrency),
            companyMoic: fmtMultiple(data.companyMoic),
            rounds: data.rounds.map((r) => ({
              round: r.round,
              dealStatus: r.dealStatus,
              allocationStatus: r.allocationStatus,
              dealCurrency: r.dealCurrency,
              commitment: fmt(r.commitmentDealCcy, r.dealCurrency),
              contributed: fmt(r.contributedDealCcy, r.dealCurrency),
              units: fmtNum(r.units),
              entrySharePrice: fmt(r.entrySharePrice, r.dealCurrency),
              effectiveSharePrice: fmt(r.effectiveSharePrice, r.dealCurrency),
              priceDiscountPct: r.priceDiscountPct > 0 ? `${r.priceDiscountPct}% off entry price` : "no price discount",
              currentSharePrice: r.latestSharePrice !== null ? fmt(r.latestSharePrice, r.dealCurrency) : "N/A",
              currentValue: fmt(r.currentValueRpt, r.reportingCurrency),
              distributions: fmt(r.distributionsNetRpt, r.reportingCurrency),
              moic: fmtMultiple(r.moic),
              distributionDetails: r.distributionDetails.map((d) => ({
                date: d.date,
                type: d.type,
                gross: fmt(d.grossDealCcy, r.dealCurrency),
                carry: `${d.performanceFeePct}% = ${fmt(d.performanceFeeAmount, r.dealCurrency)}`,
                net: fmt(d.netDealCcy, r.dealCurrency),
                fractionOfPosition: `${(d.fractionOfUnits * 100).toFixed(0)}%`,
              })),
            })),
          };
          break;
        }

        case "obligations": {
          const er3 = getInvestorUpcomingObligations(investorId, db);
          const data = er3.result;
          evidence = er3.evidence;
          engineAssumptions = er3.assumptions;
          engineWarnings = er3.warnings;
          computedData = {
            reportDate: REPORT_DATE,
            reportingCurrency: data.reportingCurrency,
            totalObligations: fmt(data.totalObligationsRpt, data.reportingCurrency),
            totalCapitalCalls: fmt(data.totalCapitalCallsRpt, data.reportingCurrency),
            totalFees: fmt(data.totalFeesRpt, data.reportingCurrency),
            capitalCalls: data.capitalCalls.map((c) => ({
              company: c.companyName,
              round: c.round,
              callNumber: c.callNumber,
              dueDate: c.dueDate,
              amount: fmt(c.amountDealCcy, c.dealCurrency),
              amountReporting: fmt(c.amountRpt, c.reportingCurrency),
              status: c.status,
            })),
            fees: data.fees.map((f) => ({
              company: f.companyName,
              round: f.round,
              feeType: f.feeType,
              period: f.period,
              dueDate: f.dueDate,
              amount: fmt(f.amountFeeNativeCcy, f.feeCurrency),
              amountReporting: fmt(f.amountRpt, f.reportingCurrency),
              status: f.status,
            })),
          };
          break;
        }

        case "distributions": {
          const er4 = getInvestorDistributions(investorId, db);
          const data = er4.result;
          evidence = er4.evidence;
          engineAssumptions = er4.assumptions;
          engineWarnings = er4.warnings;
          computedData = {
            reportDate: REPORT_DATE,
            reportingCurrency: data.reportingCurrency,
            totalGross: fmt(data.totalGrossRpt, data.reportingCurrency),
            totalPerformanceFee: fmt(data.totalPerformanceFeeRpt, data.reportingCurrency),
            totalNet: fmt(data.totalNetRpt, data.reportingCurrency),
            distributions: data.distributions.map((d) => ({
              company: d.companyName,
              round: d.round,
              date: d.date,
              type: d.type,
              gross: fmt(d.grossDealCcy, d.dealCurrency),
              performanceFee: `${d.performanceFeePct}% (${fmt(d.performanceFeeAmountDealCcy, d.dealCurrency)})`,
              net: fmt(d.netDealCcy, d.dealCurrency),
              netReporting: fmt(d.netRpt, d.reportingCurrency),
              fractionOfPosition: `${(d.fractionOfUnits * 100).toFixed(0)}%`,
            })),
          };
          break;
        }

        case "fee_detail": {
          const name = companyName ?? "";
          const engineResult = getInvestorFeeBreakdown(investorId, name, db);
          const feeData = engineResult.result;
          evidence = engineResult.evidence;

          // ── Data for LLM (phrasing only, all maths already done) ───────────
          computedData = {
            reportDate: REPORT_DATE,
            reportingCurrency: feeData.reportingCurrency,
            hasAnyDiscount: feeData.hasAnyDiscount,
            totalFeesPaid: fmt(feeData.totalPaidRpt, feeData.reportingCurrency),
            totalFeesUpcoming: fmt(feeData.totalUpcomingRpt, feeData.reportingCurrency),
            assumptions: engineResult.assumptions,
            warnings: engineResult.warnings,
            deals: feeData.deals.map((d) => ({
              company: d.companyName,
              round: d.round,
              hasNegotiatedDiscount: d.hasNegotiatedDiscount,
              noFeesYet: d.noFeesYet,
              plainSummary: d.plainSummary,
              performanceFeeNote: d.performanceFeeNote,
              schedule: d.schedule.map((s) => ({
                type: s.feeType,
                basis: s.basis,
                standard: s.basis === "flat USD"
                  ? fmt(s.standardRate, "USD")
                  : `${s.standardRate}%`,
                effective: s.basis === "flat USD"
                  ? fmt(s.effectiveRate, "USD")
                  : `${s.effectiveRate}%`,
                discounted: s.discounted,
                saving: s.savingUndeterminable
                  ? "Cannot determine before exit"
                  : s.savingPp !== null
                  ? `-${s.savingPp.toFixed(2)} pp`
                  : s.savingUsd !== null
                  ? `USD ${s.savingUsd.toFixed(0)} saved`
                  : null,
                savingRpt: s.savingRpt !== null
                  ? fmt(s.savingRpt, feeData.reportingCurrency)
                  : null,
                undeterminableReason: s.undeterminableReason,
              })),
              feeLines: d.feeLines.map((f) => ({
                type: f.feeType,
                period: f.period,
                amount: fmt(f.amountNativeCcy, f.nativeCurrency),
                amountReporting: fmt(f.amountRpt, d.reportingCurrency),
                status: f.status,
                hasDiscount: f.hasDiscount,
                dueDate: f.dueDate,
              })),
              totalPaid: fmt(d.totalPaidRpt, d.reportingCurrency),
              totalUpcoming: fmt(d.totalUpcomingRpt, d.reportingCurrency),
              estimatedAnnualMgmtSaving: d.estimatedAnnualMgmtSavingRpt !== null
                ? fmt(d.estimatedAnnualMgmtSavingRpt, d.reportingCurrency)
                : null,
            })),
          };

          // ── Structured fee card for UI rendering ────────────────────────────
          engineAssumptions = engineResult.assumptions;
          engineWarnings = engineResult.warnings;
          (computedData as Record<string, unknown>).__feeCard = buildFeeCard(feeData);
          break;
        }

        case "valuation_history": {
          const name = companyName ?? "";
          const engineResult = getInvestorValuationTimeline(investorId, name, db);
          const valData = engineResult.result;
          evidence = engineResult.evidence;
          engineAssumptions = engineResult.assumptions;
          engineWarnings = engineResult.warnings;

          if (valData.noDataReason) {
            computedData = {
              error: valData.noDataReason,
              warnings: engineResult.warnings,
            };
            break;
          }

          // ── Data for LLM ──────────────────────────────────────────────────
          computedData = {
            reportDate: REPORT_DATE,
            reportingCurrency: valData.reportingCurrency,
            assumptions: engineResult.assumptions,
            warnings: engineResult.warnings,
            timelines: valData.timelines.map((tl) => ({
              company: tl.companyName,
              round: tl.round,
              dealCurrency: tl.dealCurrency,
              dealStatus: tl.dealStatus,
              contributed: fmt(tl.contributedRpt, tl.reportingCurrency),
              entrySharePrice: fmt(tl.entrySharePrice, tl.dealCurrency),
              yourEffectivePrice: fmt(tl.effectiveSharePrice, tl.dealCurrency),
              units: fmtNum(tl.units),
              markCount: tl.markCount,
              spanYears: (tl.spanDays / 365).toFixed(1),
              isSparse: tl.isSparse,
              maxGapMonths: Math.round(tl.maxGapDays / 30),
              latestMoic: tl.latestMoic !== null ? fmtMultiple(tl.latestMoic) : "N/A",
              latestSharePrice: tl.latestSharePrice !== null
                ? fmt(tl.latestSharePrice, tl.dealCurrency)
                : "N/A",
              latestInvestorValue: tl.latestInvestorValueRpt !== null
                ? fmt(tl.latestInvestorValueRpt, tl.reportingCurrency)
                : "N/A",
              currentUnrealisedGainLoss: tl.currentUnrealisedGainLossRpt !== null
                ? fmt(tl.currentUnrealisedGainLossRpt, tl.reportingCurrency)
                : "N/A",
              peakMoic: tl.peakMoic !== null ? fmtMultiple(tl.peakMoic) : "N/A",
              peakMoicDate: tl.peakMoicDate ?? "N/A",
              hasDownRound: tl.hasDownRound,
              downRounds: tl.downRounds.map((dr) => ({
                date: dr.date,
                from: fmt(dr.fromPrice, tl.dealCurrency),
                to: fmt(dr.toPrice, tl.dealCurrency),
                drop: `${dr.pctDrop.toFixed(1)}%`,
              })),
              isWrittenOff: tl.isWrittenOff,
              isExited: tl.isExited,
              marks: tl.marks.map((m) => ({
                date: m.date,
                source: m.markSource,
                sharePrice: fmt(m.sharePrice, tl.dealCurrency),
                companyValuation: `${fmtNum(m.companyValuationM, 1)}M ${tl.dealCurrency}`,
                multipleVsEntry: `${m.multipleVsEntry}×`,
                priceChange: m.priceChangePct !== null
                  ? `${m.priceChangePct >= 0 ? "+" : ""}${m.priceChangePct.toFixed(1)}%`
                  : "—",
                isDownRound: m.isDownRound,
                yourValueAtMark: fmt(m.investorValueRpt, tl.reportingCurrency),
                moicAtMark: m.moicAtMark !== null ? fmtMultiple(m.moicAtMark) : "N/A",
                unrealisedGainLoss: fmt(m.unrealisedGainLossRpt, tl.reportingCurrency),
              })),
            })),
          };

          // ── Structured card for UI ─────────────────────────────────────────
          (computedData as Record<string, unknown>).__valuationCard =
            buildValuationCard(valData, fmt, fmtMultiple, fmtNum);
          break;
        }

        case "account_statement": {
          const er5 = getInvestorStatementSummary(investorId, db);
          const data = er5.result;
          evidence = er5.evidence;
          engineAssumptions = er5.assumptions;
          engineWarnings = er5.warnings;
          const investorName = db.investors.get(investorId)?.investor_name ?? "";
          computedData = {
            reportDate: REPORT_DATE,
            reportingCurrency: data.reportingCurrency,
            earliestDate: data.earliestDate,
            latestDate: data.latestDate,
            investorName,
            summary: {
              totalContributions: fmt(data.totalContributionsRpt, data.reportingCurrency),
              totalFees: fmt(data.totalFeesRpt, data.reportingCurrency),
              totalDistributions: fmt(data.totalDistributionsRpt, data.reportingCurrency),
              netCashFlow: fmt(Math.abs(data.netCashFlowRpt), data.reportingCurrency),
              netCashFlowRaw: data.netCashFlowRpt,
            },
            recentLines: data.lines.slice(-20).map((l) => ({
              date: l.date,
              type: l.type,
              company: l.companyName,
              round: l.round,
              amount: fmt(Math.abs(l.amountDealCcy), l.dealCurrency),
              direction: l.amountDealCcy < 0 ? "out" : "in",
              amountReporting: fmt(Math.abs(l.amountRpt), data.reportingCurrency),
            })),
            __statementCard: buildStatementCard(data, investorName),
          };
          break;
        }

        case "glossary_or_metric_explanation": {
          const term = entities.metricOrTerm ?? companyName ?? "";
          computedData = {
            term,
            context: "private_equity",
            hint: "Explain this term clearly for an investor, including how it applies to private equity. Include the formula if relevant.",
          };
          break;
        }

        case "unsupported_or_ambiguous":
        case "general_help":
        default:
          computedData = { message: "I can help with portfolio overview, individual positions, fees, obligations, distributions, valuation history, and your account statement." };
      }
    }

    // ── Policy layer: evidence integrity check ─────────────────────────────
    // Belt-and-suspenders: verify every evidence row belongs to this investor.
    const evidenceCheck = runEvidenceIntegrityCheck(investorId, evidence, db);
    if (!evidenceCheck.allowed) {
      return NextResponse.json(
        {
          answer: evidenceCheck.safeResponse ?? "An internal error occurred.",
          intent,
          evidence: [],
          fallbackMode: false,
          policyViolation: evidenceCheck.violationCode,
        },
        { status: 500 }
      );
    }

    // ── Compose answer via grounded composer ──────────────────────────────
    const apiKey = process.env.OPENAI_API_KEY;
    const openAIClient = apiKey ? new OpenAI({ apiKey }) : null;

    const personalization = getInvestorPersonalizationProfile(investorId, db).result;

    const answerObject: AnswerObject = await composeAnswer(
      {
        userMessage: message,
        intent,
        computedData,
        personalization,
        evidence,
        assumptions: engineAssumptions,
        warnings: engineWarnings,
        entities,
      },
      openAIClient
    );

    const response: ChatResponse & {
      feeCard?: unknown;
      valuationCard?: unknown;
      statementCard?: unknown;
      routerDebug?: unknown;
      answerObject?: AnswerObject;
    } = {
      answer: answerObject.detailedNarrative,
      intent,
      evidence,
      fallbackMode: answerObject.fallbackMode,
      routerDebug: buildRouterDebug(intentResult, evidence.length),
      answerObject,
    };

    // Attach structured cards when present
    if (computedData && typeof computedData === "object") {
      const cd = computedData as Record<string, unknown>;
      if (intent === "fee_detail" && cd.__feeCard) response.feeCard = cd.__feeCard;
      if (intent === "valuation_history" && cd.__valuationCard) response.valuationCard = cd.__valuationCard;
      if (intent === "account_statement" && cd.__statementCard) response.statementCard = cd.__statementCard;
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error("[chat/route] error:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Router debug payload ─────────────────────────────────────────────────────

function buildRouterDebug(r: RouterOutput, evidenceCount: number) {
  return {
    intent: r.intent,
    confidence: r.confidence,
    entities: r.entities,
    backendFunction: r.backendFunction,
    backendParams: r.backendParams,
    clarificationPrompt: r.clarificationPrompt,
    reasoning: r.reasoning,
    matchedKeywords: r.matchedKeywords,
    evidenceCount,
  };
}

// ─── Valuation card builder for UI ────────────────────────────────────────────

function buildValuationCard(
  valData: ValuationTimelineResult,
  fmt: (n: number, ccy: string) => string,
  fmtMultiple: (n: number | null) => string,
  fmtNum: (n: number, d?: number) => string
) {
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
      latestSharePriceDisplay: tl.latestSharePrice !== null
        ? fmt(tl.latestSharePrice, tl.dealCurrency) : null,
      latestMoic: tl.latestMoic,
      latestMoicDisplay: fmtMultiple(tl.latestMoic),
      latestInvestorValueDisplay: tl.latestInvestorValueRpt !== null
        ? fmt(tl.latestInvestorValueRpt, tl.reportingCurrency) : null,
      currentUnrealisedGainLoss: tl.currentUnrealisedGainLossRpt,
      currentUnrealisedGainLossDisplay: tl.currentUnrealisedGainLossRpt !== null
        ? fmt(tl.currentUnrealisedGainLossRpt, tl.reportingCurrency) : null,
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

// ─── Statement card builder for UI ────────────────────────────────────────────

const STMT_CONTRIBUTION_TYPES = new Set(["Capital Contribution"]);
const STMT_FEE_TYPES = new Set(["Management Fee", "Structuring Fee", "Admin Fee"]);
const STMT_DISTRIBUTION_TYPES = new Set(["Exit Proceeds", "Secondary Sale"]);

function buildStatementCard(data: StatementSummaryResult, investorName: string) {
  const { lines, reportingCurrency, totalContributionsRpt, totalFeesRpt, totalDistributionsRpt, netCashFlowRpt, earliestDate, latestDate } = data;

  type LineItem = {
    lineId: string; date: string; type: string; company: string; round: string;
    amountDisplay: string; amountRptDisplay: string; dealCurrency: string;
    direction: "in" | "out"; referenceId: string;
  };

  const contribLines: LineItem[] = [];
  const feeLines: LineItem[] = [];
  const distLines: LineItem[] = [];

  for (const l of lines) {
    const item: LineItem = {
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

  // Plain-language summary
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const dateRange =
    earliestDate && latestDate
      ? `Between ${fmtDate(earliestDate)} and ${fmtDate(latestDate)},`
      : "";
  const netLabel = netCashFlowRpt >= 0 ? "more received than deployed" : "more deployed than received";
  const parts = [
    `${dateRange} your account shows ${lines.length} transaction${lines.length !== 1 ? "s" : ""}.`,
    `You deployed ${fmt(totalContributionsRpt, reportingCurrency)} in capital contributions`,
    totalFeesRpt > 0
      ? `and paid ${fmt(totalFeesRpt, reportingCurrency)} in fees.`
      : "with no fee charges on record.",
    totalDistributionsRpt > 0
      ? `You received ${fmt(totalDistributionsRpt, reportingCurrency)} in distributions and exit proceeds.`
      : "No distributions have been received yet.",
    `The net cash flow is ${fmt(Math.abs(netCashFlowRpt), reportingCurrency)} (${netLabel}).`,
  ];
  const plainSummary = parts.join(" ");

  const dealCurrencies = new Set(lines.map((l) => l.dealCurrency));
  dealCurrencies.delete(reportingCurrency);
  const fxNote =
    dealCurrencies.size > 0
      ? `Reporting-currency amounts are converted from ${[...dealCurrencies].join(", ")} at static rates as of 25 Jun 2026. Original deal-currency amounts are shown alongside.`
      : null;

  return {
    reportingCurrency,
    reportDate: "2026-06-25",
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

// ─── Fee card builder for UI ──────────────────────────────────────────────────

function buildFeeCard(feeData: FeeBreakdownResult) {
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
        standardDisplay: s.basis === "flat USD"
          ? `USD ${s.standardRate.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
          : `${s.standardRate}%`,
        effectiveDisplay: s.basis === "flat USD"
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
        savingRptDisplay: s.savingRpt !== null
          ? fmt(s.savingRpt, feeData.reportingCurrency)
          : null,
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
      totalOverdue: d.totalOverdueRpt > 0 ? fmt(d.totalOverdueRpt, d.reportingCurrency) : null,
      estimatedAnnualMgmtSaving: d.estimatedAnnualMgmtSavingRpt !== null
        ? fmt(d.estimatedAnnualMgmtSavingRpt, d.reportingCurrency)
        : null,
    })),
  };
}

