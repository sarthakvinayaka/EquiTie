/**
 * Individual policy guard functions.
 *
 * Each guard is a pure function: same inputs → same output, no side effects.
 * Guards are composed by the policy engine (engine.ts). They do NOT log.
 *
 * Naming convention: guard* → returns PolicyResult with allowed:true|false
 */

import type { Database } from "../data/loader";
import type { InvestorContext, PolicyResult } from "./types";

// ─── Pattern constants ─────────────────────────────────────────────────────────

/** Matches investor ID patterns like INV001, INV0023, etc. */
const INVESTOR_ID_PATTERN = /\bINV\d{3,}\b/gi;

/** Keywords that suggest the user wants data about other/all investors */
const CROSS_INVESTOR_PATTERNS = [
  /\ball investors?\b/i,
  /\bevery\s+investor\b/i,
  /\beveryone('s)?\s+(else|portfolio)\b/i,
  /\beveryone\s+else\b/i,
  /\bother\s+(investors?|clients?|portfolios?)\b/i,
  /\baverage\s+investor\b/i,
  /\bbenchmark\s+against\b/i,
  /\bcompare\s+(to|with)\s+(other|all)\b/i,
  /\baggregate\s+(across|of)\s+all\b/i,
];

/** Keywords indicating requests for live or external market data */
const EXTERNAL_DATA_PATTERNS = [
  /\b(live|real.?time|current)\s+(stock|share|price|market)\b/i,
  /\breal.?time\b.*\b(price|value|rate)\b/i,
  /\b(nasdaq|nyse|lse|bloomberg|reuters)\b/i,
  /\bmarket\s+cap(italisation)?\b/i,
  /\bstock\s+ticker\b/i,
  /\bshare\s+price\s+today\b/i,
  /\bwhat('?s|\s+is)\s+[\w\s]+'?s?\s+(stock|share)\s+price\b/i,
];

// ─── Guard functions ───────────────────────────────────────────────────────────

/**
 * G1 — Investor must exist in the dataset.
 * First gate: if the investor_id is unknown, nothing should proceed.
 */
export function guardInvestorExists(
  investorId: string,
  db: Database
): PolicyResult {
  if (!investorId || !investorId.trim()) {
    return {
      allowed: false,
      violationCode: "UNKNOWN_INVESTOR",
      safeResponse: "A valid investor account is required to use this service.",
      reason: "investorId is blank",
    };
  }

  const investor = db.investors.get(investorId);
  if (!investor) {
    return {
      allowed: false,
      violationCode: "UNKNOWN_INVESTOR",
      safeResponse: "I couldn't find your investor profile. Please contact support.",
      reason: `investor_id "${investorId}" not in dataset`,
    };
  }

  return { allowed: true };
}

/**
 * G2 — Message must not reference another investor's data.
 *
 * Catches:
 *  - Explicit other-investor IDs in the message: "tell me about INV002"
 *  - Cross-investor comparison requests: "compare to all investors"
 */
export function guardNoCrossInvestorRequest(
  message: string,
  loggedInInvestorId: string
): PolicyResult {
  // Check for explicit investor ID mentions that differ from the logged-in investor
  const matches = message.match(INVESTOR_ID_PATTERN) ?? [];
  for (const match of matches) {
    if (match.toUpperCase() !== loggedInInvestorId.toUpperCase()) {
      return {
        allowed: false,
        violationCode: "CROSS_INVESTOR_ACCESS",
        safeResponse: "I can only provide information about your own portfolio.",
        reason: `Message references investor ID "${match}" (logged in as ${loggedInInvestorId})`,
      };
    }
  }

  // Check for "all investors" / comparison patterns
  for (const pattern of CROSS_INVESTOR_PATTERNS) {
    if (pattern.test(message)) {
      return {
        allowed: false,
        violationCode: "CROSS_INVESTOR_ACCESS",
        safeResponse:
          "I can only answer questions about your own portfolio. I don't have access to other investors' data.",
        reason: `Cross-investor pattern matched: ${pattern.source}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * G3 — Message must not request real-world/external market data.
 * The assistant is grounded only in the dataset provided.
 */
export function guardNoExternalDataRequest(message: string): PolicyResult {
  for (const pattern of EXTERNAL_DATA_PATTERNS) {
    if (pattern.test(message)) {
      return {
        allowed: false,
        violationCode: "EXTERNAL_DATA_REQUEST",
        safeResponse:
          "I can only answer questions based on your EquiTie portfolio records. I don't have access to live market data or external financial information.",
        reason: `External data pattern matched: ${pattern.source}`,
      };
    }
  }
  return { allowed: true };
}

/**
 * G4 — When multiple companies matched a query, require clarification.
 * Never guess which company to use when more than one is plausible.
 */
export function guardAmbiguousEntity(
  ambiguous: string[]
): PolicyResult {
  if (ambiguous.length <= 1) return { allowed: true };

  const list = ambiguous.map((n) => `"${n}"`).join(", ");
  return {
    allowed: false,
    violationCode: "AMBIGUOUS_ENTITY",
    safeResponse: `I found multiple companies that could match your query: ${list}. Could you specify which one you mean?`,
    reason: `Ambiguous entity: ${ambiguous.join(" / ")}`,
  };
}

/**
 * G5 — A named company must be in the investor's portfolio.
 *
 * Uses case-insensitive full or partial matching (same logic as the router),
 * but requires a minimum score of 0.8 to reduce false positives.
 * Empty companyName is allowed (not all intents require one).
 */
export function guardCompanyInPortfolio(
  companyName: string,
  context: InvestorContext,
  db: Database
): PolicyResult {
  if (!companyName || !companyName.trim()) {
    return { allowed: true }; // no company specified → not applicable
  }

  const query = companyName.toLowerCase();

  for (const nameL of context.companyNamesLower) {
    // Full name match
    if (query.includes(nameL) || nameL.includes(query)) return { allowed: true };

    // All-significant-words match (mirrors router scoring)
    const words = nameL.split(/\s+/).filter((w) => w.length > 3);
    if (words.length > 0) {
      const matched = words.filter((w) => query.includes(w)).length;
      if (matched === words.length) return { allowed: true };
    }
  }

  // Look up the company name in the global registry to give better error message
  const globalMatch = db.companiesByName.get(companyName.toLowerCase());
  if (globalMatch) {
    // Company exists in our dataset but not in this investor's portfolio
    return {
      allowed: false,
      violationCode: "COMPANY_NOT_IN_PORTFOLIO",
      safeResponse: `I can only show information about companies in your portfolio. "${companyName}" is not one of your current positions.`,
      reason: `Company "${companyName}" exists in dataset but not in investor ${context.investorId}'s allocations`,
    };
  }

  return {
    allowed: false,
    violationCode: "COMPANY_NOT_IN_PORTFOLIO",
    safeResponse: `I don't recognise "${companyName}" as a company in your portfolio. Try asking for your portfolio overview to see your current positions.`,
    reason: `Company "${companyName}" not found for investor ${context.investorId}`,
  };
}

/**
 * G6 — Evidence rows in a domain answer must all belong to the investor.
 *
 * This is a post-computation integrity check. If any evidence item references
 * a row that belongs to a different investor (should never happen, but
 * checked defensively), the answer is blocked.
 */
export function guardEvidenceIntegrity(
  investorId: string,
  evidenceIds: string[],
  db: Database
): PolicyResult {
  for (const id of evidenceIds) {
    const raw = db.rawRows.get(id);
    if (!raw) continue;
    const rowInvestorId = raw["investor_id"];
    if (rowInvestorId && rowInvestorId !== investorId) {
      return {
        allowed: false,
        violationCode: "CROSS_INVESTOR_ACCESS",
        safeResponse: "An internal error occurred. Please try again.",
        reason: `Evidence row ${id} belongs to investor ${rowInvestorId}, not ${investorId}`,
      };
    }
  }
  return { allowed: true };
}
