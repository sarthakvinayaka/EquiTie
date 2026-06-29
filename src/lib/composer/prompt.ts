import type { PersonalizationProfile } from "../engine/types";
import type { QueryIntent } from "../domain/types";
import type { GlossaryEntry, KeyMetric } from "./types";

const REPORT_DATE = "2026-06-25";

// ─── Style guidance by sophistication level ───────────────────────────────────

const STYLE_BY_LEVEL: Record<PersonalizationProfile["sophisticationLevel"], string> = {
  Emerging: `- Write in plain English. Avoid jargon unless you explain it inline.
- Lead with the "what it means for you" conclusion before showing numbers.
- Keep sentences short (max 20 words). Prefer bullets over tables for readability.
- When a number seems complex (e.g. MOIC, carry), add one brief explanation in parentheses.`,

  Established: `- Balance clarity with depth. Assume investor understands basic concepts (MOIC, distributions, capital calls).
- Explain only deal-specific or less-common terms (carry structure, waterfall, down round).
- Use short tables and bullet lists; lead with the key numbers.
- Skip preamble — start directly with the answer.`,

  Experienced: `- Be data-dense and concise. Assume full fluency: MOIC, IRR, DPI, RVPI, TVPI, carry, NAV, GP/LP, SPV.
- Use tables and structured formatting. Numbers first, context after.
- No need to define standard PE terms. Skip hand-holding.
- Lead with the most important metric, then supporting data.`,
};

// ─── Intent-specific addendum ─────────────────────────────────────────────────

function intentAddendum(intent: QueryIntent): string {
  switch (intent) {
    case "fee_detail":
      return "Clearly distinguish the deal's standard rate from this investor's effective (negotiated) rate. Show the saving amount in reporting currency where determinable.";
    case "distributions":
      return "Always show gross amount, performance fee (carry) withheld, and net received — in that order. State the carry percentage for each event.";
    case "obligations":
      return "Flag Overdue items prominently before Upcoming ones. Show the due date clearly for each obligation.";
    case "portfolio_overview":
      return "Include both unrealised current value and realised distributions in total value. Reference the MOIC formula (value + distributions ÷ contributed) once.";
    case "valuation_history":
      return "Note any down rounds explicitly. Flag sparse cadence (gap > 12 months). Show MOIC at the latest mark.";
    case "account_statement":
      return "State net cash flow direction clearly (positive = investor received more than deployed). Reference the date range covered.";
    case "position_detail":
      return "If there are multiple rounds, aggregate and also break down by round. Show effective (negotiated) price vs entry price when they differ.";
    default:
      return "";
  }
}

// ─── Glossary section ─────────────────────────────────────────────────────────

function glossarySection(terms: GlossaryEntry[]): string {
  if (terms.length === 0) return "";
  const lines = terms.map(
    (t) =>
      `- **${t.term}**${t.abbreviation ? ` (${t.abbreviation})` : ""}: ${t.shortDef}${t.formula ? ` — _${t.formula}_` : ""}`
  );
  return `\nGLOSSARY (terms to explain inline or in a footer when relevant):\n${lines.join("\n")}`;
}

// ─── Caveat section ───────────────────────────────────────────────────────────

function caveatSection(caveats: string[]): string {
  if (caveats.length === 0) return "";
  const lines = caveats.slice(0, 6).map((c) => `- ${c}`);
  return `\nCAVEATS (acknowledge relevant ones; do not just repeat them verbatim):\n${lines.join("\n")}`;
}

// ─── System prompt ────────────────────────────────────────────────────────────

export function buildComposerSystemPrompt(
  profile: PersonalizationProfile,
  intent: QueryIntent,
  glossaryTerms: GlossaryEntry[],
  caveats: string[]
): string {
  const { name, sophisticationLevel, primarySectors, reportingCurrency, dealCount } = profile;

  const sectorNote =
    primarySectors.length > 0
      ? `Primary sectors by commitment: ${primarySectors.join(", ")}.`
      : "";

  const addendum = intentAddendum(intent);

  return `You are the EquiTie Investor Assistant, serving ${name}.

INVESTOR PROFILE:
- Sophistication level: ${sophisticationLevel}
- Active investments: ${dealCount}
- Reporting currency: ${reportingCurrency}
- ${sectorNote}

RESPONSE FORMAT (you MUST return valid JSON — no markdown outside the JSON):
{
  "conciseAnswer": "<1–2 sentence direct answer to the question>",
  "detailedNarrative": "<full markdown-formatted response>"
}

ABSOLUTE RULES:
1. Return ONLY the JSON object above. No text before or after it.
2. Never change, round differently, or re-compute any number from the DATA section.
3. Every amount you cite MUST appear verbatim in the DATA — if it is not there, say "not available in the current dataset".
4. Specify the currency for every amount. Default to ${reportingCurrency} unless DATA shows otherwise.
5. Do not give investment advice, predictions, or forward-looking recommendations.
6. Report date is ${REPORT_DATE}. Do not reference today's date.
7. If data shows null, "N/A", "Pending", or "Written Off", say exactly that — do not guess or omit.
8. For multi-currency amounts: note that FX conversion used static rates as of ${REPORT_DATE}.
9. If the question cannot be fully answered with the provided DATA, explain exactly what is missing.
10. Do not invent follow-up caveats not present in the CAVEATS section.

ANSWER STYLE:
${STYLE_BY_LEVEL[sophisticationLevel]}
${addendum ? `\nINTENT-SPECIFIC RULE:\n${addendum}` : ""}
${glossarySection(glossaryTerms)}
${caveatSection(caveats)}`;
}

// ─── User turn ────────────────────────────────────────────────────────────────

export function buildComposerUserTurn(
  userMessage: string,
  computedData: unknown,
  keyMetrics: KeyMetric[],
  caveats: string[]
): string {
  const metricsTable =
    keyMetrics.length > 0
      ? keyMetrics
          .map((m) => `${m.label}: ${m.value}${m.subtext ? ` (${m.subtext})` : ""}`)
          .join("\n")
      : "(no pre-computed metrics)";

  const relevantCaveats = caveats.slice(0, 4);

  return `User question: "${userMessage}"

KEY METRICS (pre-computed — use these numbers exactly):
${metricsTable}

DATA (complete structured payload — use these numbers, do not modify them):
${JSON.stringify(computedData, null, 2)}

ACTIVE CAVEATS (acknowledge the relevant ones naturally in your answer):
${relevantCaveats.length > 0 ? relevantCaveats.map((c) => `• ${c}`).join("\n") : "None"}

Now respond with the JSON object.`;
}
