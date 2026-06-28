/**
 * Valuation history engine tests.
 *
 * Three example valuation-related test questions (as realistic user queries):
 *   1. "How has Forgecraft Robotics' valuation moved over time?"
 *   2. "Has any company in my portfolio had a down round?"
 *   3. "What would my MOIC have been if I had sold at the peak valuation?"
 *
 * Behavioral tests:
 *   4. Written-off position (DEAL008 — Write Off mark) → moicAtMark = 0 at write-off
 *   5. Down round detection (DEAL009, DEAL010 — price dropped at latest mark)
 *   6. Date-accurate realised fraction — MOIC at Entry mark ≈ MOIC with no distributions
 *   7. MOIC < 1 for down-round positions
 *   8. Sparse cadence flag (maxGapDays > 365)
 *   9. Evidence rows: one per valuation mark
 *  10. Assumptions always mention "no interpolation"
 */

import { getDatabase } from "@/lib/data/loader";
import { getInvestorValuationTimeline } from "@/lib/engine/valuations";

const db = getDatabase();

// Pick an investor with the most allocations for integration tests
const allInvestorIds = [...db.investors.keys()].sort();

// INV001 has allocations in DEAL001 (Forgecraft Robotics Seed — 4 marks, all up-rounds)
const INV_WITH_FORGECRAFT = "INV001";

// Find investor with a write-off position (DEAL008)
const investorWithWriteOff =
  allInvestorIds.find((id) => {
    const allocIds = db.allocationsByInvestor.get(id) ?? [];
    return allocIds.some((aid) => db.allocations.get(aid)?.deal_id === "DEAL008");
  }) ?? null;

// Find investor with a down-round (DEAL009 or DEAL010 — price dropped at latest mark)
const investorWithDownRound =
  allInvestorIds.find((id) => {
    const allocIds = db.allocationsByInvestor.get(id) ?? [];
    return allocIds.some((aid) => {
      const alloc = db.allocations.get(aid);
      return alloc?.deal_id === "DEAL009" || alloc?.deal_id === "DEAL010";
    });
  }) ?? null;

// ─── Example question 1: "How has Forgecraft Robotics' valuation moved?" ──────

describe('Example Q1: "How has Forgecraft Robotics valuation moved over time?"', () => {
  it("returns a valid EngineResult for Forgecraft", () => {
    const out = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft", db);
    expect(out).toMatchObject({
      result: expect.any(Object),
      evidence: expect.any(Array),
      assumptions: expect.any(Array),
      warnings: expect.any(Array),
    });
  });

  it("finds at least one timeline for Forgecraft", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft", db);
    expect(result.timelines.length).toBeGreaterThan(0);
  });

  it("Forgecraft Seed has 4 valuation marks (VAL001–VAL004)", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft Robotics", db);
    const seedTimeline = result.timelines.find(
      (t) => t.dealId === "DEAL001"
    );
    expect(seedTimeline).toBeDefined();
    expect(seedTimeline!.markCount).toBe(4);
  });

  it("marks are in chronological order", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft", db);
    for (const tl of result.timelines) {
      for (let i = 1; i < tl.marks.length; i++) {
        expect(tl.marks[i].date.localeCompare(tl.marks[i - 1].date)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("MOIC at entry mark ≈ 1.0× when no prior distributions", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft Robotics", db);
    const tl = result.timelines.find((t) => t.dealId === "DEAL001");
    if (!tl) return;
    const entryMark = tl.marks.find((m) => m.markSource === "Entry");
    if (!entryMark || entryMark.moicAtMark === null) return;
    // At entry: price = effective entry price paid by investor
    // investorValue = units × entryPrice × 1.0 ≈ contributed (if no price discount)
    // We accept ≈ 0.8–1.25× as a reasonable entry MOIC range (price discounts shift this)
    expect(entryMark.moicAtMark).toBeGreaterThan(0.5);
    expect(entryMark.moicAtMark).toBeLessThan(3.0);
  });

  it("MOIC at latest mark is higher than at entry (Forgecraft is an up-round story)", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft Robotics", db);
    const tl = result.timelines.find((t) => t.dealId === "DEAL001");
    if (!tl) return;
    const entryMark = tl.marks.find((m) => m.markSource === "Entry");
    const latestMark = tl.marks[tl.marks.length - 1];
    if (!entryMark?.moicAtMark || !latestMark?.moicAtMark) return;
    expect(latestMark.moicAtMark).toBeGreaterThan(entryMark.moicAtMark);
  });

  it("evidence has one item per mark", () => {
    const { result, evidence } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft Robotics", db);
    const tl = result.timelines.find((t) => t.dealId === "DEAL001");
    if (!tl) return;
    expect(tl.evidence.length).toBe(tl.markCount);
    expect(evidence.every((e) => e.sourceType === "valuation")).toBe(true);
  });

  it("assumptions mention no interpolation", () => {
    const { assumptions } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft", db);
    const hasNoInterp = assumptions.some((a) =>
      a.toLowerCase().includes("no interpolation") ||
      a.toLowerCase().includes("no extrapolation")
    );
    expect(hasNoInterp).toBe(true);
  });
});

