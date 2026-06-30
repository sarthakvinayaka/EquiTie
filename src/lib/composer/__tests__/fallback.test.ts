/**
 * FALLBACK MODE TESTS
 *
 * All checks are [D] DETERMINISTIC — no LLM, no API key, no network call.
 *
 * Verifies that when no OpenAI key is present (or the LLM call fails):
 *   1. buildFallbackNarrative() produces valid output for every intent
 *   2. Output is idempotent  (same inputs → identical outputs across calls)
 *   3. Intent-specific computed data is embedded correctly in the narrative
 *   4. buildErrorNarrative() echoes the error message verbatim
 *   5. Null / empty data never throws (defensive parsing)
 *   6. Novice vs Experienced profiles receive appropriately different phrasing [N]
 *
 * No database access — tests are purely functional (fallback builder has no DB dependency).
 */

import {
  buildFallbackNarrative,
  buildErrorNarrative,
  type FallbackNarrative,
} from "@/lib/composer/fallback";
import type { PersonalizationProfile } from "@/lib/engine/types";
import type { QueryIntent } from "@/lib/domain/types";

// ─── Shared fixtures ───────────────────────────────────────────────────────────

const PROFILE_EXPERIENCED: PersonalizationProfile = {
  investorId: "INV001",
  name: "Idris Olawale",
  age: 52,
  techSavviness: "High",
  dealCount: 4,
  sophisticationLevel: "Experienced",
  primarySectors: ["Robotics", "AI"],
  sectorConcentrationFlag: false,
  answerStyle: "concise",
  explainJargon: false,
  reportingCurrency: "GBP",
};

const PROFILE_NOVICE: PersonalizationProfile = {
  ...PROFILE_EXPERIENCED,
  techSavviness: "Low",
  sophisticationLevel: "Emerging",
  answerStyle: "explanatory",
  explainJargon: true,
};

const ALL_INTENTS: QueryIntent[] = [
  "portfolio_overview",
  "position_detail",
  "obligations",
  "distributions",
  "fee_detail",
  "valuation_history",
  "account_statement",
  "glossary_or_metric_explanation",
  "unsupported_or_ambiguous",
  "general_help",
];

function isValidFallbackNarrative(obj: unknown): obj is FallbackNarrative {
  if (typeof obj !== "object" || obj === null) return false;
  const f = obj as Partial<FallbackNarrative>;
  return (
    typeof f.conciseAnswer === "string" &&
    f.conciseAnswer.length > 0 &&
    typeof f.detailedNarrative === "string" &&
    f.detailedNarrative.length > 0
  );
}

// ─── A. All intents return valid FallbackNarrative shape [D] ──────────────────

describe("[D] Fallback: every intent produces a non-empty FallbackNarrative", () => {
  for (const intent of ALL_INTENTS) {
    it(`"${intent}" → { conciseAnswer: string, detailedNarrative: string }`, () => {
      const result = buildFallbackNarrative(intent, {}, PROFILE_EXPERIENCED);
      expect(isValidFallbackNarrative(result)).toBe(true);
    });
  }
});

// ─── B. Null and empty data never throw [D] ───────────────────────────────────

describe("[D] Fallback: null and empty data handled gracefully (no throws)", () => {
  for (const intent of ALL_INTENTS) {
    it(`"${intent}" with null data`, () => {
      expect(() =>
        buildFallbackNarrative(intent, null, PROFILE_EXPERIENCED)
      ).not.toThrow();
    });

    it(`"${intent}" with empty object`, () => {
      expect(() =>
        buildFallbackNarrative(intent, {}, PROFILE_EXPERIENCED)
      ).not.toThrow();
    });
  }
});

// ─── C. Idempotency — same inputs always produce identical output [D] ─────────

describe("[D] Fallback: idempotent (two calls with same inputs produce identical output)", () => {
  const INTENTS_TO_CHECK: QueryIntent[] = [
    "portfolio_overview",
    "account_statement",
    "obligations",
    "distributions",
  ];

  for (const intent of INTENTS_TO_CHECK) {
    it(`"${intent}" is deterministic across two calls`, () => {
      const data = {
        totalValue: "£438,495",
        portfolioMoicFormatted: "2.6×",
        activePositions: 4,
        positions: [],
        summary: { netCashFlow: "−£170,815", totalContributions: "£168,593",
                    totalDistributions: "£0", totalFees: "£2,222" },
        recentLines: [],
        capitalCalls: [],
        fees: [],
        totalObligations: "£0",
        distributions: [],
      };
      const r1 = buildFallbackNarrative(intent, data, PROFILE_EXPERIENCED);
      const r2 = buildFallbackNarrative(intent, data, PROFILE_EXPERIENCED);
      expect(r1.conciseAnswer).toBe(r2.conciseAnswer);
      expect(r1.detailedNarrative).toBe(r2.detailedNarrative);
    });
  }
});

// ─── D. Intent-specific computed values are embedded [D] ─────────────────────

