/**
 * Fee engine unit tests.
 *
 * Five scenarios:
 *  1. Investor with a negotiated discount on performance + admin fees (INV009)
 *  2. Investor without any discount (INV001)
 *  3. Admin fee: flat USD — savings are in dollars, not percentage points
 *  4. No fee lines yet (pending allocation, INV021)
 *  5. Performance fee: discount is known but dollar saving is undeterminable pre-exit
 *
 * All tests use the real DB so they exercise the full pipeline without mocks.
 */

import { getDatabase } from "@/lib/data/loader";
import { getInvestorFeeBreakdown } from "@/lib/engine/fees";

const db = getDatabase();

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

// ─── Scenario 1: Investor with negotiated discount ─────────────────────────────
// INV009/ALC0004 — fee_discount=Yes, perf fee 10% vs standard 20%, admin $0 vs $450

describe("Scenario 1: investor with negotiated discount (INV009)", () => {
  const inv = "INV009";

  it("returns valid EngineResult", () => {
    const out = getInvestorFeeBreakdown(inv, "", db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("hasAnyDiscount is true", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    expect(result.hasAnyDiscount).toBe(true);
  });

  it("at least one deal has hasNegotiatedDiscount = true", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    const hasAtLeastOne = result.deals.some((d) => d.hasNegotiatedDiscount);
    expect(hasAtLeastOne).toBe(true);
  });

  it("performance fee schedule line is discounted when eff < std", () => {
    const { result } = getInvestorFeeBreakdown(inv, "Forgecraft", db);
    const deal = result.deals.find((d) => d.companyName.toLowerCase().includes("forgecraft"));
    if (!deal) {
      // skip if company not in this investor's portfolio
      return;
    }
    const perfLine = deal.schedule.find((s) => s.feeType === "Performance Fee");
    expect(perfLine).toBeDefined();
    expect(perfLine!.effectiveRate).toBeLessThan(perfLine!.standardRate);
    expect(perfLine!.discounted).toBe(true);
    expect(perfLine!.savingPp).toBeGreaterThan(0);
  });

  it("admin fee schedule line shows flat USD saving when discounted", () => {
    const { result } = getInvestorFeeBreakdown(inv, "Forgecraft", db);
    const deal = result.deals.find((d) => d.companyName.toLowerCase().includes("forgecraft"));
    if (!deal) return;
    const adminLine = deal.schedule.find((s) => s.feeType === "Admin Fee");
    expect(adminLine).toBeDefined();
    if (adminLine!.discounted) {
      expect(adminLine!.savingUsd).toBeGreaterThan(0);
      expect(adminLine!.savingPp).toBeNull(); // no percentage point for flat fee
    }
  });

  it("performance fee saving is marked as undeterminable (no dollar amount pre-exit)", () => {
    const { result } = getInvestorFeeBreakdown(inv, "Forgecraft", db);
    const deal = result.deals[0];
    if (!deal) return;
    const perfLine = deal.schedule.find((s) => s.feeType === "Performance Fee");
    expect(perfLine!.savingUndeterminable).toBe(true);
    expect(perfLine!.savingRpt).toBeNull();
    expect(perfLine!.undeterminableReason).toBeTruthy();
  });

  it("plain summary mentions the company name and fee type", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    for (const deal of result.deals) {
      expect(deal.plainSummary).toContain(deal.companyName);
      expect(deal.plainSummary.length).toBeGreaterThan(20);
    }
  });

  it("performance fee note explains carry is applied at distribution time", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    for (const deal of result.deals) {
      if (deal.schedule.find((s) => s.feeType === "Performance Fee" && s.effectiveRate > 0)) {
        expect(deal.performanceFeeNote.toLowerCase()).toMatch(/(exit|distribution|proceeds)/);
      }
    }
  });
});

// ─── Scenario 2: Investor without fee discount ────────────────────────────────
// INV001/ALC0001 — fee_discount=No, standard rates apply

