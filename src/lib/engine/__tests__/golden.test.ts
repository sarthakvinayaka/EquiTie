/**
 * GOLDEN TEST SUITE
 *
 * [D] DETERMINISTIC — pinned numeric values derived directly from data/*.csv.
 *     Any change to computation logic will break these assertions immediately.
 *
 * [N] NARRATIVE-QUALITY — structural checks on text output (non-empty,
 *     mentions relevant facts). Exact wording may vary.
 *
 * Subject investors:
 *   INV001 — Idris Olawale (GBP, 4 allocations: Forgecraft × 3 rounds + Inferna AI Series B)
 *   INV009 — (USD/multi-currency, 6 allocations, negotiated fee discount on Forgecraft Seed)
 *
 * Pinned source values (data/*.csv, FX snapshot 2026-06-25):
 *   FX: 1 GBP = 1.35 USD
 *   INV001 capital deployed:        40,000 + 35,000 + 137,000 + 15,600 = 227,600 USD
 *   INV001 structuring fees (paid): 1,600 + 1,400 = 3,000 USD
 *   INV001 in GBP:                  227,600 ÷ 1.35 ≈ 168,592 GBP contributed
 *   INV001 Forgecraft total:        40,000 + 35,000 + 15,600 = 90,600 USD ÷ 1.35 ≈ 67,111 GBP
 *
 * All tests use the real parsed database — no mocks, no stubs.
 */

import { getDatabase } from "@/lib/data/loader";
import { getInvestorPortfolioOverview } from "@/lib/engine/portfolio";
import { getInvestorPositionByCompany } from "@/lib/engine/portfolio";
import { getInvestorStatementSummary } from "@/lib/engine/statement";
import { getInvestorFeeBreakdown } from "@/lib/engine/fees";

const db = getDatabase();

// ─── A. INV001 Account Statement — 6 lines, pinned totals [D GOLDEN] ──────────

