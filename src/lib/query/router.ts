import type { Database } from "../data/loader";
import type { IntentResult, QueryIntent } from "../domain/types";

/**
 * Deterministic intent classifier. No LLM needed here — keyword and entity
 * matching is reliable and fast, and prevents the model from routing itself
 * to a wrong data source.
 *
 * Priority: entity match (company name) > keyword patterns > default.
 */
export function classifyIntent(
  message: string,
  investorId: string,
  db: Database
): IntentResult {
  const lower = message.toLowerCase();

  // ─── Entity matching: company name mentions ────────────────────────────────
  // Build the set of company names this investor is exposed to
  const investorAllocIds = db.allocationsByInvestor.get(investorId) ?? [];
  const investorCompanies: { name: string; lowerName: string; companyId: string }[] = [];
  const seen = new Set<string>();

  for (const allocId of investorAllocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    if (seen.has(deal.company_id)) continue;
    seen.add(deal.company_id);
    const company = db.companies.get(deal.company_id);
    if (!company) continue;
    investorCompanies.push({
      name: company.company_name,
      lowerName: company.company_name.toLowerCase(),
      companyId: deal.company_id,
    });
  }

  // Score each company name against the message to avoid false partial matches.
  //
  // Scoring tiers:
  //   1.0 — full lowercase name is present in the query (exact phrase match)
  //   0.8 — all significant words (>3 chars) present, but not as exact phrase
  //   0.5 × (fraction of significant words matched) — partial word overlap
  //
  // Only the highest-scoring tier is kept. If two companies tie at the same
  // max score (e.g. "northpeak" alone matches both "Northpeak Analytics" and
  // "Northpeak Health" at 0.25 each) they are flagged as ambiguous.
  function scoreCompany(co: { lowerName: string }): number {
    if (lower.includes(co.lowerName)) return 1.0;
    const words = co.lowerName.split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) return 0;
    const matched = words.filter((w) => lower.includes(w)).length;
    if (matched === 0) return 0;
    if (matched === words.length) return 0.8;
    return (matched / words.length) * 0.5;
  }

  const scored = investorCompanies
    .map((co) => ({ co, score: scoreCompany(co) }))
    .filter(({ score }) => score > 0);

  const maxScore = scored.reduce((m, s) => Math.max(m, s.score), 0);
  const matchedCompanies = scored
    .filter(({ score }) => score === maxScore)
    .map(({ co }) => co);

  if (matchedCompanies.length === 1) {
    const matched = matchedCompanies[0];

    // Determine whether the sub-intent is fee, valuation, or position
    if (/fee|management fee|carry|performance|structuring|admin|discount/.test(lower)) {
      return { intent: "fee_detail", companyName: matched.name };
    }
    if (/valuat|history|mark|mark.?up|over.?time|trend|how.+moved/.test(lower)) {
      return { intent: "valuation_history", companyName: matched.name };
    }
    return { intent: "position_detail", companyName: matched.name };
  }

  if (matchedCompanies.length > 1) {
    // Ambiguous — prefer position_detail and surface the options
    return {
      intent: "position_detail",
      ambiguous: matchedCompanies.map((c) => c.name),
    };
  }

  // ─── Keyword patterns (checked in priority order) ──────────────────────────

  if (/statement|account.?statement|transaction|cashflow|cash.?flow/.test(lower)) {
    return { intent: "account_statement" };
  }

  if (
    /upcoming|overdue|due|obligation|capital.?call|i owe|what.*owe|next.?call/.test(lower)
  ) {
    return { intent: "obligations" };
  }

  if (
    /distribut|exit.?proceed|secondary.*sale|realised|realized|received|proceeds/.test(lower)
  ) {
    return { intent: "distributions" };
  }

  if (
    /\bfee\b|management.?fee|\bcarry\b|performance.?fee|structuring|admin.?fee|fee.?discount/.test(
      lower
    )
  ) {
    return { intent: "fee_detail", companyName: "" };
  }

  if (/valuat|mark.?history|how.+value|price.+moved/.test(lower)) {
    return { intent: "valuation_history", companyName: "" };
  }

  if (
    /overview|summary|portfolio|total|holdings|moic|performance|net.?worth|all.+deal|how.+doing/.test(
      lower
    )
  ) {
    return { intent: "portfolio_overview" };
  }

  // Default: portfolio overview
  return { intent: "portfolio_overview" };
}

/**
 * Build a set of contextual starter prompts for a given investor.
 * Based on their actual positions so the prompts are always relevant.
 */
export function buildStarterPrompts(
  investorId: string,
  db: Database
): string[] {
  const prompts: string[] = ["Give me a portfolio overview"];

  const allocIds = db.allocationsByInvestor.get(investorId) ?? [];
  if (allocIds.length === 0) return ["I don't have any investments yet. Can you tell me how to get started?"];

  const distIds = db.distributionsByInvestor.get(investorId) ?? [];
  if (distIds.length > 0) prompts.push("Show me my distributions and exits");

  const obligations = (db.capitalCallsByInvestor.get(investorId) ?? [])
    .map((id) => db.capitalCalls.get(id)!)
    .some((c) => c?.status === "Upcoming");
  if (obligations) prompts.push("What are my upcoming obligations?");

  prompts.push("What's my account statement?");

  // Add a company-specific prompt for the first company
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

/** Helper: all company names for this investor (for the query router) */
export function getInvestorCompanyNames(
  investorId: string,
  db: Database
): string[] {
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
