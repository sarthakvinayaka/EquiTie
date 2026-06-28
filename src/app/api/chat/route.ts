import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getDatabase } from "@/lib/data/loader";
import { runPolicyChecks, runIntentPolicyChecks, runEvidenceIntegrityCheck } from "@/lib/policy/engine";
import { classifyIntent } from "@/lib/query/router";
import { getPortfolioOverview } from "@/lib/domain/portfolio";
import { getPositionDetail } from "@/lib/domain/positions";
import { getObligations } from "@/lib/domain/obligations";
import { getDistributions } from "@/lib/domain/distributions";
import { getFeeBreakdown } from "@/lib/domain/fees";
import { getValuationHistory } from "@/lib/domain/valuations";
import { getAccountStatement } from "@/lib/domain/statement";
import {
  buildInvestorProfile,
  buildSystemPrompt,
  buildUserTurn,
} from "@/lib/prompt/formatter";
import type { ChatRequest, ChatResponse, EvidenceItem, QueryIntent } from "@/lib/domain/types";
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
    const intentResult = classifyIntent(message, investorId, db);
    const { intent, companyName, ambiguous } = intentResult;

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
        },
        { status: 200 }
      );
    }

    // ── Deterministic computation ──────────────────────────────────────────
    let computedData: unknown = null;
    let evidence: EvidenceItem[] = [];

    {
      switch (intent) {
        case "portfolio_overview": {
          const data = getPortfolioOverview(investorId, db);
          evidence = data.evidence;
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
          const data = getPositionDetail(investorId, name, db);
          if (!data) {
            computedData = { error: `No position found for "${name}" in this investor's portfolio.` };
            break;
          }
          evidence = data.evidence;
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
          const data = getObligations(investorId, db);
          evidence = data.evidence;
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
          const data = getDistributions(investorId, db);
          evidence = data.evidence;
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
          const data = getFeeBreakdown(investorId, name, db);
          evidence = data.flatMap((d) => d.evidence);
          computedData = {
            reportDate: REPORT_DATE,
            reportingCurrency: db.investors.get(investorId)!.reporting_currency,
            deals: data.map((d) => ({
              company: d.companyName,
              round: d.round,
              dealCurrency: d.dealCurrency,
              hasNegotiatedDiscount: d.feeDiscount,
              standardSchedule: {
                mgmtFeePct: `${d.stdMgmtFeePct}%`,
                performanceFeePct: `${d.stdPerfFeePct}%`,
                structuringFeePct: `${d.stdStructuringFeePct}%`,
                adminFeeUsd: fmt(d.stdAdminFeeUsd, "USD"),
              },
              yourEffectiveRates: {
                mgmtFeePct: `${d.effMgmtFeePct}%`,
                performanceFeePct: `${d.effPerfFeePct}%`,
                structuringFeePct: `${d.effStructuringFeePct}%`,
                adminFeeUsd: fmt(d.effAdminFeeUsd, "USD"),
              },
              feeLines: d.fees.map((f) => ({
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
            })),
          };
          break;
        }

        case "valuation_history": {
          const name = companyName ?? "";
          if (!name) {
            computedData = { error: "Please specify which company's valuation history you want to see." };
            break;
          }
          const data = getValuationHistory(investorId, name, db);
          evidence = data.flatMap((h) => h.evidence);
          computedData = {
            reportDate: REPORT_DATE,
            histories: data.map((h) => ({
              company: h.companyName,
              round: h.round,
              dealCurrency: h.dealCurrency,
              reportingCurrency: h.reportingCurrency,
              entrySharePrice: fmt(h.entrySharePrice, h.dealCurrency),
              yourEffectivePrice: fmt(h.effectiveSharePrice, h.dealCurrency),
              units: fmtNum(h.units),
              contributed: fmt(h.contributed, h.reportingCurrency),
              marks: h.marks.map((m) => ({
                date: m.date,
                sharePrice: fmt(m.sharePrice, h.dealCurrency),
                companyValuation: `${fmtNum(m.companyValuationM, 1)}M ${h.dealCurrency}`,
                source: m.markSource,
                multipleVsEntry: `${m.multipleVsEntry}×`,
                yourValueAtMark:
                  m.investorValueRpt !== null
                    ? fmt(m.investorValueRpt, h.reportingCurrency)
                    : "N/A",
                moicAtMark: m.moicAtMark !== null ? fmtMultiple(m.moicAtMark) : "N/A",
              })),
            })),
          };
          break;
        }

        case "account_statement": {
          const data = getAccountStatement(investorId, db);
          evidence = data.evidence;
          computedData = {
            reportDate: REPORT_DATE,
            reportingCurrency: data.reportingCurrency,
            summary: {
              totalContributions: fmt(data.totalContributionsRpt, data.reportingCurrency),
              totalFees: fmt(data.totalFeesRpt, data.reportingCurrency),
              totalDistributions: fmt(data.totalDistributionsRpt, data.reportingCurrency),
              netCashFlow: fmt(data.netCashFlowRpt, data.reportingCurrency),
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
          };
          break;
        }

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

    // ── LLM formatting ─────────────────────────────────────────────────────
    const profile = buildInvestorProfile(investorId, db);
    const systemPrompt = buildSystemPrompt(profile, intent);
    const userTurn = buildUserTurn(message, computedData);

    const apiKey = process.env.OPENAI_API_KEY;
    let answer: string;
    let fallbackMode = false;

    if (apiKey) {
      const client = new OpenAI({ apiKey });
      const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        // Include recent history for multi-turn context (last 6 turns)
        ...history.slice(-6).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: userTurn },
      ];

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 1024,
        messages: msgs,
      });

      answer = response.choices[0]?.message?.content ?? "";
    } else {
      // Fallback: structured template when no API key
      fallbackMode = true;
      answer = formatFallbackAnswer(intent, computedData, profile);
    }

    const response: ChatResponse = {
      answer,
      intent,
      evidence,
      fallbackMode,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[chat/route] error:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Template-based fallback when no API key is set.
 * Formats the computed data into readable markdown.
 * Numbers are always correct — only the phrasing is less natural.
 */
function formatFallbackAnswer(
  intent: QueryIntent,
  data: unknown,
  profile: ReturnType<typeof buildInvestorProfile>
): string {
  const d = data as Record<string, unknown>;

  switch (intent) {
    case "portfolio_overview": {
      const positions = (d.positions as { company: string; round: string; status: string; contributed: string; currentValue: string; distributions: string; moic: string }[]) ?? [];
      const lines = positions
        .map(
          (p) =>
            `| ${p.company} | ${p.round} | ${p.status} | ${p.contributed} | ${p.currentValue} | ${p.distributions} | ${p.moic} |`
        )
        .join("\n");
      return `**Portfolio Overview** (${d.reportingCurrency})

| Metric | Value |
|---|---|
| Total Committed | ${d.totalCommitted} |
| Total Contributed | ${d.totalContributed} |
| Current Value (unrealised) | ${d.totalCurrentValue} |
| Total Distributions (net) | ${d.totalDistributionsNet} |
| **Total Portfolio Value** | **${d.totalValue}** |
| **Portfolio MOIC** | **${d.portfolioMoicFormatted}** |
| Active Positions | ${d.activePositions} |

**Holdings**

| Company | Round | Status | Contributed | Current Value | Distributions | MOIC |
|---|---|---|---|---|---|---|
${lines}

_Report date: ${d.reportDate} · ${profile.name}_`;
    }

    case "obligations": {
      const calls = (d.capitalCalls as { company: string; round: string; dueDate: string; amount: string; status: string }[]) ?? [];
      const fees = (d.fees as { company: string; feeType: string; dueDate: string; status: string; amount: string }[]) ?? [];
      const callLines = calls.map((c) => `- **${c.company} ${c.round}** — ${c.amount} due ${c.dueDate} (${c.status})`).join("\n");
      const feeLines = fees.map((f) => `- **${f.company}** — ${f.feeType}: ${f.amount} due ${f.dueDate} [${f.status}]`).join("\n");
      return `**Upcoming Obligations** · Total: ${d.totalObligations}

**Capital Calls** (${d.totalCapitalCalls})
${callLines || "_None_"}

**Fees** (${d.totalFees})
${feeLines || "_None_"}`;
    }

    case "distributions": {
      const dists = (d.distributions as { company: string; round: string; date: string; type: string; gross: string; performanceFee: string; net: string }[]) ?? [];
      const lines = dists.map((dist) => `- **${dist.company} ${dist.round}** (${dist.date}) — ${dist.type}: Gross ${dist.gross}, Carry ${dist.performanceFee}, **Net ${dist.net}**`).join("\n");
      return `**Distributions**

Total Gross: ${d.totalGross}
Total Performance Fee: ${d.totalPerformanceFee}
**Total Net Received: ${d.totalNet}**

${lines || "_No distributions_"}`;
    }

    default:
      return `**Data (Demo Mode — connect API key for natural language responses)**\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  }
}
