/**
 * Pure deterministic math tests — no DB, no I/O.
 *
 * Every formula used by the engine is unit-tested here with known inputs and
 * expected outputs so regressions surface immediately. If a formula changes,
 * these tests will catch it.
 */

import {
  computeMoic,
  computeUnrealisedFraction,
  computeCurrentValue,
  bridgeConvert,
  computeWeightedAvgPrice,
  computeSectorConcentration,
  deriveSophistication,
} from "@/lib/engine/math";

// ─── computeMoic ──────────────────────────────────────────────────────────────

describe("computeMoic", () => {
  it("returns null when contributed is 0 (pending allocation)", () => {
    expect(computeMoic(100, 50, 0)).toBeNull();
  });

  it("returns null when contributed is negative", () => {
    expect(computeMoic(100, 50, -10)).toBeNull();
  });

  it("computes 1.00× for break-even", () => {
    // contributed = 100, current = 80, distributions = 20 → (80+20)/100 = 1.00
    expect(computeMoic(80, 20, 100)).toBeCloseTo(1.0, 5);
  });

  it("computes 2.50× for a 2.5× return", () => {
    // contributed = 100, current = 200, distributions = 50 → (200+50)/100 = 2.5
    expect(computeMoic(200, 50, 100)).toBeCloseTo(2.5, 5);
  });

  it("computes < 1.00× for a loss position", () => {
    // contributed = 100, current = 40, distributions = 0 → 40/100 = 0.4
    expect(computeMoic(40, 0, 100)).toBeCloseTo(0.4, 5);
  });

  it("computes 0.00× for a total write-off (current = 0, no distributions)", () => {
    expect(computeMoic(0, 0, 100)).toBeCloseTo(0, 5);
  });

  it("includes distributions in numerator", () => {
    // Exited deal: current = 0, distributions = 250, contributed = 100 → 2.5×
    expect(computeMoic(0, 250, 100)).toBeCloseTo(2.5, 5);
  });
});

// ─── computeUnrealisedFraction ────────────────────────────────────────────────

describe("computeUnrealisedFraction", () => {
  it("returns 1.0 when no distributions (full position held)", () => {
    expect(computeUnrealisedFraction([])).toBeCloseTo(1.0, 5);
  });

  it("returns 0.6 after 40% distributed", () => {
    expect(computeUnrealisedFraction([0.4])).toBeCloseTo(0.6, 5);
  });

  it("returns 0.0 when 100% distributed (full exit)", () => {
    expect(computeUnrealisedFraction([1.0])).toBeCloseTo(0.0, 5);
  });

  it("returns 0.0 when multiple distributions sum to 100%", () => {
    expect(computeUnrealisedFraction([0.3, 0.4, 0.3])).toBeCloseTo(0.0, 5);
  });

  it("clamps to 0 if distributions exceed 100% (data anomaly)", () => {
    expect(computeUnrealisedFraction([0.6, 0.6])).toBe(0);
  });

  it("handles partial secondary sale (40% sold → 60% remains)", () => {
    expect(computeUnrealisedFraction([0.4])).toBeCloseTo(0.6, 5);
  });

  it("handles two partial distributions", () => {
    // 25% + 35% = 60% realised → 40% remaining
    expect(computeUnrealisedFraction([0.25, 0.35])).toBeCloseTo(0.4, 5);
  });
});

// ─── computeCurrentValue ─────────────────────────────────────────────────────

describe("computeCurrentValue", () => {
  it("returns 0 for exited deals regardless of share price", () => {
    expect(computeCurrentValue(1000, 50, 1.0, "Exited")).toBe(0);
  });

  it("returns 0 for written-off deals", () => {
    expect(computeCurrentValue(1000, 1.0, 1.0, "Written Off")).toBe(0);
  });

  it("returns 0 when share price is null (no valuation)", () => {
    expect(computeCurrentValue(1000, null, 1.0, "Active")).toBe(0);
  });

  it("computes full value when no distributions", () => {
    // 1000 units × £10 × 1.0 unrealised = £10,000
    expect(computeCurrentValue(1000, 10, 1.0, "Active")).toBeCloseTo(10_000, 2);
  });

  it("computes partial value after 40% distributed", () => {
    // 1000 units × £10 × 0.6 unrealised = £6,000
    expect(computeCurrentValue(1000, 10, 0.6, "Active")).toBeCloseTo(6_000, 2);
  });

  it("returns 0 when fully distributed (unrealised = 0)", () => {
    expect(computeCurrentValue(1000, 10, 0.0, "Active")).toBe(0);
  });

  it("handles fractional units correctly", () => {
    expect(computeCurrentValue(123.456, 2.5, 0.8, "Active")).toBeCloseTo(
      123.456 * 2.5 * 0.8,
      4
    );
  });
});

