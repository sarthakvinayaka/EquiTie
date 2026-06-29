import type { Database } from "../data/loader";
import type { ExtractedEntities, QueryIntent, RouterOutput } from "../domain/types";

// ─── Backend function mapping ──────────────────────────────────────────────────

const BACKEND_FUNCTION: Record<QueryIntent, string> = {
  portfolio_overview: "getInvestorPortfolioOverview",
  position_detail: "getPositionDetail",
  obligations: "getInvestorUpcomingObligations",
  distributions: "getInvestorDistributions",
  fee_detail: "getInvestorFeeBreakdown",
  valuation_history: "getInvestorValuationTimeline",
  account_statement: "getInvestorStatementSummary",
  glossary_or_metric_explanation: "(no backend — LLM explains the term)",
  unsupported_or_ambiguous: "(no backend — clarification required)",
  general_help: "(no backend — LLM handles)",
};

// ─── Glossary terms ────────────────────────────────────────────────────────────

// Terms that identify a glossary question (when no possessive "my"/"our")
const GLOSSARY_TERM_PATTERNS = [
  /\bmoic\b/,
  /\birr\b/,
  /\bdpi\b/,
  /\brvpi\b/,
  /\btvpi\b/,
  /\bnav\b/,
  /\b(?:gp|general\s+partner)\b/,
  /\b(?:lp|limited\s+partner)\b/,
  /\bcarry\b|\bcarried\s+interest\b/,
  /\bwaterfall\b/,
  /\bj[- ]?curve\b/,
  /\bhurdle\s*(?:rate)?\b/,
  /\bclawback\b/,
  /\bdrawdown\b/,
  /\bblind\s+pool\b/,
  /\bpari\s+passu\b/,
  /\bpro[\s-]?rata\b/,
  /\bvintage\s+year\b/,
  /\bmanagement\s+fee\b/,
  /\bperformance\s+fee\b/,
  /\bstructuring\s+fee\b/,
  /\badmin(?:istration)?\s+fee\b/,
  /\bcapital\s+call\b/,
  /\bdistribution\b/,
  /\bmultiple\s+on\s+invested\s+capital\b/,
  /\binternal\s+rate\s+of\s+return\b/,
  /\bnet\s+asset\s+value\b/,
  /\bcommitment\b/,
  /\bcontributed\s+capital\b/,
];

// Language patterns that mean "explain this to me" (not "show me my data")
const DEFINE_PATTERN =
  /\bwhat\s+(?:is|are)\s+(?!my\b|our\b|the\s+(?:current|latest|total|overall)\b)|\bwhat\s+does\s+\w[\w\s]*\b(?:mean|stand\s+for|refer\s+to)\b|\bexplain\b|\bdefine\b|\bmeaning\s+of\b|\bhow\s+(?:is|does|do)\s+(?:a|an|the)?\s*\w[\w\s]*(?:calculated|computed|work|determined)\b|\bdifference\s+between\b|\bwhat['']?s\s+the\s+difference\b|\btell\s+me\s+about\s+the\s+(?:concept|term|idea)\b/i;

// ─── Unsupported topic patterns ────────────────────────────────────────────────

const UNSUPPORTED_PATTERN =
  /\b(?:weather|forecast|temperature|flight|hotel|book(?:ing)?\s+a|restaurant|recipe|cook|news|headline|stock\s+price|crypto(?:currency)?|bitcoin|ethereum|nft|tax\s+advice|legal\s+advice|medical|doctor|insurance(?!\s+fee)|transfer\s+money|send\s+money|bank\s+transfer|bet|gamble|lottery|sports?(?:\s+score)?|election|vote|social\s+media|tweet|instagram)\b/i;

// ─── Round extractor ───────────────────────────────────────────────────────────