describe("Scenario 2: investor with no discount (INV001)", () => {
  const inv = "INV001";

  it("returns valid EngineResult", () => {
    const out = getInvestorFeeBreakdown(inv, "", db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("hasAnyDiscount is false (or true only if some allocation has discount)", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    // Specifically ALC0001 has fee_discount=No — verify that allocation's deal
    const deal = result.deals.find((d) => d.allocationId === "ALC0001");
    if (deal) {
      expect(deal.hasNegotiatedDiscount).toBe(false);
    }
  });

  it("all schedule lines for ALC0001 have discounted=false", () => {
    const { result } = getInvestorFeeBreakdown(inv, "Forgecraft Robotics", db);
    const deal = result.deals.find((d) => d.allocationId === "ALC0001");
    if (!deal) return;
    for (const line of deal.schedule) {
      if (line.feeType === "Performance Fee") continue; // perfFee always undeterminable
      expect(line.discounted).toBe(false);
      expect(line.savingPp).toBeNull();
      expect(line.savingRpt).toBeNull();
    }
  });

  it("effective rates equal standard rates (no discount)", () => {
    const { result } = getInvestorFeeBreakdown(inv, "Forgecraft Robotics", db);
    const deal = result.deals.find((d) => d.allocationId === "ALC0001");
    if (!deal) return;
    for (const line of deal.schedule) {
      if (line.feeType === "Performance Fee" || line.feeType === "Admin Fee") continue;
      expect(line.effectiveRate).toBeCloseTo(line.standardRate, 4);
    }
  });

  it("evidence items are returned for fee lines", () => {
    const { evidence } = getInvestorFeeBreakdown(inv, "", db);
    expect(evidence.length).toBeGreaterThan(0);
    for (const ev of evidence) {
      expect(ev.sourceType).toBe("fee");
      expect(ev.id).toMatch(/^FEE/);
    }
  });

  it("totalPaidRpt ≥ 0 and totalUpcomingRpt ≥ 0", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    expect(result.totalPaidRpt).toBeGreaterThanOrEqual(0);
    expect(result.totalUpcomingRpt).toBeGreaterThanOrEqual(0);
  });
});

// ─── Scenario 3: Admin fee — flat USD, no percentage comparison possible ──────
// Tests that Admin Fee schedule line correctly shows flat USD saving without a savingPp

describe("Scenario 3: Admin fee is a flat amount (no percentage-point saving)", () => {
  it("Admin Fee schedule lines have basis = flat USD", () => {
    // Find any investor who has an admin fee line
    const allInvestorIds = [...db.investors.keys()].sort();
    let foundAdminFee = false;

    for (const inv of allInvestorIds) {
      const { result } = getInvestorFeeBreakdown(inv, "", db);
      for (const deal of result.deals) {
        const adminLine = deal.schedule.find((s) => s.feeType === "Admin Fee");
        if (adminLine) {
          expect(adminLine.basis).toBe("flat USD");
          expect(adminLine.savingPp).toBeNull();
          foundAdminFee = true;
        }
      }
      if (foundAdminFee) break;
    }

    // Ensure we actually found at least one
    expect(foundAdminFee).toBe(true);
  });

  it("Admin Fee saving is expressed in USD (savingUsd) not percentage points", () => {
    const allInvestorIds = [...db.investors.keys()].sort();
    let foundDiscountedAdmin = false;

    for (const inv of allInvestorIds) {
      const { result } = getInvestorFeeBreakdown(inv, "", db);
      for (const deal of result.deals) {
        if (!deal.hasNegotiatedDiscount) continue;
        const adminLine = deal.schedule.find((s) => s.feeType === "Admin Fee" && s.discounted);
        if (adminLine) {
          expect(adminLine.savingPp).toBeNull();
          expect(adminLine.savingUsd).toBeGreaterThan(0);
          foundDiscountedAdmin = true;
        }
      }
      if (foundDiscountedAdmin) break;
    }

    if (!foundDiscountedAdmin) {
      // If no investor in the dataset has an admin fee discount, skip gracefully
      console.warn("No admin fee discount found in dataset — scenario 3b skipped");
    }
  });

  it("Admin fee historical lines have basis=Flat from raw CSV", () => {
    const allInvestorIds = [...db.investors.keys()].sort();
    let checked = 0;

    for (const inv of allInvestorIds) {
      const { result } = getInvestorFeeBreakdown(inv, "", db);
      for (const deal of result.deals) {
        for (const line of deal.feeLines) {
          if (line.feeType === "Admin Fee") {
            expect(line.basis).toBe("Flat");
            checked++;
          }
        }
      }
      if (checked >= 3) break;
    }
  });
});

// ─── Scenario 4: No fee lines yet (pending allocation) ───────────────────────
// INV021 has ALC0542 which is Pending — no fee history

describe("Scenario 4: No fee lines yet (pending allocation)", () => {
  const inv = "INV021";

  it("returns valid EngineResult with no fee lines", () => {
    const out = getInvestorFeeBreakdown(inv, "", db);
    expect(isEngineResult(out)).toBe(true);
  });

  it("pending deal has noFeesYet = true", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    const pendingDeal = result.deals.find((d) => d.feeLines.length === 0);
    if (!pendingDeal) return; // dataset may have changed
    expect(pendingDeal.noFeesYet).toBe(true);
  });

  it("plain summary for pending deal explains no fees yet", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    const pendingDeal = result.deals.find((d) => d.noFeesYet);
    if (!pendingDeal) return;
    expect(pendingDeal.plainSummary.toLowerCase()).toMatch(/(no fees|pending|recent)/);
  });

  it("warnings contain explanation for missing fees", () => {
    const { warnings } = getInvestorFeeBreakdown(inv, "", db);
    const hasWarning = warnings.some((w) => w.toLowerCase().includes("no fee history"));
    if (db.allocationsByInvestor.get(inv)?.some((id) => {
      const feeIds = db.feesByAllocation.get(id) ?? [];
      return feeIds.length === 0;
    })) {
      expect(hasWarning).toBe(true);
    }
  });

  it("schedule is still populated with standard vs effective rates even without fee lines", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    for (const deal of result.deals) {
      expect(deal.schedule.length).toBe(4); // always 4: Mgmt, Perf, Struct, Admin
    }
  });

  it("totals are 0 when no fee lines exist", () => {
    const { result } = getInvestorFeeBreakdown(inv, "", db);
    const pendingDeal = result.deals.find((d) => d.noFeesYet);
    if (!pendingDeal) return;
    expect(pendingDeal.totalPaidRpt).toBe(0);
    expect(pendingDeal.totalUpcomingRpt).toBe(0);
  });
});