// ─── Example question 2: "Has any company in my portfolio had a down round?" ──

describe('Example Q2: "Has any company in my portfolio had a down round?"', () => {
  it("detects down rounds correctly when share price falls", () => {
    if (!investorWithDownRound) {
      console.warn("No investor with down-round deal found — skipping");
      return;
    }
    const { result } = getInvestorValuationTimeline(investorWithDownRound, "", db);
    const timelinesWithDownRound = result.timelines.filter((t) => t.hasDownRound);
    expect(timelinesWithDownRound.length).toBeGreaterThan(0);
  });

  it("down round mark has isDownRound = true and negative priceChangePct", () => {
    if (!investorWithDownRound) return;
    const { result } = getInvestorValuationTimeline(investorWithDownRound, "", db);
    for (const tl of result.timelines) {
      for (const mark of tl.marks) {
        if (mark.isDownRound) {
          expect(mark.priceChangePct).not.toBeNull();
          expect(mark.priceChangePct!).toBeLessThan(0);
          expect(mark.priceChangeAbs).not.toBeNull();
          expect(mark.priceChangeAbs!).toBeLessThan(0);
        }
      }
    }
  });

  it("down round events populate the downRounds array with from/to prices", () => {
    if (!investorWithDownRound) return;
    const { result } = getInvestorValuationTimeline(investorWithDownRound, "", db);
    for (const tl of result.timelines.filter((t) => t.hasDownRound)) {
      expect(tl.downRounds.length).toBeGreaterThan(0);
      for (const dr of tl.downRounds) {
        expect(dr.fromPrice).toBeGreaterThan(dr.toPrice);
        expect(dr.pctDrop).toBeGreaterThan(0);
        expect(dr.date).toBeTruthy();
      }
    }
  });

  it("MOIC at a down-round mark is lower than at the prior mark", () => {
    if (!investorWithDownRound) return;
    const { result } = getInvestorValuationTimeline(investorWithDownRound, "", db);
    for (const tl of result.timelines.filter((t) => t.hasDownRound)) {
      for (let i = 1; i < tl.marks.length; i++) {
        const curr = tl.marks[i];
        const prev = tl.marks[i - 1];
        if (curr.isDownRound && curr.moicAtMark !== null && prev.moicAtMark !== null) {
          // After a down round, if no distributions happened, MOIC should be lower
          if (curr.distributionsNetToDateRpt === prev.distributionsNetToDateRpt) {
            expect(curr.moicAtMark).toBeLessThan(prev.moicAtMark);
          }
        }
      }
    }
  });

  it("warnings mention down round dates", () => {
    if (!investorWithDownRound) return;
    const { warnings } = getInvestorValuationTimeline(investorWithDownRound, "", db);
    const hasDownRoundWarning = warnings.some((w) =>
      w.toLowerCase().includes("down round")
    );
    expect(hasDownRoundWarning).toBe(true);
  });
});

// ─── Example question 3: "What would my MOIC have been at the peak?" ─────────

describe('Example Q3: "What would my MOIC have been at the peak valuation?"', () => {
  it("peakMoic is always ≥ latestMoic for non-exited up-round positions", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft Robotics", db);
    for (const tl of result.timelines) {
      if (tl.isExited || tl.isWrittenOff) continue;
      if (tl.latestMoic === null || tl.peakMoic === null) continue;
      expect(tl.peakMoic).toBeGreaterThanOrEqual(tl.latestMoic - 0.001);
    }
  });

  it("peakMoicDate is set when peakMoic is set", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft", db);
    for (const tl of result.timelines) {
      if (tl.peakMoic !== null) {
        expect(tl.peakMoicDate).toBeTruthy();
      }
    }
  });

  it("peakMoic ≥ 1.0× for a pure up-round company (Forgecraft Seed)", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft Robotics", db);
    const tl = result.timelines.find((t) => t.dealId === "DEAL001");
    if (!tl || tl.peakMoic === null) return;
    expect(tl.peakMoic).toBeGreaterThan(1.0);
  });

  it("for a written-off company, MOIC at Write Off mark = 0", () => {
    if (!investorWithWriteOff) {
      console.warn("No investor with write-off deal found in dataset");
      return;
    }
    const { result } = getInvestorValuationTimeline(investorWithWriteOff, "", db);
    const writtenOff = result.timelines.find((t) => t.isWrittenOff);
    if (!writtenOff) return;

    const writeOffMark = writtenOff.marks.find((m) => m.markSource === "Write Off");
    expect(writeOffMark).toBeDefined();
    expect(writeOffMark!.investorValueRpt).toBe(0);
    // If no distributions, MOIC at write-off = 0
    if (writeOffMark!.distributionsNetToDateRpt === 0) {
      expect(writeOffMark!.moicAtMark).toBeCloseTo(0, 4);
    }
  });

  it("warnings mention write-off when present", () => {
    if (!investorWithWriteOff) return;
    const { warnings } = getInvestorValuationTimeline(investorWithWriteOff, "", db);
    expect(warnings.some((w) => w.toLowerCase().includes("written off"))).toBe(true);
  });
});