function extractRound(lower: string): string | null {
  const m = lower.match(
    /\b(pre-?seed|seed|series\s+[a-e]\+?|series\s+[a-e]{1,2}|growth|bridge|pre-?ipo)\b/i
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

// ─── Metric/term extractor ─────────────────────────────────────────────────────

function extractMetricOrTerm(lower: string): string | null {
  for (const pattern of GLOSSARY_TERM_PATTERNS) {
    const m = lower.match(pattern);
    if (m) return m[0].trim();
  }
  return null;
}

// ─── Date range extractor ──────────────────────────────────────────────────────

function extractDateRange(lower: string): ExtractedEntities["dateRange"] {
  const yearMatch = lower.match(/\b(20[12]\d)\b/g);
  if (yearMatch) {
    return { from: yearMatch[0], to: yearMatch[yearMatch.length - 1] ?? null };
  }
  if (/\blast\s+year\b/.test(lower)) return { from: "2025", to: "2025" };
  if (/\bthis\s+year\b|\bytd\b|\byear[\s-]to[\s-]date\b/.test(lower))
    return { from: "2026", to: null };
  if (/\blast\s+month\b/.test(lower)) return { from: null, to: null };
  return null;
}

// ─── Company scorer (same scoring logic as before) ────────────────────────────

interface ScoredCompany {
  id: string;
  name: string;
  score: number;
}

function scoreCompanies(
  lower: string,
  investorCompanies: { companyId: string; name: string; lowerName: string }[]
): ScoredCompany[] {
  const scored: ScoredCompany[] = [];
  for (const co of investorCompanies) {
    let score = 0;
    if (lower.includes(co.lowerName)) {
      score = 1.0; // exact phrase
    } else {
      const words = co.lowerName.split(/\s+/).filter((w) => w.length > 3);
      if (words.length > 0) {
        const matched = words.filter((w) => lower.includes(w)).length;
        if (matched === words.length) score = 0.8; // all significant words
        else if (matched > 0) score = (matched / words.length) * 0.5; // partial
      }
    }
    if (score > 0) scored.push({ id: co.companyId, name: co.name, score });
  }
  return scored;
}

// ─── Main classification function ─────────────────────────────────────────────

/**
 * Deterministic intent classifier and entity extractor.
 *
 * Returns a structured RouterOutput with:
 * - intent + confidence score
 * - extracted entities (company, round, term, date range)
 * - which backend function to call + params
 * - clarification prompt when ambiguous or unsupported
 * - dev-readable reasoning + matched keywords
 */
export function classifyIntent(
  message: string,
  investorId: string,
  db: Database
): RouterOutput {
  const lower = message.toLowerCase().trim();
  const matchedKeywords: string[] = [];

  // ── Entity extraction ──────────────────────────────────────────────────────
  const round = extractRound(lower);
  const metricOrTerm = extractMetricOrTerm(lower);
  const dateRange = extractDateRange(lower);
  if (round) matchedKeywords.push(`round:${round}`);
  if (metricOrTerm) matchedKeywords.push(`term:${metricOrTerm}`);

  // ── Build investor company list ────────────────────────────────────────────
  const investorAllocIds = db.allocationsByInvestor.get(investorId) ?? [];
  const investorCompanies: { companyId: string; name: string; lowerName: string }[] = [];
  const seenCompanyIds = new Set<string>();

  for (const allocId of investorAllocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    if (seenCompanyIds.has(deal.company_id)) continue;
    seenCompanyIds.add(deal.company_id);
    const company = db.companies.get(deal.company_id);
    if (!company) continue;
    investorCompanies.push({
      companyId: company.company_id,
      name: company.company_name,
      lowerName: company.company_name.toLowerCase(),
    });
  }

  // ── Company matching ───────────────────────────────────────────────────────
  const scored = scoreCompanies(lower, investorCompanies);
  const maxScore = scored.length > 0 ? scored.reduce((m, s) => Math.max(m, s.score), 0) : 0;
  const topMatches = scored.filter((s) => s.score === maxScore);

  // Resolved company (exactly one match)
  const resolvedCompany = topMatches.length === 1 ? topMatches[0] : null;
  const ambiguousCompanies = topMatches.length > 1 ? topMatches.map((m) => m.name) : null;

  if (resolvedCompany) matchedKeywords.push(`company:${resolvedCompany.name}`);
  if (ambiguousCompanies) matchedKeywords.push(`ambiguous:${ambiguousCompanies.join("/")}`);

  const entities: ExtractedEntities = {
    companyName: resolvedCompany?.name ?? null,
    companyId: resolvedCompany?.id ?? null,
    round,
    metricOrTerm,
    dateRange,
    ambiguousCompanies,
  };

  // ── Helper to build output ─────────────────────────────────────────────────
  function out(
    intent: QueryIntent,
    confidence: number,
    reasoning: string,
    clarificationPrompt: string | null = null,
    extraParams: Record<string, unknown> = {}
  ): RouterOutput {
    return {
      intent,
      confidence,
      entities,
      backendFunction: BACKEND_FUNCTION[intent],
      backendParams: {
        investorId,
        companyName: entities.companyName ?? "",
        round: entities.round ?? "",
        ...extraParams,
      },
      clarificationPrompt,
      reasoning,
      matchedKeywords,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLASSIFICATION — checked in priority order
  // ═══════════════════════════════════════════════════════════════════════════

  // ── P0: Unsupported topics (bail out fast) ─────────────────────────────────
  if (UNSUPPORTED_PATTERN.test(lower)) {
    const m = lower.match(UNSUPPORTED_PATTERN)!;
    matchedKeywords.push(`unsupported-topic:${m[0]}`);
    return out(
      "unsupported_or_ambiguous",
      0.1,
      `Message matches unsupported-topic pattern ("${m[0]}"): out of scope for investor portal`,
      "I can only help with your private equity investments — portfolio overview, positions, fees, distributions, obligations, valuations, and account statement. What would you like to know about your portfolio?"
    );
  }

  // ── P1: Glossary / definition questions ───────────────────────────────────
  // "what is MOIC" (no possessive) → explain the term
  // "what is my MOIC" (possessive) → portfolio data question
  const hasPossessive = /\bmy\b|\bour\b/.test(lower);
  const hasDefineLanguage = DEFINE_PATTERN.test(lower);
  const hasGlossaryTerm = metricOrTerm !== null || GLOSSARY_TERM_PATTERNS.some((p) => p.test(lower));

  if (hasDefineLanguage && hasGlossaryTerm && !hasPossessive && !resolvedCompany) {
    matchedKeywords.push("define-language");
    return out(
      "glossary_or_metric_explanation",
      0.92,
      `Definition language detected ("${lower.slice(0, 60)}…") + financial term "${metricOrTerm}" — no possessive pronoun, no company context`,
      null,
      { term: metricOrTerm ?? "" }
    );
  }

  // ── P2: Ambiguous entity ───────────────────────────────────────────────────
  if (ambiguousCompanies && ambiguousCompanies.length > 1) {
    const list = ambiguousCompanies.map((n) => `"${n}"`).join(" or ");
    matchedKeywords.push("ambiguous-company");
    return out(
      "unsupported_or_ambiguous",
      0.5,
      `Multiple companies matched at equal score (${ambiguousCompanies.join(" / ")}): cannot route without clarification`,
      `I found multiple companies that could match — did you mean ${list}? Please be more specific.`
    );
  }

  // ── P3: Company-specific routing ──────────────────────────────────────────
  if (resolvedCompany) {
    const companyScore = resolvedCompany.score;

    // Fee sub-intent
    if (/\bfee|management\s+fee|\bcarry\b|performance\s+fee|structuring|admin\s+fee|fee\s+discount\b/.test(lower)) {
      matchedKeywords.push("fee-keyword");
      return out(
        "fee_detail",
        companyScore >= 1.0 ? 1.0 : 0.9,
        `Company "${resolvedCompany.name}" matched (score ${companyScore}) + fee keyword → fee_detail`
      );
    }

    // Valuation sub-intent
    if (
      /\bvaluat|mark(?:\s+history|\s+to\s+market)?|mark\s*up\s+round|over\s+time|price.*moved|down\s*round|latest\s+mark|share\s+price|how.*worth\b/.test(
        lower
      )
    ) {
      matchedKeywords.push("valuation-keyword");
      return out(
        "valuation_history",
        companyScore >= 1.0 ? 1.0 : 0.9,
        `Company "${resolvedCompany.name}" matched (score ${companyScore}) + valuation keyword → valuation_history`
      );
    }

    // Distribution sub-intent
    if (/\bdistribut|exit\s+proceed|realised|realized|received|paid\s+out\b/.test(lower)) {
      matchedKeywords.push("distribution-keyword");
      return out(
        "distributions",
        companyScore >= 1.0 ? 1.0 : 0.9,
        `Company "${resolvedCompany.name}" matched (score ${companyScore}) + distribution keyword → distributions`
      );
    }

    // Default company match → position detail
    matchedKeywords.push("company-match");
    return out(
      "position_detail",
      companyScore >= 1.0 ? 1.0 : companyScore >= 0.8 ? 0.9 : 0.75,
      `Company "${resolvedCompany.name}" matched (score ${companyScore}) → position_detail`
    );
  }

  // ── P4: Keyword-only routing (no company match) ────────────────────────────

  // Account statement / transactions
  if (
    /\b(?:account\s+)?statement\b|\btransaction(?:s)?\b|\bcash\s*flow\b|\bcash\s*statement\b|\bactivity\s+log\b|\bmovement(?:s)?\b/.test(
      lower
    )
  ) {
    const kw = lower.match(
      /\b(?:account\s+)?statement\b|\btransaction(?:s)?\b|\bcash\s*flow\b|\bmovement(?:s)?\b/
    )![0];
    matchedKeywords.push(`statement-keyword:${kw}`);
    return out(
      "account_statement",
      0.88,
      `Statement/transaction keyword "${kw}" matched`
    );
  }

  // Obligations / capital calls / owed amounts
  if (
    /\b(?:upcoming|overdue|outstanding)\s+(?:fee|capital|obligation)|\bcapital\s*call(?:s)?\b|\bdue\s+(?:date|this|next|soon|in)\b|\bi\s+owe\b|\bwhat.*owe\b|\bnext\s+call\b|\bobligation(?:s)?\b/.test(
      lower
    )
  ) {
    const kw = lower.match(
      /\bcapital\s*call(?:s)?\b|\bobligation(?:s)?\b|\boverdue\b|\bupcoming\b|\bi\s+owe\b/
    )?.[0] ?? "obligation-keyword";
    matchedKeywords.push(`obligation-keyword:${kw}`);
    return out(
      "obligations",
      0.88,
      `Obligation/capital-call keyword "${kw}" matched`
    );
  }

  // Distributions / exits / proceeds received
  if (
    /\bdistribut(?:ion|ions|ed)?\b|\bexit\s+proceed(?:s)?\b|\bsecondary\s+sale\b|\brealised\b|\brealized\b|\bproceeds\b|\bhave\s+I\s+received\b|\bwhat\s+.*received\b|\bnet\s+received\b|\bactually\s+(?:received|gotten|made)\b/.test(
      lower
    )
  ) {
    const kw = lower.match(
      /\bdistribut(?:ion|ions|ed)?\b|\bexit\s+proceed(?:s)?\b|\bproceeds\b|\breceived\b/
    )?.[0] ?? "distribution-keyword";
    matchedKeywords.push(`distribution-keyword:${kw}`);
    return out(
      "distributions",
      0.88,
      `Distribution/exit-proceeds keyword "${kw}" matched`
    );
  }

  // Fee (no company) — overall fee question
  if (
    /\bfee(?:s)?\b|\bmanagement\s*fee\b|\bperformance\s*fee\b|\bcarry(?:ing)?\b|\bstructuring\b|\badmin(?:istration)?\s*fee\b|\bfee\s*discount\b/.test(
      lower
    )
  ) {
    const kw = lower.match(
      /\bfee(?:s)?\b|\bmanagement\s*fee\b|\bcarry\b|\bstructuring\b/
    )?.[0] ?? "fee";
    matchedKeywords.push(`fee-keyword:${kw}`);
    return out(
      "fee_detail",
      0.85,
      `Fee keyword "${kw}" matched without company → all-portfolio fee breakdown`
    );
  }

  // Valuation / marks (no company)
  if (
    /\bvaluat(?:ion|ions|ed)?\b|\bmark(?:\s+history|\s+to\s+market|up\s+round)?\b|\bdown\s*round(?:s)?\b|\bshare\s+price(?:s)?\b|\blatest\s+mark\b|\bcompany.+worth\b|\bprice\s+(?:moved|changed|trend)/.test(
      lower
    )
  ) {
    const kw = lower.match(
      /\bvaluat(?:ion|ions|ed)?\b|\bdown\s*round\b|\bshare\s+price\b|\bmark\b/
    )?.[0] ?? "valuation";
    matchedKeywords.push(`valuation-keyword:${kw}`);
    return out(
      "valuation_history",
      0.82,
      `Valuation/marks keyword "${kw}" matched without company → all-portfolio valuation timelines`
    );
  }

  // Position / share price / "what did I pay" — needs company but can still route
  if (
    /\bwhat\s+did\s+i\s+(?:pay|invest|put\s+in)\b|\bmy\s+(?:entry|effective)\s+price\b|\bhow\s+much\s+(?:did\s+i|have\s+i)\s+(?:invested|committed|contributed)\b|\bprice\s+(?:discount|discounted|break)\b/.test(
      lower
    )
  ) {
    matchedKeywords.push("price-lookup-keyword");
    const hint = round ? ` (round: ${round})` : "";
    return out(
      "position_detail",
      0.65,
      `Price/entry-lookup keyword matched but no company resolved${hint}`,
      round
        ? `Which company's ${round} position are you asking about?`
        : "Which company are you asking about?"
    );
  }

  // Portfolio overview — broad portfolio questions
  if (
    /\bportfolio\b|\boverview\b|\bholding(?:s)?\b|\ball\s+(?:my\s+)?deal(?:s)?\b|\ball\s+(?:my\s+)?position(?:s)?\b|\btotal\s+(?:value|committed|contributed|invested)\b|\bnet\s+worth\b|\bhow\s+(?:am\s+i|is\s+my\s+portfolio)\s+doing\b|\bmy\s+moic\b|\bmy\s+return(?:s)?\b|\bmy\s+investment(?:s)?\b|\bmy\s+(?:total|overall)\b/.test(
      lower
    )
  ) {
    const kw = lower.match(
      /\bportfolio\b|\boverview\b|\bholding(?:s)?\b|\btotal\s+value\b|\bmy\s+moic\b|\bmy\s+return(?:s)?\b/
    )?.[0] ?? "portfolio";
    matchedKeywords.push(`overview-keyword:${kw}`);
    return out(
      "portfolio_overview",
      0.82,
      `Portfolio overview keyword "${kw}" matched`
    );
  }

  // Summary / performance catch-all
  if (
    /\bsummary\b|\bperformance\b|\btrack\s+record\b|\bhow.+going\b|\bstatus\b|\bupdate\b/.test(
      lower
    )
  ) {
    const kw = lower.match(/\bsummary\b|\bperformance\b|\bstatus\b|\bupdate\b/)?.[0] ?? "summary";
    matchedKeywords.push(`summary-keyword:${kw}`);
    return out(
      "portfolio_overview",
      0.7,
      `Broad summary keyword "${kw}" → defaulting to portfolio_overview`
    );
  }

  // ── P5: Fallback — short greetings / generic "help me" messages ────────────
  if (/^(?:hi|hello|hey|help|start|what\s+can\s+you\s+do|what\s+do\s+you\s+(?:know|do)|show\s+me\s+(?:everything|all))\b/.test(lower)) {
    matchedKeywords.push("greeting-or-help");
    return out(
      "portfolio_overview",
      0.6,
      "Greeting/help message → defaulting to portfolio_overview as the most useful starting point",
      null,
      {}
    );
  }

  // ── P6: True fallback — no signal at all ──────────────────────────────────
  return out(
    "unsupported_or_ambiguous",
    0.25,
    "No recognisable intent pattern or entity match found",
    "I'm not sure what you're asking. I can help with: portfolio overview, individual positions, fees, distributions, obligations, valuation history, and account statement. What would you like to know?"
  );
}

// ─── Backward-compat helpers ───────────────────────────────────────────────────

/**
 * Build a set of contextual starter prompts for a given investor.
 * Based on their actual positions so the prompts are always relevant.
 */
export function buildStarterPrompts(investorId: string, db: Database): string[] {
  const prompts: string[] = ["Give me a portfolio overview"];

  const allocIds = db.allocationsByInvestor.get(investorId) ?? [];
  if (allocIds.length === 0)
    return ["I don't have any investments yet. Can you tell me how to get started?"];

  const distIds = db.distributionsByInvestor.get(investorId) ?? [];
  if (distIds.length > 0) prompts.push("Show me my distributions and exits");

  const obligations = (db.capitalCallsByInvestor.get(investorId) ?? [])
    .map((id) => db.capitalCalls.get(id)!)
    .some((c) => c?.status === "Upcoming");
  if (obligations) prompts.push("What are my upcoming obligations?");

  prompts.push("What's my account statement?");

  const firstAllocId = allocIds[0];
  if (firstAllocId) {
    const alloc = db.allocations.get(firstAllocId);
    if (alloc) {
      const deal = db.deals.get(alloc.deal_id);
      if (deal) {
        prompts.push(`Tell me about my position in ${deal.company_name}`);
      }
    }
  }

  return prompts.slice(0, 4);
}

/** All company names for this investor (useful for autocomplete/hints) */
export function getInvestorCompanyNames(investorId: string, db: Database): string[] {
  const allocIds = db.allocationsByInvestor.get(investorId) ?? [];
  const names = new Set<string>();
  for (const allocId of allocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (deal) names.add(deal.company_name);
  }
  return [...names];
}
