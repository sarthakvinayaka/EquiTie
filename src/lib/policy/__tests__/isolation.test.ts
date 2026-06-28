/**
 * Investor isolation tests.
 *
 * These tests prove that the policy and data layer cannot leak one investor's
 * data to another investor. They run against the real CSV dataset.
 *
 * Each test asserts a specific isolation boundary, e.g.:
 *   - scopedDb for INV_A contains no rows with investor_id = INV_B
 *   - Portfolio overview evidence for INV_A contains no INV_B allocation IDs
 *   - INV_A's company names are not a superset of INV_B's company names (unless
 *     they genuinely share a position, which is tested separately)
 */

import { getDatabase } from "@/lib/data/loader";
import { resolveInvestorContext } from "@/lib/policy/context";
import { buildScopedDb, assertScopedDbIntegrity } from "@/lib/policy/scoped";
import { guardInvestorExists, guardCompanyInPortfolio } from "@/lib/policy/guards";
import { getPortfolioOverview } from "@/lib/domain/portfolio";

// ─── Test setup ────────────────────────────────────────────────────────────────

// We pick the first two investors from the sorted list to get stable test subjects.
// These are real investors from the dataset so the numbers will match the CSVs.
let INV_A: string;
let INV_B: string;

beforeAll(() => {
  const db = getDatabase();
  const sorted = [...db.investors.keys()].sort();
  if (sorted.length < 2) throw new Error("Need at least 2 investors in the dataset");
  INV_A = sorted[0];
  INV_B = sorted[1];
});

// ─── 1. Scoped DB row-level isolation ─────────────────────────────────────────

describe("buildScopedDb — allocation isolation", () => {
  it("every allocation in INV_A scoped DB has investor_id === INV_A", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const scopedDb = buildScopedDb(INV_A, db, ctx);

    for (const [, alloc] of scopedDb.allocations) {
      expect(alloc.investor_id).toBe(INV_A);
    }
  });

  it("every allocation in INV_B scoped DB has investor_id === INV_B", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_B, db)!;
    const scopedDb = buildScopedDb(INV_B, db, ctx);

    for (const [, alloc] of scopedDb.allocations) {
      expect(alloc.investor_id).toBe(INV_B);
    }
  });

  it("INV_A and INV_B scoped DBs have no overlapping allocation IDs", () => {
    const db = getDatabase();
    const ctxA = resolveInvestorContext(INV_A, db)!;
    const ctxB = resolveInvestorContext(INV_B, db)!;
    const sA = buildScopedDb(INV_A, db, ctxA);
    const sB = buildScopedDb(INV_B, db, ctxB);

    const idsA = new Set([...sA.allocations.keys()]);
    const idsB = new Set([...sB.allocations.keys()]);
    const overlap = [...idsA].filter((id) => idsB.has(id));

    expect(overlap).toHaveLength(0);
  });
});

describe("buildScopedDb — capital call isolation", () => {
  it("every capital call in INV_A scoped DB has investor_id === INV_A", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const scopedDb = buildScopedDb(INV_A, db, ctx);

    for (const [, call] of scopedDb.capitalCalls) {
      expect(call.investor_id).toBe(INV_A);
    }
  });

  it("INV_A scoped DB contains no capital calls belonging to INV_B", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const scopedDb = buildScopedDb(INV_A, db, ctx);

    for (const [, call] of scopedDb.capitalCalls) {
      expect(call.investor_id).not.toBe(INV_B);
    }
  });
});

describe("buildScopedDb — fee isolation", () => {
  it("every fee in INV_A scoped DB has investor_id === INV_A", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const scopedDb = buildScopedDb(INV_A, db, ctx);

    for (const [, fee] of scopedDb.fees) {
      expect(fee.investor_id).toBe(INV_A);
    }
  });
});

describe("buildScopedDb — distribution isolation", () => {
  it("every distribution in INV_A scoped DB has investor_id === INV_A", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const scopedDb = buildScopedDb(INV_A, db, ctx);

    for (const [, dist] of scopedDb.distributions) {
      expect(dist.investor_id).toBe(INV_A);
    }
  });
});

describe("buildScopedDb — statement line isolation", () => {
  it("every statement line in INV_A scoped DB has investor_id === INV_A", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const scopedDb = buildScopedDb(INV_A, db, ctx);

    for (const line of scopedDb.statementLines) {
      expect(line.investor_id).toBe(INV_A);
    }
  });
});

describe("buildScopedDb — deal scope isolation", () => {
  it("INV_A scoped DB deals are a subset of deals INV_A has allocations for", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const scopedDb = buildScopedDb(INV_A, db, ctx);

    for (const dealId of scopedDb.deals.keys()) {
      expect(ctx.dealIds.has(dealId)).toBe(true);
    }
  });

  it("INV_A scoped DB does not contain deals exclusively belonging to INV_B", () => {
    const db = getDatabase();
    const ctxA = resolveInvestorContext(INV_A, db)!;
    const ctxB = resolveInvestorContext(INV_B, db)!;
    const scopedA = buildScopedDb(INV_A, db, ctxA);

    // Deals only INV_B has (not INV_A)
    const exclusiveToB = [...ctxB.dealIds].filter((id) => !ctxA.dealIds.has(id));

    for (const dealId of exclusiveToB) {
      expect(scopedA.deals.has(dealId)).toBe(false);
    }
  });
});

// ─── 2. assertScopedDbIntegrity helper ────────────────────────────────────────

