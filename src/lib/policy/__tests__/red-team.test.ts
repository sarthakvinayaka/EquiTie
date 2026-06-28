/**
 * Red-team / adversarial policy tests.
 *
 * These tests simulate attempts by a malicious or confused user to extract
 * data they should not have access to. Every test should assert that the
 * policy engine blocks the attempt and returns a safe response.
 *
 * Scenarios covered:
 *  - Injection-style investor IDs in the request
 *  - Prompts that reference another investor's ID
 *  - "All investors" style aggregation requests
 *  - Requests for live market / external data
 *  - Ambiguous company name prompts
 *  - Company names from another investor's portfolio
 */

import { getDatabase } from "@/lib/data/loader";
import { resolveInvestorContext } from "@/lib/policy/context";
import {
  guardInvestorExists,
  guardNoCrossInvestorRequest,
  guardNoExternalDataRequest,
  guardAmbiguousEntity,
  guardCompanyInPortfolio,
} from "@/lib/policy/guards";
import { runPolicyChecks } from "@/lib/policy/engine";

// ─── Setup ─────────────────────────────────────────────────────────────────────

let INV_A: string;
let INV_B: string;

beforeAll(() => {
  const db = getDatabase();
  const sorted = [...db.investors.keys()].sort();
  if (sorted.length < 2) throw new Error("Need at least 2 investors in dataset");
  INV_A = sorted[0];
  INV_B = sorted[1];
});

// ─── Injection-style investor ID attacks ──────────────────────────────────────

describe("injection-style investor IDs", () => {
  const injectionIds = [
    "' OR '1'='1",
    "'; DROP TABLE investors; --",
    `${""} OR 1=1`,
    "<script>alert(1)</script>",
    "INV001' OR 'a'='a",
    "../../../etc/passwd",
    "null",
    "undefined",
    "0",
    " ",
    "\t",
  ];

  test.each(injectionIds)(
    'investor ID "%s" is rejected by guardInvestorExists',
    (badId) => {
      const db = getDatabase();
      const result = guardInvestorExists(badId, db);
      expect(result.allowed).toBe(false);
      expect(result.violationCode).toBe("UNKNOWN_INVESTOR");
    }
  );

  test.each(injectionIds)(
    'investor ID "%s" is rejected by runPolicyChecks',
    (badId) => {
      const db = getDatabase();
      const result = runPolicyChecks(badId, "Show me my portfolio", db);
      expect(result.allowed).toBe(false);
      expect(result.violationCode).toBe("UNKNOWN_INVESTOR");
      // Safe response must not contain the injected string
      expect(result.safeResponse).not.toContain("DROP");
      expect(result.safeResponse).not.toContain("<script>");
    }
  );
});

// ─── Cross-investor ID in message ─────────────────────────────────────────────

describe("cross-investor ID mentions in message", () => {
  it("blocks a message referencing another investor ID explicitly", () => {
    const result = guardNoCrossInvestorRequest(
      `What is ${INV_B}'s total portfolio value?`,
      INV_A
    );
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("CROSS_INVESTOR_ACCESS");
  });

  it("blocks 'show me INV002 portfolio' when logged in as INV001", () => {
    const result = guardNoCrossInvestorRequest(
      "Show me INV002 portfolio overview",
      "INV001"
    );
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("CROSS_INVESTOR_ACCESS");
  });

  it("allows a message that mentions only the logged-in investor ID", () => {
    const result = guardNoCrossInvestorRequest(
      `Give me a summary for ${INV_A}`,
      INV_A
    );
    expect(result.allowed).toBe(true);
  });

  it("allows a normal portfolio question with no investor ID", () => {
    const result = guardNoCrossInvestorRequest(
      "What are my upcoming capital calls?",
      INV_A
    );
    expect(result.allowed).toBe(true);
  });

  it("safe response does not reveal the other investor's ID", () => {
    const result = guardNoCrossInvestorRequest(
      `Tell me about ${INV_B}'s fees`,
      INV_A
    );
    expect(result.safeResponse).not.toContain(INV_B);
  });
});

// ─── "All investors" aggregation attacks ──────────────────────────────────────

describe("cross-investor aggregation prompts", () => {
  const crossInvestorMessages = [
    "Show me all investors' portfolios",
    "What is the average investor return?",
    "Compare my portfolio against all other investors",
    "How does my MOIC compare to everyone else?",
    "Give me aggregate data across all investors",
    "What are other clients invested in?",
    "Show me every investor's fee structure",
    "How do other investors' portfolios look?",
  ];

  test.each(crossInvestorMessages)(
    'message "%s" is blocked as cross-investor',
    (message) => {
      const result = guardNoCrossInvestorRequest(message, INV_A);
      expect(result.allowed).toBe(false);
      expect(result.violationCode).toBe("CROSS_INVESTOR_ACCESS");
    }
  );
});

// ─── External / real-world data requests ──────────────────────────────────────