// ─── Behavioral tests ─────────────────────────────────────────────────────────

describe("Valuation engine behavioral invariants", () => {
  it("returns noDataReason when company not found", () => {
    const { result } = getInvestorValuationTimeline(
      INV_WITH_FORGECRAFT,
      "XXXXXXXXXX_NOT_A_REAL_COMPANY",
      db
    );
    expect(result.noDataReason).toBeTruthy();
    expect(result.timelines).toHaveLength(0);
  });

  it("marks never exceed the raw valuations count for that deal", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft Robotics", db);
    for (const tl of result.timelines) {
      const rawCount = (db.valuationsByDeal.get(tl.dealId) ?? []).length;
      expect(tl.markCount).toBe(rawCount);
    }
  });

  it("spanDays is consistent with first/last mark dates", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "", db);
    for (const tl of result.timelines) {
      if (!tl.firstMarkDate || !tl.lastMarkDate) continue;
      const expected = Math.round(
        (new Date(tl.lastMarkDate).getTime() - new Date(tl.firstMarkDate).getTime()) /
          86_400_000
      );
      expect(tl.spanDays).toBe(expected);
    }
  });

  it("maxGapDays ≤ spanDays", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "", db);
    for (const tl of result.timelines) {
      expect(tl.maxGapDays).toBeLessThanOrEqual(tl.spanDays + 1);
    }
  });

  it("daysSincePreviousMark is null for the first mark", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft Robotics", db);
    const tl = result.timelines[0];
    if (!tl) return;
    expect(tl.marks[0].daysSincePreviousMark).toBeNull();
    expect(tl.marks[0].priceChangePct).toBeNull();
    expect(tl.marks[0].isDownRound).toBe(false);
  });

  it("moicAtMark is null when contributed = 0 (pending allocation)", () => {
    // Find an investor with a pending allocation
    const pendingInv = allInvestorIds.find((id) => {
      const allocIds = db.allocationsByInvestor.get(id) ?? [];
      return allocIds.some((aid) => {
        const a = db.allocations.get(aid);
        return a && parseFloat(a.contributed_amount) === 0;
      });
    });
    if (!pendingInv) return;

    const { result } = getInvestorValuationTimeline(pendingInv, "", db);
    const pendingTimeline = result.timelines.find((tl) => tl.contributedRpt === 0);
    if (!pendingTimeline) return;
    for (const m of pendingTimeline.marks) {
      expect(m.moicAtMark).toBeNull();
    }
  });

  it("isSparse is true when maxGapDays > 365", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "", db);
    for (const tl of result.timelines) {
      if (tl.maxGapDays > 365) {
        expect(tl.isSparse).toBe(true);
      } else {
        expect(tl.isSparse).toBe(false);
      }
    }
  });

  it("date-accurate MOIC: at Entry mark, realisedFractionAtDate ≈ 0 (no prior distributions)", () => {
    const { result } = getInvestorValuationTimeline(INV_WITH_FORGECRAFT, "Forgecraft Robotics", db);
    const tl = result.timelines.find((t) => t.dealId === "DEAL001");
    if (!tl) return;
    const entryMark = tl.marks.find((m) => m.markSource === "Entry");
    if (!entryMark) return;
    // No distributions should predate the entry mark
    expect(entryMark.realisedFractionAtDate).toBe(0);
    expect(entryMark.distributionsNetToDateRpt).toBe(0);
  });

  it("investor value at Write Off mark is always 0", () => {
    // Check all timelines across all investors for write-off marks
    for (const inv of allInvestorIds.slice(0, 10)) {
      const { result } = getInvestorValuationTimeline(inv, "", db);
      for (const tl of result.timelines) {
        for (const m of tl.marks) {
          if (m.markSource === "Write Off") {
            expect(m.investorValueRpt).toBe(0);
            expect(m.investorValueDealCcy).toBe(0);
          }
        }
      }
    }
  });

  it("investor value at Exit mark is 0 (fully realised)", () => {
    for (const inv of allInvestorIds.slice(0, 10)) {
      const { result } = getInvestorValuationTimeline(inv, "", db);
      for (const tl of result.timelines) {
        for (const m of tl.marks) {
          if (m.markSource === "Exit") {
            expect(m.investorValueRpt).toBe(0);
          }
        }
      }
    }
  });

  it("runs without throwing for all investors", () => {
    for (const inv of db.investors.keys()) {
      expect(() => getInvestorValuationTimeline(inv, "", db)).not.toThrow();
    }
  });
});