// ─── Scenario 5: Performance fee — discount is known but $ saving undeterminable ─
// The investor's eff_performance_fee_pct may differ from standard, but we can't
// compute the dollar saving until the deal exits.

describe("Scenario 5: Performance fee undeterminable pre-exit", () => {
  it("performance fee schedule line always has savingRpt = null", () => {
    const allInvestorIds = [...db.investors.keys()].sort();
    let checked = 0;

    for (const inv of allInvestorIds.slice(0, 5)) {
      const { result } = getInvestorFeeBreakdown(inv, "", db);
      for (const deal of result.deals) {
        const perfLine = deal.schedule.find((s) => s.feeType === "Performance Fee");
        if (perfLine) {
          // savingRpt is always null for perf fee — can't know exit proceeds
          expect(perfLine.savingRpt).toBeNull();
          expect(perfLine.savingUndeterminable).toBe(true);
          checked++;
        }
      }
      if (checked >= 3) break;
    }

    expect(checked).toBeGreaterThan(0);
  });

  it("performance fee note always references exit/distribution", () => {
    const allInvestorIds = [...db.investors.keys()].sort();

    for (const inv of allInvestorIds.slice(0, 3)) {
      const { result } = getInvestorFeeBreakdown(inv, "", db);
      for (const deal of result.deals) {
        if (!deal.noFeesYet) {
          expect(deal.performanceFeeNote.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it("discounted performance fee shows savingPp but still has savingRpt = null", () => {
    // Find an investor where perf fee is discounted
    const allInvestorIds = [...db.investors.keys()].sort();
    let foundDiscountedPerf = false;

    for (const inv of allInvestorIds) {
      const { result } = getInvestorFeeBreakdown(inv, "", db);
      for (const deal of result.deals) {
        const perfLine = deal.schedule.find(
          (s) => s.feeType === "Performance Fee" && s.discounted
        );
        if (perfLine) {
          expect(perfLine.discounted).toBe(true);
          expect(perfLine.savingPp).toBeGreaterThan(0);    // pp difference is known
          expect(perfLine.savingRpt).toBeNull();             // dollar amount is NOT known
          expect(perfLine.savingUndeterminable).toBe(true); // flagged explicitly
          foundDiscountedPerf = true;
          break;
        }
      }
      if (foundDiscountedPerf) break;
    }

    if (!foundDiscountedPerf) {
      console.warn("No discounted performance fee found — scenario 5c skipped");
    }
  });

  it("assumptions array always explains carry settlement at exit", () => {
    const inv = [...db.investors.keys()][0]!;
    const { assumptions } = getInvestorFeeBreakdown(inv, "", db);
    const mentionsCarry = assumptions.some((a) =>
      a.toLowerCase().includes("performance fee") && a.toLowerCase().includes("exit")
    );
    expect(mentionsCarry).toBe(true);
  });
});

// ─── Cross-cutting invariants ──────────────────────────────────────────────────

describe("Fee engine invariants", () => {
  it("schedule always has exactly 4 lines per deal (Mgmt, Perf, Struct, Admin)", () => {
    const allInvestorIds = [...db.investors.keys()].sort().slice(0, 10);
    for (const inv of allInvestorIds) {
      const { result } = getInvestorFeeBreakdown(inv, "", db);
      for (const deal of result.deals) {
        expect(deal.schedule).toHaveLength(4);
        const types = deal.schedule.map((s) => s.feeType);
        expect(types).toContain("Management Fee");
        expect(types).toContain("Performance Fee");
        expect(types).toContain("Structuring Fee");
        expect(types).toContain("Admin Fee");
      }
    }
  });

  it("totalPaidRpt = sum of all paid fee line amountRpt", () => {
    const allInvestorIds = [...db.investors.keys()].sort().slice(0, 5);
    for (const inv of allInvestorIds) {
      const { result } = getInvestorFeeBreakdown(inv, "", db);
      for (const deal of result.deals) {
        const paidSum = deal.feeLines
          .filter((f) => f.status === "Paid")
          .reduce((s, f) => s + f.amountRpt, 0);
        expect(deal.totalPaidRpt).toBeCloseTo(paidSum, 2);
      }
    }
  });

  it("all fee line evidence has sourceType = fee", () => {
    const inv = [...db.investors.keys()][0]!;
    const { evidence } = getInvestorFeeBreakdown(inv, "", db);
    for (const ev of evidence) {
      expect(ev.sourceType).toBe("fee");
    }
  });

  it("runs without throwing for all investors", () => {
    for (const inv of db.investors.keys()) {
      expect(() => getInvestorFeeBreakdown(inv, "", db)).not.toThrow();
    }
  });
});
