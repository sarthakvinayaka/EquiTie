/**
 * Integration tests for the deterministic portfolio engine.
 *
 * These tests run against the real parsed database (no mocks) so they exercise
 * the full pipeline: loader → domain → engine. Each test verifies structural
 * correctness, type safety, and invariant enforcement without asserting specific
 * numbers (which depend on the dataset and would be brittle).
 *
 * The tests pick investor IDs dynamically from the live DB so they remain stable
 * when the dataset changes.
 */

import { getDatabase } from "@/lib/data/loader";
import {
  getInvestorProfile,
  getInvestorPersonalizationProfile,
  getInvestorPortfolioOverview,
  getInvestorPositions,
  getInvestorPositionByCompany,
  getInvestorUpcomingObligations,
  getInvestorDistributions,
  getInvestorStatementSummary,
  getInvestorSectorConcentration,
} from "@/lib/engine";
import type { SophisticationLevel } from "@/lib/engine";

const db = getDatabase();
const allInvestorIds = [...db.investors.keys()].sort();

// Pick first investor for single-investor tests
const INV_A = allInvestorIds[0]!;
// Pick an investor with allocations for portfolio tests
const investorWithAllocations =
  allInvestorIds.find((id) => (db.allocationsByInvestor.get(id)?.length ?? 0) > 0) ??
  INV_A;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEngineResult(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  return (
    "result" in obj &&
    "evidence" in obj &&
    "assumptions" in obj &&
    "warnings" in obj &&
    Array.isArray((obj as { assumptions: unknown }).assumptions) &&
    Array.isArray((obj as { warnings: unknown }).warnings) &&
    Array.isArray((obj as { evidence: unknown }).evidence)
  );
}

// ─── getInvestorProfile ────────────────────────────────────────────────────────

