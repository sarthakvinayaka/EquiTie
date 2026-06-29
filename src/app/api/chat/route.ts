/**
 * Chat route — central request orchestrator.
 *
 * Layer order enforced here (every request follows this exact path):
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  1. INGESTION       CSV files parsed once at startup (data/loader)   │
 *   │  2. DOMAIN MODEL    Typed raw rows + indexed Maps (data/types)        │
 *   │  3. ACCESS BOUNDARY Policy pre-checks G1–G3 (policy/engine)          │
 *   │  4. INTENT ROUTER   Deterministic regex classifier (query/router)     │
 *   │  5. INTENT POLICY   Post-intent checks G4–G5 (policy/engine)         │
 *   │  6. FINANCE ENGINE  Deterministic computation, EngineResult<T>        │
 *   │  7. EVIDENCE CHECK  Post-computation integrity G6 (policy/engine)     │
 *   │  8. COMPOSER        LLM phrasing (fallback to templates if no key)   │
 *   │  9. CARD BUILDER    Structured UI objects (composer/cards)            │
 *   │  10. RESPONSE       Serialised JSON → UI layer                        │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Rule: no investor data reaches the LLM until layers 3–7 have passed.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getDatabase } from "@/lib/data/loader";
import { runPolicyChecks, runIntentPolicyChecks, runEvidenceIntegrityCheck } from "@/lib/policy/engine";
import { classifyIntent } from "@/lib/query/router";
import {
  getInvestorPortfolioOverview,
  getInvestorPositionByCompany,
  getInvestorUpcomingObligations,
  getInvestorDistributions,
  getInvestorStatementSummary,
  getInvestorPersonalizationProfile,
} from "@/lib/engine";
import { getInvestorFeeBreakdown } from "@/lib/engine/fees";
import { getInvestorValuationTimeline } from "@/lib/engine/valuations";
import { composeAnswer } from "@/lib/composer";
import type { AnswerObject } from "@/lib/composer";
import { buildFeeCard, buildValuationCard, buildStatementCard } from "@/lib/composer/cards";
import type { ChatRequest, ChatResponse, EvidenceItem, RouterOutput } from "@/lib/domain/types";
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
            buildValuationCard(valData);
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