// ─── bridgeConvert (FX) ───────────────────────────────────────────────────────

describe("bridgeConvert", () => {
  const rates = new Map([
    ["USD", 1.0],
    ["GBP", 1.27],
    ["EUR", 1.08],
    ["AED", 0.2723],
  ]);

  it("returns amount unchanged when currencies are identical", () => {
    const { value, ratesMissing } = bridgeConvert(100, "USD", "USD", rates);
    expect(value).toBe(100);
    expect(ratesMissing).toBe(false);
  });

  it("USD to GBP: 100 USD → ~78.74 GBP", () => {
    // 100 × 1.0 / 1.27 = 78.74
    const { value, ratesMissing } = bridgeConvert(100, "USD", "GBP", rates);
    expect(ratesMissing).toBe(false);
    expect(value).toBeCloseTo(100 / 1.27, 4);
  });

  it("GBP to USD: 100 GBP → 127 USD", () => {
    const { value } = bridgeConvert(100, "GBP", "USD", rates);
    expect(value).toBeCloseTo(127, 3);
  });

  it("GBP to EUR round-trip via bridge", () => {
    // 100 GBP → USD → EUR: 100 × 1.27 / 1.08
    const { value } = bridgeConvert(100, "GBP", "EUR", rates);
    expect(value).toBeCloseTo((100 * 1.27) / 1.08, 4);
  });

  it("AED to USD", () => {
    const { value } = bridgeConvert(100, "AED", "USD", rates);
    expect(value).toBeCloseTo(100 * 0.2723, 4);
  });

  it("returns ratesMissing=true for unknown currency", () => {
    const { value, ratesMissing } = bridgeConvert(100, "JPY", "USD", rates);
    expect(ratesMissing).toBe(true);
    expect(value).toBe(100); // unchanged
  });

  it("USD round-trip: USD → GBP → USD is approximately identity", () => {
    const { value: gbp } = bridgeConvert(100, "USD", "GBP", rates);
    const { value: usd } = bridgeConvert(gbp, "GBP", "USD", rates);
    expect(usd).toBeCloseTo(100, 4);
  });
});

// ─── computeWeightedAvgPrice ──────────────────────────────────────────────────

describe("computeWeightedAvgPrice", () => {
  it("returns null when no capital contributed", () => {
    expect(computeWeightedAvgPrice([{ contributed: 0, effectiveSharePrice: 10 }])).toBeNull();
  });

  it("returns the single round price when only one round", () => {
    expect(
      computeWeightedAvgPrice([{ contributed: 100, effectiveSharePrice: 5 }])
    ).toBeCloseTo(5, 5);
  });

  it("weights by contributed capital across rounds", () => {
    // Round A: 200 at price 10. Round B: 100 at price 20.
    // Weighted avg = (200×10 + 100×20) / (200+100) = (2000+2000)/300 = 4000/300 ≈ 13.33
    const result = computeWeightedAvgPrice([
      { contributed: 200, effectiveSharePrice: 10 },
      { contributed: 100, effectiveSharePrice: 20 },
    ]);
    expect(result).toBeCloseTo(4000 / 300, 4);
  });

  it("handles three rounds correctly", () => {
    // 100 at £2, 200 at £4, 300 at £6
    // = (100×2 + 200×4 + 300×6) / 600 = (200+800+1800)/600 = 2800/600 ≈ 4.667
    const result = computeWeightedAvgPrice([
      { contributed: 100, effectiveSharePrice: 2 },
      { contributed: 200, effectiveSharePrice: 4 },
      { contributed: 300, effectiveSharePrice: 6 },
    ]);
    expect(result).toBeCloseTo(2800 / 600, 4);
  });
});

// ─── computeSectorConcentration ───────────────────────────────────────────────