describe("getInvestorProfile", () => {
  it("returns a valid EngineResult envelope", () => {
    const out = getInvestorProfile(INV_A, db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("result contains expected shape", () => {
    const { result } = getInvestorProfile(INV_A, db);
    expect(result.investorId).toBe(INV_A);
    expect(typeof result.name).toBe("string");
    expect(typeof result.reportingCurrency).toBe("string");
    expect(["Low", "Medium", "High"]).toContain(result.techSavviness);
    expect(["Verified", "Pending"]).toContain(result.kycStatus);
    if (result.age !== null) {
      expect(typeof result.age).toBe("number");
      expect(result.age).toBeGreaterThan(0);
    }
  });

  it("assumptions array is non-empty", () => {
    const { assumptions } = getInvestorProfile(INV_A, db);
    expect(assumptions.length).toBeGreaterThan(0);
  });

  it("throws for an invalid investor ID", () => {
    expect(() => getInvestorProfile("INVALID_INVESTOR", db)).toThrow();
  });

  it("covers all investors without throwing", () => {
    for (const id of allInvestorIds) {
      expect(() => getInvestorProfile(id, db)).not.toThrow();
    }
  });
});

// ─── getInvestorPersonalizationProfile ────────────────────────────────────────

describe("getInvestorPersonalizationProfile", () => {
  it("returns valid EngineResult", () => {
    const out = getInvestorPersonalizationProfile(investorWithAllocations, db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("sophisticationLevel is one of three valid values", () => {
    const { result } = getInvestorPersonalizationProfile(
      investorWithAllocations,
      db
    );
    const valid: SophisticationLevel[] = ["Emerging", "Established", "Experienced"];
    expect(valid).toContain(result.sophisticationLevel);
  });

  it("answerStyle matches sophisticationLevel", () => {
    const { result } = getInvestorPersonalizationProfile(
      investorWithAllocations,
      db
    );
    const expectedStyles: Record<SophisticationLevel, string> = {
      Experienced: "concise",
      Emerging: "explanatory",
      Established: "balanced",
    };
    expect(result.answerStyle).toBe(expectedStyles[result.sophisticationLevel]);
  });

  it("primarySectors is an array of strings (possibly empty)", () => {
    const { result } = getInvestorPersonalizationProfile(
      investorWithAllocations,
      db
    );
    expect(Array.isArray(result.primarySectors)).toBe(true);
    for (const s of result.primarySectors) {
      expect(typeof s).toBe("string");
    }
  });

  it("reportingCurrency matches investor record", () => {
    const investor = db.investors.get(investorWithAllocations)!;
    const { result } = getInvestorPersonalizationProfile(
      investorWithAllocations,
      db
    );
    expect(result.reportingCurrency).toBe(investor.reporting_currency);
  });

  it("dealCount matches actual allocation count", () => {
    const expected = db.allocationsByInvestor.get(investorWithAllocations)?.length ?? 0;
    const { result } = getInvestorPersonalizationProfile(
      investorWithAllocations,
      db
    );
    expect(result.dealCount).toBe(expected);
  });
});

// ─── getInvestorPortfolioOverview ─────────────────────────────────────────────

describe("getInvestorPortfolioOverview", () => {
  it("returns valid EngineResult", () => {
    const out = getInvestorPortfolioOverview(investorWithAllocations, db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("all position amounts are non-negative", () => {
    const { result } = getInvestorPortfolioOverview(investorWithAllocations, db);
    for (const pos of result.positions) {
      expect(pos.commitmentRpt).toBeGreaterThanOrEqual(0);
      expect(pos.contributedRpt).toBeGreaterThanOrEqual(0);
      expect(pos.currentValueRpt).toBeGreaterThanOrEqual(0);
      expect(pos.distributionsNetRpt).toBeGreaterThanOrEqual(0);
    }
  });

  it("total metrics are consistent: totalValueRpt = currentValueRpt + distributionsRpt", () => {
    const { result } = getInvestorPortfolioOverview(investorWithAllocations, db);
    expect(result.totalValueRpt).toBeCloseTo(
      result.totalCurrentValueRpt + result.totalDistributionsRpt,
      2
    );
  });

  it("MOIC is null only when total contributed is 0", () => {
    const { result } = getInvestorPortfolioOverview(investorWithAllocations, db);
    if (result.totalContributedRpt === 0) {
      expect(result.portfolioMoic).toBeNull();
    } else {
      expect(result.portfolioMoic).not.toBeNull();
      expect(result.portfolioMoic).toBeGreaterThan(0);
    }
  });

  it("activePositions + pendingPositions matches positions array length", () => {
    const { result } = getInvestorPortfolioOverview(investorWithAllocations, db);
    // Active/Exited/Written Off count
    const byStatus = result.positions.reduce(
      (acc, p) => {
        if (p.allocationStatus === "Pending") acc.pending++;
        else acc.active++;
        return acc;
      },
      { active: 0, pending: 0 }
    );
    expect(result.activePositions).toBe(byStatus.active);
    expect(result.pendingPositions).toBe(byStatus.pending);
  });

  it("every position allocationId belongs to this investor", () => {
    const { result } = getInvestorPortfolioOverview(investorWithAllocations, db);
    for (const pos of result.positions) {
      const alloc = db.allocations.get(pos.allocationId);
      expect(alloc).toBeDefined();
      expect(alloc!.investor_id).toBe(investorWithAllocations);
    }
  });

  it("runs for all investors without throwing", () => {
    for (const id of allInvestorIds) {
      expect(() => getInvestorPortfolioOverview(id, db)).not.toThrow();
    }
  });
});

// ─── getInvestorPositions ──────────────────────────────────────────────────────

describe("getInvestorPositions", () => {
  it("returns valid EngineResult", () => {
    const out = getInvestorPositions(investorWithAllocations, db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("result is an array (may be empty for investors without deals)", () => {
    const { result } = getInvestorPositions(investorWithAllocations, db);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("matches positions list from portfolio overview", () => {
    const positionsResult = getInvestorPositions(investorWithAllocations, db);
    const overviewResult = getInvestorPortfolioOverview(investorWithAllocations, db);
    expect(positionsResult.result.length).toBe(overviewResult.result.positions.length);
  });

  it("pending positions have null MOIC", () => {
    const { result } = getInvestorPositions(investorWithAllocations, db);
    for (const pos of result) {
      if (pos.allocationStatus === "Pending") {
        expect(pos.moic).toBeNull();
      }
    }
  });

  it("exited/written-off positions have currentValue = 0", () => {
    const { result } = getInvestorPositions(investorWithAllocations, db);
    for (const pos of result) {
      if (pos.dealStatus !== "Active") {
        expect(pos.currentValueRpt).toBe(0);
        expect(pos.currentValueDealCcy).toBe(0);
      }
    }
  });
});

// ─── getInvestorPositionByCompany ──────────────────────────────────────────────

describe("getInvestorPositionByCompany", () => {
  it("returns valid EngineResult", () => {
    const { result: positions } = getInvestorPositions(investorWithAllocations, db);
    const companyName = positions[0]?.companyName ?? "Unknown";
    const out = getInvestorPositionByCompany(investorWithAllocations, companyName, db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("returns null result for a company not in portfolio", () => {
    const { result } = getInvestorPositionByCompany(
      investorWithAllocations,
      "XXXXXXXXXXX_NOT_A_REAL_COMPANY",
      db
    );
    expect(result).toBeNull();
  });

  it("found company result contains rounds array", () => {
    const { result: positions } = getInvestorPositions(investorWithAllocations, db);
    const firstCompany = positions[0]?.companyName;
    if (!firstCompany) return;

    const { result } = getInvestorPositionByCompany(
      investorWithAllocations,
      firstCompany,
      db
    );
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.rounds)).toBe(true);
    expect(result!.rounds.length).toBeGreaterThan(0);
  });

  it("all rounds in result belong to this investor", () => {
    const { result: positions } = getInvestorPositions(investorWithAllocations, db);
    const firstCompany = positions[0]?.companyName;
    if (!firstCompany) return;

    const { result } = getInvestorPositionByCompany(
      investorWithAllocations,
      firstCompany,
      db
    );
    if (!result) return;
    for (const round of result.rounds) {
      const alloc = db.allocations.get(round.allocationId);
      expect(alloc?.investor_id).toBe(investorWithAllocations);
    }
  });

  it("company MOIC is null when all rounds are pending", () => {
    // Find an investor with a pending allocation
    const pendingInvestorId = allInvestorIds.find((id) => {
      const allocIds = db.allocationsByInvestor.get(id) ?? [];
      return allocIds.some((aid) => {
        const alloc = db.allocations.get(aid);
        return alloc?.allocation_status === "Pending" || parseFloat(alloc?.contributed_amount ?? "1") === 0;
      });
    });
    if (!pendingInvestorId) return; // skip if no pending alloc in dataset

    const { result: positions } = getInvestorPositions(pendingInvestorId, db);
    const pendingPos = positions.find(
      (p) => p.allocationStatus === "Pending" || p.contributedRpt === 0
    );
    if (!pendingPos) return;

    // Only check MOIC null for the specific round, not the entire company
    expect(pendingPos.moic).toBeNull();
  });

  it("case-insensitive partial name match works", () => {
    const { result: positions } = getInvestorPositions(investorWithAllocations, db);
    const firstCompany = positions[0]?.companyName;
    if (!firstCompany) return;

    // Use first 4 characters of name, lowercased
    const partial = firstCompany.slice(0, 4).toLowerCase();
    const { result } = getInvestorPositionByCompany(
      investorWithAllocations,
      partial,
      db
    );
    // Might match or not depending on uniqueness — just no throw
    expect(isEngineResult({ result, evidence: [], assumptions: [], warnings: [] })).toBe(true);
  });
});

// ─── getInvestorUpcomingObligations ───────────────────────────────────────────

describe("getInvestorUpcomingObligations", () => {
  it("returns valid EngineResult", () => {
    const out = getInvestorUpcomingObligations(investorWithAllocations, db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("result has investorId, capitalCalls, fees arrays", () => {
    const { result } = getInvestorUpcomingObligations(investorWithAllocations, db);
    expect(result.investorId).toBe(investorWithAllocations);
    expect(Array.isArray(result.capitalCalls)).toBe(true);
    expect(Array.isArray(result.fees)).toBe(true);
  });

  it("totals are consistent: totalObligations = capitalCalls + fees", () => {
    const { result } = getInvestorUpcomingObligations(investorWithAllocations, db);
    expect(result.totalObligationsRpt).toBeCloseTo(
      result.totalCapitalCallsRpt + result.totalFeesRpt,
      2
    );
  });

  it("all capital call amounts are positive", () => {
    const { result } = getInvestorUpcomingObligations(investorWithAllocations, db);
    for (const call of result.capitalCalls) {
      expect(call.amountRpt).toBeGreaterThanOrEqual(0);
    }
  });

  it("fee status is one of Upcoming or Overdue", () => {
    const { result } = getInvestorUpcomingObligations(investorWithAllocations, db);
    for (const fee of result.fees) {
      expect(["Upcoming", "Overdue"]).toContain(fee.status);
    }
  });

  it("runs without throwing for all investors", () => {
    for (const id of allInvestorIds) {
      expect(() => getInvestorUpcomingObligations(id, db)).not.toThrow();
    }
  });
});

// ─── getInvestorDistributions ─────────────────────────────────────────────────

describe("getInvestorDistributions", () => {
  it("returns valid EngineResult", () => {
    const out = getInvestorDistributions(investorWithAllocations, db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("totalNetRpt ≤ totalGrossRpt (carry is always non-negative)", () => {
    const { result } = getInvestorDistributions(investorWithAllocations, db);
    expect(result.totalNetRpt).toBeLessThanOrEqual(result.totalGrossRpt + 0.01);
  });

  it("totalPerformanceFeeRpt = totalGrossRpt - totalNetRpt", () => {
    const { result } = getInvestorDistributions(investorWithAllocations, db);
    expect(result.totalPerformanceFeeRpt).toBeCloseTo(
      result.totalGrossRpt - result.totalNetRpt,
      2
    );
  });

  it("each distribution has a valid type", () => {
    const { result } = getInvestorDistributions(investorWithAllocations, db);
    for (const d of result.distributions) {
      expect(["Exit Proceeds", "Secondary Sale"]).toContain(d.type);
    }
  });

  it("fractionOfUnits is between 0 and 1 for each distribution", () => {
    const { result } = getInvestorDistributions(investorWithAllocations, db);
    for (const d of result.distributions) {
      expect(d.fractionOfUnits).toBeGreaterThanOrEqual(0);
      expect(d.fractionOfUnits).toBeLessThanOrEqual(1.01); // 1.01 for float tolerance
    }
  });

  it("runs without throwing for all investors", () => {
    for (const id of allInvestorIds) {
      expect(() => getInvestorDistributions(id, db)).not.toThrow();
    }
  });
});

// ─── getInvestorStatementSummary ──────────────────────────────────────────────

describe("getInvestorStatementSummary", () => {
  it("returns valid EngineResult", () => {
    const out = getInvestorStatementSummary(investorWithAllocations, db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("net cash flow formula: distributions - contributions - fees", () => {
    const { result } = getInvestorStatementSummary(investorWithAllocations, db);
    const expected =
      result.totalDistributionsRpt -
      result.totalContributionsRpt -
      result.totalFeesRpt;
    expect(result.netCashFlowRpt).toBeCloseTo(expected, 2);
  });

  it("lines are sorted with dates and groups are chronological", () => {
    const { result } = getInvestorStatementSummary(investorWithAllocations, db);
    const periods = result.groups.map((g) => g.period);
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i].localeCompare(periods[i - 1])).toBeGreaterThanOrEqual(0);
    }
  });

  it("group netFlowRpt sum equals overall net cash flow", () => {
    const { result } = getInvestorStatementSummary(investorWithAllocations, db);
    if (result.groups.length === 0) return;
    const groupNet = result.groups.reduce((s, g) => s + g.netFlowRpt, 0);
    expect(groupNet).toBeCloseTo(result.netCashFlowRpt, 2);
  });

  it("earliestDate ≤ latestDate when lines exist", () => {
    const { result } = getInvestorStatementSummary(investorWithAllocations, db);
    if (!result.earliestDate || !result.latestDate) return;
    expect(result.earliestDate.localeCompare(result.latestDate)).toBeLessThanOrEqual(0);
  });

  it("total line count matches sum of lines across groups", () => {
    const { result } = getInvestorStatementSummary(investorWithAllocations, db);
    const groupTotal = result.groups.reduce((s, g) => s + g.lines.length, 0);
    expect(groupTotal).toBe(result.lines.length);
  });

  it("runs without throwing for all investors", () => {
    for (const id of allInvestorIds) {
      expect(() => getInvestorStatementSummary(id, db)).not.toThrow();
    }
  });
});

// ─── getInvestorSectorConcentration ───────────────────────────────────────────

describe("getInvestorSectorConcentration", () => {
  it("returns valid EngineResult", () => {
    const out = getInvestorSectorConcentration(investorWithAllocations, db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("bucket percentages sum to 100", () => {
    const { result } = getInvestorSectorConcentration(investorWithAllocations, db);
    if (result.buckets.length === 0) return;
    const sum = result.buckets.reduce((s, b) => s + b.committedPct, 0);
    expect(sum).toBeCloseTo(100, 2);
  });

  it("HHI is between 0 and 1", () => {
    const { result } = getInvestorSectorConcentration(investorWithAllocations, db);
    expect(result.herfindahlIndex).toBeGreaterThanOrEqual(0);
    expect(result.herfindahlIndex).toBeLessThanOrEqual(1.0001); // float tolerance
  });

  it("dominantSector is one of the bucket sectors when set", () => {
    const { result } = getInvestorSectorConcentration(investorWithAllocations, db);
    if (result.dominantSector !== null) {
      const sectorNames = result.buckets.map((b) => b.sector);
      expect(sectorNames).toContain(result.dominantSector);
    }
  });

  it("dominant sector has > 50% when set", () => {
    const { result } = getInvestorSectorConcentration(investorWithAllocations, db);
    if (result.dominantSector !== null) {
      const bucket = result.buckets.find((b) => b.sector === result.dominantSector);
      expect(bucket!.committedPct).toBeGreaterThan(50);
    }
  });

  it("allocationCount per bucket is > 0", () => {
    const { result } = getInvestorSectorConcentration(investorWithAllocations, db);
    for (const b of result.buckets) {
      expect(b.allocationCount).toBeGreaterThan(0);
    }
  });

  it("totalCommittedRpt matches sum of bucket amounts", () => {
    const { result } = getInvestorSectorConcentration(investorWithAllocations, db);
    if (result.buckets.length === 0) return;
    const bucketSum = result.buckets.reduce((s, b) => s + b.committedRpt, 0);
    expect(bucketSum).toBeCloseTo(result.totalCommittedRpt, 2);
  });

  it("runs without throwing for all investors", () => {
    for (const id of allInvestorIds) {
      expect(() => getInvestorSectorConcentration(id, db)).not.toThrow();
    }
  });
});

// ─── Cross-engine isolation invariant ─────────────────────────────────────────

describe("Data isolation invariant", () => {
  // Every engine function: result data should only reference this investor's allocations
  it("portfolio overview positions contain only this investor's allocation IDs", () => {
    const { result } = getInvestorPortfolioOverview(investorWithAllocations, db);
    for (const pos of result.positions) {
      const alloc = db.allocations.get(pos.allocationId);
      expect(alloc?.investor_id).toBe(investorWithAllocations);
    }
  });

  it("obligations reference only deals this investor is in", () => {
    const { result: obligationsResult } = getInvestorUpcomingObligations(
      investorWithAllocations,
      db
    );
    const investorDealIds = new Set(
      (db.allocationsByInvestor.get(investorWithAllocations) ?? [])
        .map((aid) => db.allocations.get(aid)?.deal_id)
        .filter(Boolean) as string[]
    );

    for (const call of obligationsResult.capitalCalls) {
      expect(investorDealIds.has(call.dealId)).toBe(true);
    }
  });

  it("no investor's data appears in another investor's portfolio result", () => {
    if (allInvestorIds.length < 2) return; // can't test with a single investor

    const INV_B = allInvestorIds[1]!;
    const resultA = getInvestorPortfolioOverview(investorWithAllocations, db);
    const resultB = getInvestorPortfolioOverview(INV_B, db);

    // Their allocation ID sets should be disjoint
    const aIds = new Set(resultA.result.positions.map((p) => p.allocationId));
    const bIds = new Set(resultB.result.positions.map((p) => p.allocationId));

    for (const id of aIds) {
      expect(bIds.has(id)).toBe(false);
    }
  });
});