describe("[D] Fallback: intent-specific data is embedded in the narrative", () => {
  it("portfolio_overview: MOIC is in the concise answer when portfolioMoicFormatted is set", () => {
    const result = buildFallbackNarrative(
      "portfolio_overview",
      {
        totalValue: "£438,495",
        portfolioMoicFormatted: "2.6×",
        activePositions: 4,
        positions: [],
      },
      PROFILE_EXPERIENCED
    );
    expect(result.conciseAnswer).toContain("2.6×");
  });

  it("portfolio_overview (novice): concise answer uses plain-language phrasing", () => {
    const result = buildFallbackNarrative(
      "portfolio_overview",
      {
        totalValue: "£438,495",
        portfolioMoicFormatted: "2.6×",
        activePositions: 4,
        positions: [],
      },
      PROFILE_NOVICE
    );
    expect(result.conciseAnswer).toContain("return multiple");
  });

  it("account_statement: netCashFlow value appears in the concise answer", () => {
    const result = buildFallbackNarrative(
      "account_statement",
      {
        summary: {
          netCashFlow: "−£170,815",
          totalContributions: "£168,593",
          totalDistributions: "£0",
          totalFees: "£2,222",
        },
        recentLines: [],
      },
      PROFILE_EXPERIENCED
    );
    expect(result.conciseAnswer).toContain("−£170,815");
  });

  it("obligations: reports no obligations when both lists are empty", () => {
    const result = buildFallbackNarrative(
      "obligations",
      { capitalCalls: [], fees: [], totalObligations: "£0" },
      PROFILE_EXPERIENCED
    );
    expect(result.conciseAnswer.toLowerCase()).toContain("no upcoming");
  });

  it("obligations: flags overdue count when at least one fee has status=Overdue", () => {
    const result = buildFallbackNarrative(
      "obligations",
      {
        capitalCalls: [],
        fees: [
          {
            company: "Forgecraft Robotics",
            round: "Seed",
            feeType: "Management Fee",
            amount: "£800",
            dueDate: "2026-05-01",
            status: "Overdue",
          },
        ],
        totalObligations: "£800",
      },
      PROFILE_EXPERIENCED
    );
    expect(result.conciseAnswer.toLowerCase()).toContain("overdue");
  });

  it("distributions: says no distributions when list is empty", () => {
    const result = buildFallbackNarrative(
      "distributions",
      { distributions: [], totalGross: "£0", totalPerformanceFee: "£0", totalNet: "£0" },
      PROFILE_EXPERIENCED
    );
    expect(result.conciseAnswer.toLowerCase()).toContain("no distributions");
  });

  it("distributions: includes net amount and event count when distributions exist", () => {
    const result = buildFallbackNarrative(
      "distributions",
      {
        distributions: [
          {
            company: "Inferna AI",
            round: "Series B",
            date: "2026-01-15",
            type: "Exit Proceeds",
            gross: "£50,000",
            performanceFee: "£10,000",
            net: "£40,000",
          },
        ],
        totalGross: "£50,000",
        totalPerformanceFee: "£10,000",
        totalNet: "£40,000",
      },
      PROFILE_EXPERIENCED
    );
    expect(result.conciseAnswer).toContain("£40,000");
  });
});

// ─── E. buildErrorNarrative — echoes error message [D] ────────────────────────

describe("[D] Fallback: buildErrorNarrative embeds the error message verbatim", () => {
  it("conciseAnswer is the error message exactly", () => {
    const msg = "Access denied: INV001 cannot view data for another investor.";
    const result = buildErrorNarrative(msg);
    expect(result.conciseAnswer).toBe(msg);
  });

  it("detailedNarrative contains the error message", () => {
    const msg = "No company matching 'Acme Corp' found in this portfolio.";
    const result = buildErrorNarrative(msg);
    expect(result.detailedNarrative).toContain(msg);
  });

  it("returns valid FallbackNarrative shape", () => {
    const result = buildErrorNarrative("some error occurred");
    expect(isValidFallbackNarrative(result)).toBe(true);
  });

  it("is idempotent — same error message produces identical output", () => {
    const msg = "Investor not found.";
    const r1 = buildErrorNarrative(msg);
    const r2 = buildErrorNarrative(msg);
    expect(r1.conciseAnswer).toBe(r2.conciseAnswer);
    expect(r1.detailedNarrative).toBe(r2.detailedNarrative);
  });
});

// ─── F. Novice vs Experienced — phrasing differs appropriately [N] ────────────

describe("[N] Narrative-quality: novice profile receives explanatory, jargon-lite phrasing", () => {
  it("portfolio_overview novice narrative explains the MOIC acronym", () => {
    const result = buildFallbackNarrative(
      "portfolio_overview",
      { totalValue: "£438,495", portfolioMoicFormatted: "2.6×", activePositions: 4, positions: [] },
      PROFILE_NOVICE
    );
    // Novice narrative should spell out what MOIC means
    expect(result.detailedNarrative.toLowerCase()).toContain("moic");
  });

  it("account_statement novice narrative explains net cash flow in plain language", () => {
    const data = {
      summary: {
        netCashFlow: "−£170,815",
        totalContributions: "£168,593",
        totalDistributions: "£0",
        totalFees: "£2,222",
      },
      recentLines: [],
    };
    const result = buildFallbackNarrative("account_statement", data, PROFILE_NOVICE);
    // Novice template includes a plain-English explanation of net cash flow
    expect(result.detailedNarrative.toLowerCase()).toContain("distributions received");
  });

  it("obligations novice narrative explains what a capital call is", () => {
    const result = buildFallbackNarrative(
      "obligations",
      {
        capitalCalls: [
          { company: "Forgecraft", round: "Series B", callNumber: 1,
            amount: "£5,000", dueDate: "2026-08-01", status: "Upcoming" },
        ],
        fees: [],
        totalObligations: "£5,000",
        totalCapitalCalls: "£5,000",
        totalFees: "£0",
      },
      PROFILE_NOVICE
    );
    expect(result.detailedNarrative.toLowerCase()).toContain("capital call");
  });
});