describe("computeSectorConcentration", () => {
  it("returns empty output for empty input", () => {
    const { buckets, dominantSector, herfindahlIndex } =
      computeSectorConcentration([]);
    expect(buckets).toHaveLength(0);
    expect(dominantSector).toBeNull();
    expect(herfindahlIndex).toBe(0);
  });

  it("returns 100% for a single sector", () => {
    const { buckets, dominantSector, herfindahlIndex } =
      computeSectorConcentration([{ sector: "Tech", amount: 500 }]);
    expect(buckets[0].pct).toBeCloseTo(100, 2);
    expect(dominantSector).toBe("Tech");
    expect(herfindahlIndex).toBeCloseTo(1.0, 5);
  });

  it("computes 50/50 split correctly", () => {
    const { buckets, dominantSector, herfindahlIndex } =
      computeSectorConcentration([
        { sector: "Tech", amount: 100 },
        { sector: "Health", amount: 100 },
      ]);
    expect(buckets[0].pct).toBeCloseTo(50, 2);
    expect(buckets[1].pct).toBeCloseTo(50, 2);
    expect(dominantSector).toBeNull(); // neither > 50%
    expect(herfindahlIndex).toBeCloseTo(0.5, 5); // 0.25 + 0.25
  });

  it("identifies a dominant sector when one exceeds 50%", () => {
    const { dominantSector } = computeSectorConcentration([
      { sector: "Tech", amount: 700 },
      { sector: "Health", amount: 300 },
    ]);
    expect(dominantSector).toBe("Tech");
  });

  it("HHI = 1.0 for full concentration", () => {
    const { herfindahlIndex } = computeSectorConcentration([
      { sector: "FinTech", amount: 1000 },
    ]);
    expect(herfindahlIndex).toBeCloseTo(1.0, 5);
  });

  it("HHI approaches 0 for many equal sectors", () => {
    const sectors = Array.from({ length: 10 }, (_, i) => ({
      sector: `Sector${i}`,
      amount: 100,
    }));
    const { herfindahlIndex } = computeSectorConcentration(sectors);
    expect(herfindahlIndex).toBeCloseTo(0.1, 4); // 10 × (0.1)² = 0.1
  });

  it("buckets are sorted by amount descending", () => {
    const { buckets } = computeSectorConcentration([
      { sector: "A", amount: 100 },
      { sector: "B", amount: 400 },
      { sector: "C", amount: 200 },
    ]);
    expect(buckets[0].sector).toBe("B");
    expect(buckets[1].sector).toBe("C");
    expect(buckets[2].sector).toBe("A");
  });

  it("percentages sum to 100", () => {
    const { buckets } = computeSectorConcentration([
      { sector: "A", amount: 300 },
      { sector: "B", amount: 200 },
      { sector: "C", amount: 500 },
    ]);
    const total = buckets.reduce((s, b) => s + b.pct, 0);
    expect(total).toBeCloseTo(100, 4);
  });
});

// ─── deriveSophistication ─────────────────────────────────────────────────────

describe("deriveSophistication", () => {
  it("Experienced when techSavviness = High", () => {
    expect(deriveSophistication("High", 1, null)).toBe("Experienced");
  });

  it("Experienced when dealCount >= 5 regardless of tech savviness", () => {
    expect(deriveSophistication("Low", 5, null)).toBe("Experienced");
    expect(deriveSophistication("Medium", 10, 40)).toBe("Experienced");
  });

  it("Emerging when techSavviness = Low", () => {
    expect(deriveSophistication("Low", 3, null)).toBe("Emerging");
  });

  it("Emerging when dealCount <= 1", () => {
    expect(deriveSophistication("Medium", 1, null)).toBe("Emerging");
    expect(deriveSophistication("Medium", 0, null)).toBe("Emerging");
  });

  it("Emerging when age >= 65 (regardless of tech savviness)", () => {
    expect(deriveSophistication("Medium", 3, 65)).toBe("Emerging");
    expect(deriveSophistication("Medium", 3, 70)).toBe("Emerging");
  });

  it("Established for medium savviness, 2-4 deals, age < 65", () => {
    expect(deriveSophistication("Medium", 3, 45)).toBe("Established");
    expect(deriveSophistication("Medium", 4, null)).toBe("Established");
  });

  it("Experienced overrides age >= 65 if High tech savviness", () => {
    // High tech savviness always → Experienced, even if old
    expect(deriveSophistication("High", 1, 70)).toBe("Experienced");
  });
});
