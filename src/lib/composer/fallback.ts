/**
 * Deterministic fallback answer generator.
 *
 * Called when: (a) no API key is configured, or (b) the LLM call fails /
 * returns malformed JSON. Numbers are 100% correct — only phrasing is
 * template-driven rather than natural-language.
 */

import type { PersonalizationProfile } from "../engine/types";
import type { QueryIntent } from "../domain/types";
import type { KeyMetric } from "./types";

const REPORT_DATE = "2026-06-25";

export interface FallbackNarrative {
  conciseAnswer: string;
  detailedNarrative: string;
}

type D = Record<string, unknown>;

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNum(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function ccy(profile: PersonalizationProfile): string {
  return profile.reportingCurrency;
}

// ─── Per-intent fallback builders ─────────────────────────────────────────────

function fallbackPortfolioOverview(
  d: D,
  profile: PersonalizationProfile
): FallbackNarrative {
  const rpt = ccy(profile);
  const positions = asArr(d.positions) as D[];
  const isNovice = profile.sophisticationLevel === "Emerging";
  const moic = asStr(d.portfolioMoicFormatted) || "N/A";

  const conciseAnswer = isNovice
    ? `Your portfolio is currently worth ${asStr(d.totalValue)} (${rpt}), with a return multiple of ${moic} on your invested capital.`
    : `Portfolio: ${asStr(d.totalValue)} total value (${rpt}), MOIC ${moic} across ${asNum(d.activePositions)} active positions.`;

  const positionTable =
    positions.length > 0
      ? `| Company | Round | Status | Contributed | Value | MOIC |\n|---|---|---|---|---|---|\n` +
        positions
          .map(
            (p) =>
              `| ${asStr(p.company)} | ${asStr(p.round)} | ${asStr(p.status)} | ${asStr(p.contributed)} | ${asStr(p.currentValue)} | ${asStr(p.moic)} |`
          )
          .join("\n")
      : "_No positions found._";

  const detailedNarrative = `## Portfolio Overview — ${REPORT_DATE}

| Metric | Value |
|---|---|
| Total Committed | ${asStr(d.totalCommitted)} |
| Total Contributed | ${asStr(d.totalContributed)} |
| Current Value (unrealised) | ${asStr(d.totalCurrentValue)} |
| Net Distributions | ${asStr(d.totalDistributionsNet)} |
| **Total Portfolio Value** | **${asStr(d.totalValue)}** |
| **Portfolio MOIC** | **${moic}** |
| Active Positions | ${asNum(d.activePositions)} |
| Pending Positions | ${asNum(d.pendingPositions)} |

${isNovice ? "_MOIC (return multiple) = total value ÷ contributed capital. A MOIC of 2.0× means your portfolio is worth twice what you invested._\n\n" : ""}**Holdings**

${positionTable}

_Reporting currency: ${rpt} · Report date: ${REPORT_DATE}_`;

  return { conciseAnswer, detailedNarrative };
}

function fallbackPositionDetail(
  d: D,
  profile: PersonalizationProfile
): FallbackNarrative {
  const rpt = ccy(profile);
  const company = asStr(d.company);
  const moic = asStr(d.companyMoic) || "N/A";
  const isNovice = profile.sophisticationLevel === "Emerging";
  const rounds = asArr(d.rounds) as D[];

  const conciseAnswer = isNovice
    ? `Your ${company} position is currently worth ${asStr(d.totalCurrentValue)} (${rpt}) with a return of ${moic} on invested capital.`
    : `${company}: value ${asStr(d.totalValue)} (${rpt}), MOIC ${moic}${rounds.length > 1 ? `, ${rounds.length} rounds` : ""}.`;

  const roundRows = rounds
    .map(
      (r) =>
        `| ${asStr(r.round)} | ${asStr(r.allocationStatus)} | ${asStr(r.dealStatus)} | ${asStr(r.contributed)} | ${asStr(r.currentValue)} | ${asStr(r.moic)} |`
    )
    .join("\n");

  const detailedNarrative = `## ${company} — Position Detail

**Company:** ${company} · ${asStr(d.hqCountry)} · ${asStr(d.sector)}
**Status:** ${asStr(d.companyStatus)}

| Metric | Value |
|---|---|
| Total Committed | ${asStr(d.totalCommitted)} |
| Total Contributed | ${asStr(d.totalContributed)} |
| Current Value | ${asStr(d.totalCurrentValue)} |
| Total Distributions | ${asStr(d.totalDistributions)} |
| **Total Value** | **${asStr(d.totalValue)}** |
| **Company MOIC** | **${moic}** |

${
  rounds.length > 1
    ? `**Rounds (${rounds.length})**

| Round | Status | Deal | Contributed | Value | MOIC |
|---|---|---|---|---|---|
${roundRows}`
    : rounds.length === 1
    ? `**Round:** ${asStr(rounds[0].round)} — Entry price ${asStr(rounds[0].entrySharePrice)}${rounds[0].effectiveSharePrice !== rounds[0].entrySharePrice ? ` (your price: ${asStr(rounds[0].effectiveSharePrice)})` : ""}`
    : ""
}

_Reporting currency: ${rpt} · Report date: ${REPORT_DATE}_`;

  return { conciseAnswer, detailedNarrative };
}

function fallbackObligations(
  d: D,
  profile: PersonalizationProfile
): FallbackNarrative {
  const rpt = ccy(profile);
  const calls = asArr(d.capitalCalls) as D[];
  const fees = asArr(d.fees) as D[];
  const total = asStr(d.totalObligations);
  const isNovice = profile.sophisticationLevel === "Emerging";
  const overdueCount = fees.filter((f) => f.status === "Overdue").length;

  const conciseAnswer =
    overdueCount > 0
      ? `You have ${overdueCount} overdue fee item${overdueCount !== 1 ? "s" : ""} and a total of ${total} (${rpt}) in pending obligations.`
      : calls.length + fees.length === 0
      ? "You have no upcoming or overdue obligations at this time."
      : `You have ${total} (${rpt}) in upcoming obligations — ${calls.length} capital call${calls.length !== 1 ? "s" : ""} and ${fees.length} fee${fees.length !== 1 ? "s" : ""}.`;

  const callRows = calls
    .map(
      (c) =>
        `| ${asStr(c.company)} | ${asStr(c.round)} | Call #${asNum(c.callNumber)} | ${asStr(c.amount)} | ${asStr(c.dueDate)} | ${asStr(c.status)} |`
    )
    .join("\n");

  const feeRows = fees
    .map(
      (f) =>
        `| ${asStr(f.company)} | ${asStr(f.round)} | ${asStr(f.feeType)} | ${asStr(f.amount)} | ${asStr(f.dueDate)} | ${asStr(f.status)} |`
    )
    .join("\n");

  const detailedNarrative = `## Upcoming Obligations — ${REPORT_DATE}
${overdueCount > 0 ? `\n> ⚠️ **${overdueCount} overdue item${overdueCount !== 1 ? "s" : ""} require attention.**\n` : ""}
| Total Obligations | Capital Calls | Fees Due |
|---|---|---|
| **${total}** | ${asStr(d.totalCapitalCalls)} | ${asStr(d.totalFees)} |

${
  calls.length > 0
    ? `**Capital Calls**\n\n| Company | Round | Call | Amount | Due Date | Status |\n|---|---|---|---|---|---|\n${callRows}`
    : "**Capital Calls:** None"
}

${
  fees.length > 0
    ? `**Fees**\n\n| Company | Round | Type | Amount | Due Date | Status |\n|---|---|---|---|---|---|\n${feeRows}`
    : "**Fees:** None"
}

${isNovice ? "_A capital call is a request from the fund manager to transfer a portion of your committed capital. It is separate from any fees._\n\n" : ""}_Reporting currency: ${rpt} · Report date: ${REPORT_DATE}_`;

  return { conciseAnswer, detailedNarrative };
}

function fallbackDistributions(
  d: D,
  profile: PersonalizationProfile
): FallbackNarrative {
  const rpt = ccy(profile);
  const dists = asArr(d.distributions) as D[];
  const totalNet = asStr(d.totalNet);
  const isNovice = profile.sophisticationLevel === "Emerging";

  const conciseAnswer =
    dists.length === 0
      ? "No distributions have been received yet."
      : isNovice
      ? `You have received ${totalNet} (${rpt} net after performance fees) across ${dists.length} distribution event${dists.length !== 1 ? "s" : ""}.`
      : `${dists.length} distribution event${dists.length !== 1 ? "s" : ""}: gross ${asStr(d.totalGross)}, carry ${asStr(d.totalPerformanceFee)}, net ${totalNet} (${rpt}).`;

  const distRows = dists
    .map(
      (dist) =>
        `| ${asStr(dist.company)} | ${asStr(dist.round)} | ${asStr(dist.date)} | ${asStr(dist.type)} | ${asStr(dist.gross)} | ${asStr(dist.performanceFee)} | **${asStr(dist.net)}** |`
    )
    .join("\n");

  const detailedNarrative = `## Distributions Received — ${REPORT_DATE}

| Metric | Value |
|---|---|
| Total Gross | ${asStr(d.totalGross)} |
| Performance Fee (carry) | ${asStr(d.totalPerformanceFee)} |
| **Total Net Received** | **${totalNet}** |

${
  dists.length > 0
    ? `**Distribution Events**

| Company | Round | Date | Type | Gross | Carry | Net |
|---|---|---|---|---|---|---|
${distRows}`
    : "_No distributions received yet._"
}

${isNovice ? `_Performance fee (carry): the share of profits retained by the fund manager when a deal is exited. Net = Gross − Carry._\n\n` : ""}_Reporting currency: ${rpt} · Report date: ${REPORT_DATE}_`;

  return { conciseAnswer, detailedNarrative };
}

function fallbackAccountStatement(
  d: D,
  profile: PersonalizationProfile
): FallbackNarrative {
  const rpt = ccy(profile);
  const summary = (d.summary ?? {}) as D;
  const recentLines = asArr(d.recentLines) as D[];
  const isNovice = profile.sophisticationLevel === "Emerging";
  const netFlow = asStr(summary.netCashFlow);

  const conciseAnswer = isNovice
    ? `Your account net cash flow is ${netFlow} (${rpt}) — this is distributions received minus contributions and fees paid.`
    : `Net cash flow: ${netFlow} (${rpt}). Contributions: ${asStr(summary.totalContributions)} · Distributions: ${asStr(summary.totalDistributions)} · Fees: ${asStr(summary.totalFees)}.`;

  const lineRows = recentLines
    .slice(-15)
    .map(
      (l) =>
        `| ${asStr(l.date)} | ${asStr(l.company)} | ${asStr(l.type)} | ${asStr(l.direction) === "out" ? "−" : "+"}${asStr(l.amount)} |`
    )
    .join("\n");

  const detailedNarrative = `## Account Statement Summary — ${REPORT_DATE}

| Metric | Value |
|---|---|
| Total Contributions | ${asStr(summary.totalContributions)} |
| Total Fees Paid | ${asStr(summary.totalFees)} |
| Total Distributions | ${asStr(summary.totalDistributions)} |
| **Net Cash Flow** | **${netFlow}** |

${
  recentLines.length > 0
    ? `**Recent Transactions (last ${Math.min(15, recentLines.length)})**

| Date | Company | Type | Amount |
|---|---|---|---|
${lineRows}`
    : "_No transactions found._"
}

${isNovice ? `_Net cash flow = distributions received − contributions made − fees paid. A positive number means you have received more cash than you have deployed so far._\n\n` : ""}_Reporting currency: ${rpt} · Report date: ${REPORT_DATE}_`;

  return { conciseAnswer, detailedNarrative };
}

function fallbackGlossary(
  d: D,
  _profile: PersonalizationProfile
): FallbackNarrative {
  const term = asStr(d.term) || "this term";
  return {
    conciseAnswer: `I can explain ${term} in the context of private equity investing.`,
    detailedNarrative: `## What is ${term}?\n\nPlease connect an OpenAI API key to receive a detailed explanation tailored to your profile.\n\n_In the meantime, refer to the glossary section below for a brief definition._`,
  };
}

function fallbackDefault(
  d: D,
  _profile: PersonalizationProfile
): FallbackNarrative {
  const msg = asStr(d.message) || "Here is the data retrieved for your question.";
  return {
    conciseAnswer: msg,
    detailedNarrative: `${msg}\n\n\`\`\`json\n${JSON.stringify(d, null, 2)}\n\`\`\`\n\n_Connect an API key for a natural-language response._`,
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function buildFallbackNarrative(
  intent: QueryIntent,
  data: unknown,
  profile: PersonalizationProfile
): FallbackNarrative {
  const d = (data ?? {}) as D;

  switch (intent) {
    case "portfolio_overview":
      return fallbackPortfolioOverview(d, profile);
    case "position_detail":
      return fallbackPositionDetail(d, profile);
    case "obligations":
      return fallbackObligations(d, profile);
    case "distributions":
      return fallbackDistributions(d, profile);
    case "account_statement":
      return fallbackAccountStatement(d, profile);
    case "glossary_or_metric_explanation":
      return fallbackGlossary(d, profile);
    default:
      return fallbackDefault(d, profile);
  }
}

/**
 * Build a concise one-liner suitable for the `conciseAnswer` field
 * when computedData has an `error` field.
 */
export function buildErrorNarrative(errorMessage: string): FallbackNarrative {
  return {
    conciseAnswer: errorMessage,
    detailedNarrative: `> **Notice:** ${errorMessage}`,
  };
}
