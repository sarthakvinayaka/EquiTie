/**
 * Router test suite — 30 realistic investor questions.
 *
 * Covers:
 *  - All 9 supported intents
 *  - Confidence thresholds
 *  - Entity extraction (company, round, metric/term, date range)
 *  - Ambiguity detection
 *  - Unsupported / out-of-scope topics
 *  - "What is my X" vs "What is X" disambiguation
 */

import { getDatabase } from "@/lib/data/loader";
import { classifyIntent } from "@/lib/query/router";
import type { RouterOutput, QueryIntent } from "@/lib/domain/types";

// ─── Setup ────────────────────────────────────────────────────────────────────

let db: ReturnType<typeof getDatabase>;
let investorId: string;
let companyName1: string; // first company this investor holds
let companyName2: string; // second company (if available)

beforeAll(() => {
  db = getDatabase();

  // Pick an investor with at least 2 allocations
  const found = [...db.investors.values()].find((inv) => {
    const allocs = db.allocationsByInvestor.get(inv.investor_id) ?? [];
    return allocs.length >= 2;
  });
  if (!found) throw new Error("No investor with ≥2 allocations in dataset");
  investorId = found.investor_id;

  // Resolve company names for this investor
  const allocIds = db.allocationsByInvestor.get(investorId)!;
  const names: string[] = [];
  const seenCompanyIds = new Set<string>();
  for (const allocId of allocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    if (seenCompanyIds.has(deal.company_id)) continue;
    seenCompanyIds.add(deal.company_id);
    const company = db.companies.get(deal.company_id);
    if (company) names.push(company.company_name);
    if (names.length >= 2) break;
  }
  if (names.length < 1) throw new Error("Investor has no company names");
  companyName1 = names[0];
  companyName2 = names[1] ?? names[0];
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function route(message: string): RouterOutput {
  return classifyIntent(message, investorId, db);
}

function expectIntent(result: RouterOutput, intent: QueryIntent) {
  expect(result.intent).toBe(intent);
}

function expectMinConfidence(result: RouterOutput, min: number) {
  expect(result.confidence).toBeGreaterThanOrEqual(min);
}

function expectEntity(result: RouterOutput, key: keyof RouterOutput["entities"], value: unknown) {
  expect(result.entities[key]).toEqual(value);
}

// ═══════════════════════════════════════════════════════════════════════════════
// A — Portfolio overview (6 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("portfolio_overview", () => {
  test("A1 — explicit overview request", () => {
    const r = route("Give me a portfolio overview");
    expectIntent(r, "portfolio_overview");
    expectMinConfidence(r, 0.7);
    expect(r.backendFunction).toBe("getInvestorPortfolioOverview");
  });

  test("A2 — 'how is my portfolio doing'", () => {
    const r = route("How is my portfolio doing right now?");
    expectIntent(r, "portfolio_overview");
    expectMinConfidence(r, 0.7);
  });

  test("A3 — 'my MOIC' (possessive → data, not glossary)", () => {
    const r = route("What's my total MOIC?");
    expectIntent(r, "portfolio_overview");
    expectMinConfidence(r, 0.7);
    expect(r.intent).not.toBe("glossary_or_metric_explanation");
  });

  test("A4 — show all holdings", () => {
    const r = route("Show me all my holdings");
    expectIntent(r, "portfolio_overview");
    expectMinConfidence(r, 0.7);
  });

  test("A5 — total value", () => {
    const r = route("What is my total portfolio value?");
    expectIntent(r, "portfolio_overview");
    expectMinConfidence(r, 0.7);
  });

  test("A6 — greeting routes to overview", () => {
    const r = route("Hi, can you help me?");
    expectIntent(r, "portfolio_overview");
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B — Position detail (4 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("position_detail", () => {
  test("B1 — full company name → position_detail", () => {
    const r = route(`Tell me about my position in ${companyName1}`);
    expectIntent(r, "position_detail");
    expectMinConfidence(r, 0.75);
    expect(r.entities.companyName).toBe(companyName1);
  });

  test("B2 — 'what did I pay for [company]' → position_detail", () => {
    const r = route(`What did I pay for ${companyName1}?`);
    expectIntent(r, "position_detail");
    expect(r.entities.companyName).toBe(companyName1);
    expect(r.backendFunction).toBe("getPositionDetail");
  });

  test("B3 — company name without sub-intent keyword defaults to position_detail", () => {
    const r = route(`Show me ${companyName1}`);
    expectIntent(r, "position_detail");
    expect(r.entities.companyName).toBe(companyName1);
  });

  test("B4 — 'what did I pay for Series A' without company → low confidence + clarification", () => {
    const r = route("What did I pay for Series A?");
    expectIntent(r, "position_detail");
    expect(r.confidence).toBeLessThan(0.8);
    expect(r.clarificationPrompt).not.toBeNull();
    expect(r.entities.round).toMatch(/series\s+a/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C — Obligations (3 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("obligations", () => {
  test("C1 — upcoming obligations", () => {
    const r = route("What are my upcoming obligations?");
    expectIntent(r, "obligations");
    expectMinConfidence(r, 0.8);
    expect(r.backendFunction).toBe("getInvestorUpcomingObligations");
  });

  test("C2 — capital calls", () => {
    const r = route("Are there any capital calls coming up?");
    expectIntent(r, "obligations");
    expectMinConfidence(r, 0.8);
  });

  test("C3 — 'do I owe anything' / overdue", () => {
    const r = route("Am I overdue on any capital calls or fees?");
    expectIntent(r, "obligations");
    expectMinConfidence(r, 0.8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D — Distributions (3 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("distributions", () => {
  test("D1 — distributions received", () => {
    const r = route("What distributions have I received?");
    expectIntent(r, "distributions");
    expectMinConfidence(r, 0.8);
    expect(r.backendFunction).toBe("getInvestorDistributions");
  });

  test("D2 — exit proceeds", () => {
    const r = route("Show me my exit proceeds");
    expectIntent(r, "distributions");
    expectMinConfidence(r, 0.8);
  });

  test("D3 — 'what have I actually received'", () => {
    const r = route("What have I actually received from this portfolio after carry?");
    expectIntent(r, "distributions");
    expectMinConfidence(r, 0.7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E — Fee detail (4 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("fee_detail", () => {
  test("E1 — general fee question (no company)", () => {
    const r = route("What fees am I paying overall?");
    expectIntent(r, "fee_detail");
    expectMinConfidence(r, 0.8);
    expect(r.backendFunction).toBe("getInvestorFeeBreakdown");
    expect(r.entities.companyName).toBeNull();
  });

  test("E2 — fee discount question", () => {
    const r = route("Do I have any fee discounts?");
    expectIntent(r, "fee_detail");
    expectMinConfidence(r, 0.8);
  });

  test("E3 — company-specific fee", () => {
    const r = route(`What fees am I paying on ${companyName1}?`);
    expectIntent(r, "fee_detail");
    expect(r.entities.companyName).toBe(companyName1);
    expectMinConfidence(r, 0.85);
  });

  test("E4 — management fee question", () => {
    const r = route("What is my management fee?");
    expectIntent(r, "fee_detail");
    expectMinConfidence(r, 0.8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F — Valuation history (4 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("valuation_history", () => {
  test("F1 — company valuation history", () => {
    const r = route(`Show me the valuation history for ${companyName1}`);
    expectIntent(r, "valuation_history");
    expect(r.entities.companyName).toBe(companyName1);
    expectMinConfidence(r, 0.85);
    expect(r.backendFunction).toBe("getInvestorValuationTimeline");
  });

  test("F2 — 'has any company had a down round'", () => {
    const r = route("Has any company in my portfolio had a down round?");
    expectIntent(r, "valuation_history");
    expectMinConfidence(r, 0.75);
  });

  test("F3 — share price query", () => {
    const r = route(`What is the latest share price for ${companyName1}?`);
    expectIntent(r, "valuation_history");
    expect(r.entities.companyName).toBe(companyName1);
  });

  test("F4 — all valuations (no company)", () => {
    const r = route("Show me all valuation marks across my portfolio");
    expectIntent(r, "valuation_history");
    expectMinConfidence(r, 0.75);
    expect(r.entities.companyName).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// G — Account statement (2 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("account_statement", () => {
  test("G1 — account statement", () => {
    const r = route("What's my account statement?");
    expectIntent(r, "account_statement");
    expectMinConfidence(r, 0.8);
    expect(r.backendFunction).toBe("getInvestorStatementSummary");
  });

  test("G2 — transactions", () => {
    const r = route("Show me my recent transactions");
    expectIntent(r, "account_statement");
    expectMinConfidence(r, 0.8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// H — Glossary / metric explanation (6 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("glossary_or_metric_explanation", () => {
  test("H1 — 'what is MOIC' (no possessive)", () => {
    const r = route("What is MOIC?");
    expectIntent(r, "glossary_or_metric_explanation");
    expectMinConfidence(r, 0.85);
    expect(r.backendFunction).toBe("(no backend — LLM explains the term)");
    expect(r.entities.metricOrTerm).toMatch(/moic/i);
  });

  test("H2 — 'explain carry to me'", () => {
    const r = route("Can you explain carry to me?");
    expectIntent(r, "glossary_or_metric_explanation");
    expectMinConfidence(r, 0.85);
  });

  test("H3 — 'what does IRR stand for'", () => {
    const r = route("What does IRR stand for?");
    expectIntent(r, "glossary_or_metric_explanation");
    expectMinConfidence(r, 0.85);
  });

  test("H4 — 'difference between DPI and TVPI'", () => {
    const r = route("What is the difference between DPI and TVPI?");
    expectIntent(r, "glossary_or_metric_explanation");
    expectMinConfidence(r, 0.85);
  });

  test("H5 — 'how is MOIC calculated' → glossary", () => {
    const r = route("How is MOIC calculated?");
    expectIntent(r, "glossary_or_metric_explanation");
    expectMinConfidence(r, 0.85);
  });

  test("H6 — possessive DOES NOT trigger glossary ('my MOIC')", () => {
    const r = route("What is my MOIC?");
    expect(r.intent).not.toBe("glossary_or_metric_explanation");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// I — Unsupported / out-of-scope (3 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("unsupported_or_ambiguous", () => {
  test("I1 — weather question", () => {
    const r = route("What's the weather like in London today?");
    expectIntent(r, "unsupported_or_ambiguous");
    expect(r.confidence).toBeLessThan(0.4);
    expect(r.clarificationPrompt).not.toBeNull();
  });

  test("I2 — flight booking", () => {
    const r = route("Book me a flight to New York");
    expectIntent(r, "unsupported_or_ambiguous");
    expect(r.confidence).toBeLessThan(0.4);
  });

  test("I3 — completely unrecognised message", () => {
    const r = route("xkcd 1234 please");
    expectIntent(r, "unsupported_or_ambiguous");
    expect(r.clarificationPrompt).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// J — Ambiguity (1 dynamic + 1 structural test)
// ═══════════════════════════════════════════════════════════════════════════════

describe("ambiguity", () => {
  test("J1 — ambiguous company name returns unsupported_or_ambiguous with clarification", () => {
    // Find two companies that share a significant word in this investor's portfolio
    const allocIds = db.allocationsByInvestor.get(investorId) ?? [];
    const seenIds = new Set<string>();
    const names: string[] = [];
    for (const allocId of allocIds) {
      const alloc = db.allocations.get(allocId);
      if (!alloc) continue;
      const deal = db.deals.get(alloc.deal_id);
      if (!deal || seenIds.has(deal.company_id)) continue;
      seenIds.add(deal.company_id);
      const co = db.companies.get(deal.company_id);
      if (co) names.push(co.company_name);
    }

    // If we find two companies sharing a word (4+ chars), test it
    let sharedWord: string | null = null;
    let ambigPair: [string, string] | null = null;
    outer: for (let i = 0; i < names.length; i++) {
      const wordsA = names[i].toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      for (let j = i + 1; j < names.length; j++) {
        const wordsB = names[j].toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const common = wordsA.find((w) => wordsB.includes(w));
        if (common) {
          sharedWord = common;
          ambigPair = [names[i], names[j]];
          break outer;
        }
      }
    }

    if (sharedWord && ambigPair) {
      const r = route(sharedWord);
      expect(r.intent).toBe("unsupported_or_ambiguous");
      expect(r.entities.ambiguousCompanies).not.toBeNull();
      expect(r.entities.ambiguousCompanies!.length).toBeGreaterThan(1);
      expect(r.clarificationPrompt).not.toBeNull();
    } else {
      // Dataset has no shared-word companies for this investor — skip gracefully
      console.log("J1: no shared-word company pair found for", investorId, "— test vacuously passes");
    }
  });

  test("J2 — ambiguous result sets entities.ambiguousCompanies (structural)", () => {
    // For any ambiguous output the structure must be well-formed
    const result = classifyIntent("northpeak", investorId, db);
    if (result.intent === "unsupported_or_ambiguous" && result.entities.ambiguousCompanies) {
      expect(Array.isArray(result.entities.ambiguousCompanies)).toBe(true);
      expect(result.clarificationPrompt).toContain("Did you mean");
    }
    // If northpeak is not in this investor's portfolio, just check defaults
    expect(result.backendFunction).toBeDefined();
    expect(result.reasoning).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// K — Entity extraction (4 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("entity extraction", () => {
  test("K1 — round extracted from message", () => {
    const r = route(`Show me my Series A position in ${companyName1}`);
    expect(r.entities.round).toMatch(/series\s+a/i);
  });

  test("K2 — metricOrTerm extracted for glossary", () => {
    const r = route("What is MOIC?");
    expect(r.entities.metricOrTerm).toMatch(/moic/i);
  });

  test("K3 — dateRange extracted from year mention", () => {
    const r = route("Show me my transactions from 2024");
    expect(r.entities.dateRange).not.toBeNull();
    expect(r.entities.dateRange?.from).toBe("2024");
  });

  test("K4 — companyName + companyId populated when company resolved", () => {
    const r = route(`Tell me about ${companyName1}`);
    expect(r.entities.companyName).toBe(companyName1);
    expect(r.entities.companyId).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L — Router output structure invariants (always-valid)
// ═══════════════════════════════════════════════════════════════════════════════

describe("structural invariants", () => {
  const queries = [
    "Give me a portfolio overview",
    "Tell me about my fees",
    "What is carry?",
    "Book a flight",
    "What transactions happened last year?",
    "How is MOIC calculated?",
  ];

  for (const q of queries) {
    test(`invariant: "${q.slice(0, 40)}" always returns valid RouterOutput shape`, () => {
      const r = classifyIntent(q, investorId, db);
      expect(r.intent).toBeTruthy();
      expect(typeof r.confidence).toBe("number");
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(r.entities).toBeDefined();
      expect(r.backendFunction).toBeTruthy();
      expect(typeof r.reasoning).toBe("string");
      expect(Array.isArray(r.matchedKeywords)).toBe(true);
    });
  }

  test("confidence is always 0.0–1.0", () => {
    const msgs = [
      "hello",
      "xyzzy foo bar",
      `show me ${companyName1}`,
      "what is IRR?",
      "weather today",
      "What are my capital calls?",
    ];
    for (const m of msgs) {
      const r = route(m);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});