describe("external data request detection", () => {
  const externalMessages = [
    "What is Apple's current stock price?",
    "Show me the live NASDAQ index",
    "What's the real-time share price of Tesla?",
    "Check Bloomberg for the latest valuation",
    "What is the NYSE closing price today?",
    "Give me the stock ticker for my companies",
    "What's the market cap of Forgecraft today?",
  ];

  test.each(externalMessages)(
    'message "%s" is blocked as external data request',
    (message) => {
      const result = guardNoExternalDataRequest(message);
      expect(result.allowed).toBe(false);
      expect(result.violationCode).toBe("EXTERNAL_DATA_REQUEST");
      expect(result.safeResponse).toBeTruthy();
    }
  );

  it("does not block a normal portfolio question", () => {
    const result = guardNoExternalDataRequest(
      "What is the current value of my Forgecraft position?"
    );
    expect(result.allowed).toBe(true);
  });

  it("does not block a valuation history question", () => {
    const result = guardNoExternalDataRequest(
      "Show me the valuation history for my Tallybook position"
    );
    expect(result.allowed).toBe(true);
  });
});

// ─── Ambiguous entity attacks ──────────────────────────────────────────────────

describe("ambiguous entity guard", () => {
  it("blocks when two companies match", () => {
    const result = guardAmbiguousEntity(["Northpeak Analytics", "Northpeak Health"]);
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("AMBIGUOUS_ENTITY");
    expect(result.safeResponse).toContain("Northpeak Analytics");
    expect(result.safeResponse).toContain("Northpeak Health");
  });

  it("blocks when three companies match", () => {
    const result = guardAmbiguousEntity(["Alpha Fund", "Beta Capital", "Gamma Tech"]);
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("AMBIGUOUS_ENTITY");
  });

  it("allows when exactly one company matches", () => {
    const result = guardAmbiguousEntity(["Northpeak Analytics"]);
    expect(result.allowed).toBe(true);
  });

  it("allows when list is empty (no match at all — handled upstream)", () => {
    const result = guardAmbiguousEntity([]);
    expect(result.allowed).toBe(true);
  });

  it("safe response does not include any investor IDs", () => {
    const result = guardAmbiguousEntity(["Northpeak Analytics", "Northpeak Health"]);
    // The safe response should only list company names, not investor data
    expect(result.safeResponse).not.toMatch(/INV\d+/);
  });
});

// ─── Company from another investor's portfolio ────────────────────────────────

describe("cross-investor company access via guardCompanyInPortfolio", () => {
  it("blocks access to a company exclusively in INV_B's portfolio", () => {
    const db = getDatabase();
    const ctxA = resolveInvestorContext(INV_A, db)!;
    const ctxB = resolveInvestorContext(INV_B, db)!;

    // Find a company name that INV_B has but INV_A doesn't
    const exclusiveToB = [...ctxB.companyNamesLower].find(
      (n) => !ctxA.companyNamesLower.has(n)
    );

    if (!exclusiveToB) {
      // Both investors share all companies — this test is N/A for this dataset pair
      return;
    }

    const result = guardCompanyInPortfolio(exclusiveToB, ctxA, db);
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("COMPANY_NOT_IN_PORTFOLIO");
    // Safe response must not reveal the actual company data
    expect(result.safeResponse).not.toContain("allocation");
    expect(result.safeResponse).not.toContain("MOIC");
  });

  it("safe response for company-not-in-portfolio does not reveal portfolio contents", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const result = guardCompanyInPortfolio("Fake Company That Does Not Exist", ctx, db);

    if (!result.allowed) {
      // The safe response should guide the user but not enumerate their companies
      expect(result.safeResponse).toBeTruthy();
      expect(result.safeResponse).not.toMatch(/INV\d+/);
    }
  });
});

// ─── Full engine: runPolicyChecks end-to-end ──────────────────────────────────

describe("runPolicyChecks — full engine (cross-investor blocked before data access)", () => {
  it("blocks a request for a different investor before any context is resolved", () => {
    const db = getDatabase();
    // INV_A is logged in, but message explicitly asks about INV_B
    const result = runPolicyChecks(
      INV_A,
      `Tell me everything about investor ${INV_B}`,
      db
    );
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("CROSS_INVESTOR_ACCESS");
    // investorContext must NOT be populated for a denied request
    expect(result.investorContext).toBeUndefined();
  });

  it("allows a normal portfolio question for a known investor", () => {
    const db = getDatabase();
    const result = runPolicyChecks(INV_A, "Give me my portfolio overview", db);
    expect(result.allowed).toBe(true);
    // investorContext MUST be populated when allowed
    expect(result.investorContext).toBeDefined();
    expect(result.investorContext!.investorId).toBe(INV_A);
  });

  it("does not populate investorContext when investor is unknown", () => {
    const db = getDatabase();
    const result = runPolicyChecks("NONEXISTENT_ID", "My portfolio", db);
    expect(result.allowed).toBe(false);
    expect(result.investorContext).toBeUndefined();
  });

  it("blocked responses always have a non-empty safeResponse", () => {
    const db = getDatabase();
    const badCases: [string, string][] = [
      ["FAKE_ID", "Portfolio overview"],
      [INV_A, `What does ${INV_B} invest in?`],
      [INV_A, "What is Apple's current stock price?"],
      [INV_A, "Show me all investors' returns"],
    ];

    for (const [investorId, message] of badCases) {
      const result = runPolicyChecks(investorId, message, db);
      expect(result.allowed).toBe(false);
      expect(result.safeResponse).toBeTruthy();
      expect(result.safeResponse!.length).toBeGreaterThan(10);
    }
  });
});