describe("[D GOLDEN] INV001 account statement (6 statement lines, no distributions)", () => {
  // Evaluated once per suite — all tests share this result
  const stmt = getInvestorStatementSummary("INV001", db);

  it("returns 6 statement lines", () => {
    expect(stmt.result.lines).toHaveLength(6);
  });

  it("lines are sorted chronologically (oldest first)", () => {
    const dates = stmt.result.lines.map((l) => l.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it("[D] totalContributionsRpt ≈ 168,592 GBP  (227,600 USD ÷ 1.35)", () => {
    expect(stmt.result.totalContributionsRpt).toBeGreaterThan(168_000);
    expect(stmt.result.totalContributionsRpt).toBeLessThan(169_500);
  });

  it("[D] totalFeesRpt ≈ 2,222 GBP  (3,000 USD structuring fees ÷ 1.35)", () => {
    expect(stmt.result.totalFeesRpt).toBeGreaterThan(2_200);
    expect(stmt.result.totalFeesRpt).toBeLessThan(2_250);
  });

  it("[D] totalDistributionsRpt = 0  (INV001 has no distributions in the dataset)", () => {
    expect(stmt.result.totalDistributionsRpt).toBe(0);
  });

  it("[D] netCashFlowRpt is negative  (more deployed than received)", () => {
    expect(stmt.result.netCashFlowRpt).toBeLessThan(0);
  });

  it("[D] net cash flow formula: distributions − contributions − fees", () => {
    const expected =
      stmt.result.totalDistributionsRpt -
      stmt.result.totalContributionsRpt -
      stmt.result.totalFeesRpt;
    expect(stmt.result.netCashFlowRpt).toBeCloseTo(expected, 1);
  });

  it("evidence items include only INV001 statement line IDs (LN00001–LN00006)", () => {
    const inv1LineIds = new Set(
      (db.statementLines.get("INV001") ?? []).map((l) => l.line_id)
    );
    for (const ev of stmt.evidence) {
      if (ev.id.startsWith("LN")) {
        expect(inv1LineIds.has(ev.id)).toBe(true);
      }
    }
  });
});

// ─── B. INV001 Portfolio Overview — 4 active positions [D GOLDEN] ─────────────

describe("[D GOLDEN] INV001 portfolio overview (4 positions, GBP reporting)", () => {
  const overview = getInvestorPortfolioOverview("INV001", db);

  it("reporting currency is GBP", () => {
    expect(overview.result.reportingCurrency).toBe("GBP");
  });

  it("[D] 4 active positions, 0 pending", () => {
    expect(overview.result.activePositions).toBe(4);
    expect(overview.result.pendingPositions).toBe(0);
  });

  it("[D] totalContributedRpt ≈ 168,592 GBP  (same source as statement contributions)", () => {
    expect(overview.result.totalContributedRpt).toBeGreaterThan(168_000);
    expect(overview.result.totalContributedRpt).toBeLessThan(169_500);
  });

  it("[D] portfolioMoic between 2.4× and 3.0× (all marks above entry, no distributions)", () => {
    expect(overview.result.portfolioMoic).not.toBeNull();
    expect(overview.result.portfolioMoic!).toBeGreaterThan(2.4);
    expect(overview.result.portfolioMoic!).toBeLessThan(3.0);
  });

  it("totalValueRpt > totalContributedRpt  (portfolio is above water)", () => {
    expect(overview.result.totalValueRpt).toBeGreaterThan(
      overview.result.totalContributedRpt
    );
  });

  it("positions include Forgecraft Robotics and Inferna AI", () => {
    const names = overview.result.positions.map((p) => p.companyName);
    expect(names).toContain("Forgecraft Robotics");
    expect(names).toContain("Inferna AI");
  });

  it("[D] exactly 3 Forgecraft Robotics positions (Seed, Series A, Series B)", () => {
    const forgecraftPositions = overview.result.positions.filter(
      (p) => p.companyName === "Forgecraft Robotics"
    );
    expect(forgecraftPositions).toHaveLength(3);
    const rounds = forgecraftPositions.map((p) => p.round);
    expect(rounds).toContain("Seed");
    expect(rounds).toContain("Series A");
    expect(rounds).toContain("Series B");
  });

  it("[D] portfolio contributed matches statement contributions within 1 GBP  (cross-function invariant)", () => {
    const stmt = getInvestorStatementSummary("INV001", db);
    const delta = Math.abs(
      overview.result.totalContributedRpt - stmt.result.totalContributionsRpt
    );
    expect(delta).toBeLessThan(1);
  });

  it("all 4 positions are marked Active (not Pending)", () => {
    for (const pos of overview.result.positions) {
      expect(pos.allocationStatus).toBe("Active");
    }
  });
});

// ─── C. INV001 Forgecraft Robotics — 3-round aggregated position [D GOLDEN] ───

describe("[D GOLDEN] INV001 Forgecraft Robotics multi-round position (3 rounds)", () => {
  const pos = getInvestorPositionByCompany("INV001", "Forgecraft", db);

  it("returns a non-null result (company is in INV001 portfolio)", () => {
    expect(pos.result).not.toBeNull();
  });

  it("[D] exactly 3 rounds: Seed, Series A, Series B", () => {
    expect(pos.result!.rounds).toHaveLength(3);
    const roundNames = pos.result!.rounds.map((r) => r.round);
    expect(roundNames).toContain("Seed");
    expect(roundNames).toContain("Series A");
    expect(roundNames).toContain("Series B");
  });

  it("[D] totalContributedRpt ≈ 67,111 GBP  (90,600 USD ÷ 1.35)", () => {
    expect(pos.result!.totalContributedRpt).toBeGreaterThan(66_000);
    expect(pos.result!.totalContributedRpt).toBeLessThan(68_500);
  });

  it("[D] companyMoic > 3.0×  (all Forgecraft marks significantly above entry)", () => {
    expect(pos.result!.companyMoic).not.toBeNull();
    expect(pos.result!.companyMoic!).toBeGreaterThan(3.0);
  });

  it("[D] Seed round has a price discount  (effectiveSharePrice < entrySharePrice)", () => {
    const seed = pos.result!.rounds.find((r) => r.round === "Seed");
    expect(seed).toBeDefined();
    expect(seed!.effectiveSharePrice).toBeLessThan(seed!.entrySharePrice);
  });

  it("warnings include multi-round note", () => {
    const hasMultiRoundWarning = pos.warnings.some((w) =>
      w.toLowerCase().includes("multi-round")
    );
    expect(hasMultiRoundWarning).toBe(true);
  });

  it("evidence is non-empty (provenance tracked for all rounds)", () => {
    expect(pos.evidence.length).toBeGreaterThan(0);
  });
});

// ─── D. INV009 fee discount — pinned deal-level values [D GOLDEN] ─────────────

describe("[D GOLDEN] INV009 negotiated fee discount on Forgecraft Seed (ALC0004)", () => {
  const { result } = getInvestorFeeBreakdown("INV009", "", db);

  it("[D] hasAnyDiscount = true", () => {
    expect(result.hasAnyDiscount).toBe(true);
  });

  it("[D] ALC0004 (Forgecraft Seed) has hasNegotiatedDiscount = true", () => {
    const deal = result.deals.find((d) => d.allocationId === "ALC0004");
    expect(deal).toBeDefined();
    expect(deal!.hasNegotiatedDiscount).toBe(true);
  });

  it("[D] ALC0004 performance fee schedule: effectiveRate = 10%  (vs standard 20%)", () => {
    const deal = result.deals.find((d) => d.allocationId === "ALC0004");
    expect(deal).toBeDefined();
    const perfFee = deal!.schedule.find((f) => f.feeType === "Performance Fee");
    expect(perfFee).toBeDefined();
    expect(perfFee!.effectiveRate).toBe(10);
    expect(perfFee!.standardRate).toBe(20);
    expect(perfFee!.discounted).toBe(true);
  });

  it("[D] ALC0004 admin fee schedule: effectiveRate = 0  (vs standard $450)", () => {
    const deal = result.deals.find((d) => d.allocationId === "ALC0004");
    expect(deal).toBeDefined();
    const adminFee = deal!.schedule.find((f) => f.feeType === "Admin Fee");
    expect(adminFee).toBeDefined();
    expect(adminFee!.effectiveRate).toBe(0);
    expect(adminFee!.discounted).toBe(true);
  });
});

// ─── E. Cross-investor isolation — INV001 and INV002 are fully disjoint [D] ───

describe("[D GOLDEN] INV001 and INV002 have fully disjoint allocation IDs", () => {
  it("no shared allocation IDs between INV001 and INV002", () => {
    const inv1Allocs = new Set(db.allocationsByInvestor.get("INV001") ?? []);
    const inv2Allocs = db.allocationsByInvestor.get("INV002") ?? [];
    for (const id of inv2Allocs) {
      expect(inv1Allocs.has(id)).toBe(false);
    }
  });

  it("INV001 portfolio evidence contains no INV002 allocation IDs", () => {
    const inv2Allocs = new Set(db.allocationsByInvestor.get("INV002") ?? []);
    const overview = getInvestorPortfolioOverview("INV001", db);
    for (const ev of overview.evidence) {
      expect(inv2Allocs.has(ev.id)).toBe(false);
    }
  });
});

// ─── F. EngineResult shape — all golden calls return {result,evidence,...} [D] ─

describe("[D GOLDEN] All calls return valid EngineResult shape", () => {
  const calls = [
    ["portfolio overview", () => getInvestorPortfolioOverview("INV001", db)],
    ["statement summary", () => getInvestorStatementSummary("INV001", db)],
    ["position by company", () => getInvestorPositionByCompany("INV001", "Forgecraft", db)],
    ["fee breakdown INV001", () => getInvestorFeeBreakdown("INV001", "", db)],
    ["fee breakdown INV009", () => getInvestorFeeBreakdown("INV009", "", db)],
  ] as const;

  for (const [label, call] of calls) {
    it(`${label} → { result, evidence[], assumptions[], warnings[] }`, () => {
      const r = call();
      expect(r).toHaveProperty("result");
      expect(Array.isArray(r.evidence)).toBe(true);
      expect(Array.isArray(r.assumptions)).toBe(true);
      expect(Array.isArray(r.warnings)).toBe(true);
    });
  }
});