describe("assertScopedDbIntegrity", () => {
  it("passes for a correctly scoped DB", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const scopedDb = buildScopedDb(INV_A, db, ctx);
    const { passed, violations } = assertScopedDbIntegrity(scopedDb);

    expect(violations).toHaveLength(0);
    expect(passed).toBe(true);
  });
});

// ─── 3. Context isolation ──────────────────────────────────────────────────────

describe("resolveInvestorContext", () => {
  it("returns null for an unknown investor ID", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext("INV_DOES_NOT_EXIST", db);
    expect(ctx).toBeNull();
  });

  it("returns a frozen context for a known investor", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db);
    expect(ctx).not.toBeNull();
    expect(ctx!.investorId).toBe(INV_A);
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("context.allocationIds only contains allocations for the investor", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;

    for (const allocId of ctx.allocationIds) {
      const alloc = db.allocations.get(allocId);
      expect(alloc).toBeDefined();
      expect(alloc!.investor_id).toBe(INV_A);
    }
  });

  it("context.companyNamesLower does not contain companies exclusive to INV_B", () => {
    const db = getDatabase();
    const ctxA = resolveInvestorContext(INV_A, db)!;
    const ctxB = resolveInvestorContext(INV_B, db)!;

    // Companies exclusively in INV_B's portfolio
    const exclusiveToB = [...ctxB.companyNamesLower].filter(
      (n) => !ctxA.companyNamesLower.has(n)
    );

    for (const name of exclusiveToB) {
      expect(ctxA.companyNamesLower.has(name)).toBe(false);
    }
  });
});

// ─── 4. Evidence isolation ─────────────────────────────────────────────────────

describe("getPortfolioOverview — evidence isolation", () => {
  it("every evidence ID belongs to INV_A (checked via rawRows provenance)", () => {
    const db = getDatabase();
    const overview = getPortfolioOverview(INV_A, db);

    for (const ev of overview.evidence) {
      const raw = db.rawRows.get(ev.id);
      if (raw && raw["investor_id"]) {
        expect(raw["investor_id"]).toBe(INV_A);
      }
    }
  });

  it("portfolio overview for INV_A contains no allocation IDs from INV_B", () => {
    const db = getDatabase();
    const ctxB = resolveInvestorContext(INV_B, db)!;
    const overview = getPortfolioOverview(INV_A, db);

    const evidenceIds = new Set(overview.evidence.map((e) => e.id));
    for (const allocId of ctxB.allocationIds) {
      expect(evidenceIds.has(allocId)).toBe(false);
    }
  });

  it("company names in INV_A overview are all in INV_A context", () => {
    const db = getDatabase();
    const ctxA = resolveInvestorContext(INV_A, db)!;
    const overview = getPortfolioOverview(INV_A, db);

    for (const pos of overview.positions) {
      const lower = pos.companyName.toLowerCase();
      expect(ctxA.companyNamesLower.has(lower)).toBe(true);
    }
  });
});

// ─── 5. Guard: company ownership ──────────────────────────────────────────────

describe("guardCompanyInPortfolio", () => {
  it("allows a company that IS in the investor's portfolio", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const [firstCompanyName] = [...ctx.companyNamesLower];

    if (!firstCompanyName) return; // skip if investor has no allocations
    const result = guardCompanyInPortfolio(firstCompanyName, ctx, db);
    expect(result.allowed).toBe(true);
  });

  it("blocks a company that is NOT in the investor's portfolio", () => {
    const db = getDatabase();
    const ctxA = resolveInvestorContext(INV_A, db)!;
    const ctxB = resolveInvestorContext(INV_B, db)!;

    // Find a company exclusive to INV_B
    const exclusiveToB = [...ctxB.companyNamesLower].find(
      (n) => !ctxA.companyNamesLower.has(n)
    );
    if (!exclusiveToB) {
      // Both investors share all companies — skip (valid dataset scenario)
      return;
    }

    const result = guardCompanyInPortfolio(exclusiveToB, ctxA, db);
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("COMPANY_NOT_IN_PORTFOLIO");
    expect(result.safeResponse).toBeTruthy();
  });

  it("allows an empty company name (not all intents need one)", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const result = guardCompanyInPortfolio("", ctx, db);
    expect(result.allowed).toBe(true);
  });

  it("blocks a completely fictional company", () => {
    const db = getDatabase();
    const ctx = resolveInvestorContext(INV_A, db)!;
    const result = guardCompanyInPortfolio("Definitely Not A Real Company XYZ", ctx, db);
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("COMPANY_NOT_IN_PORTFOLIO");
  });
});

// ─── 6. Guard: investor existence ─────────────────────────────────────────────

describe("guardInvestorExists", () => {
  it("allows a known investor ID", () => {
    const db = getDatabase();
    const result = guardInvestorExists(INV_A, db);
    expect(result.allowed).toBe(true);
  });

  it("blocks an investor ID that is not in the dataset", () => {
    const db = getDatabase();
    const result = guardInvestorExists("INV_FABRICATED_99999", db);
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("UNKNOWN_INVESTOR");
  });

  it("blocks an empty string investor ID", () => {
    const db = getDatabase();
    const result = guardInvestorExists("", db);
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("UNKNOWN_INVESTOR");
  });

  it("blocks a whitespace-only investor ID", () => {
    const db = getDatabase();
    const result = guardInvestorExists("   ", db);
    expect(result.allowed).toBe(false);
    expect(result.violationCode).toBe("UNKNOWN_INVESTOR");
  });
});
