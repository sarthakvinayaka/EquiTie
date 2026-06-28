/**
 * Pure deterministic math functions — no I/O, no DB, no side effects.
 * Every financial number produced by the engine passes through these.
 * Tested independently in calculations.test.ts.
 */

// ─── MOIC ──────────────────────────────────────────────────────────────────────

/**
 * Money-on-invested-capital.
 * Returns null when no capital has been contributed (pending allocation).
 *
 * Formula: (currentValue + netDistributions) / contributed
 */
export function computeMoic(
  currentValueRpt: number,
  distributionsNetRpt: number,
  contributedRpt: number
): number | null {
  if (contributedRpt <= 0) return null;
  return (currentValueRpt + distributionsNetRpt) / contributedRpt;
}

// ─── Unrealised fraction ───────────────────────────────────────────────────────

/**
 * Fraction of the original position still held (not yet realised via distributions).
 * Clamped to [0, 1] — can never be negative even if fractions sum > 1 due to data issue.
 *
 * realisedFractions: array of fraction_of_units from each distribution row.
 */
export function computeUnrealisedFraction(realisedFractions: number[]): number {
  const realised = realisedFractions.reduce((sum, f) => sum + f, 0);
  return Math.max(0, Math.min(1, 1 - realised));
}

// ─── Current unrealised value ──────────────────────────────────────────────────

/**
 * Current fair value of the unrealised portion of a position.
 *
 * Rules:
 *  - Only Active deals have unrealised value (Exited/Written Off = 0)
 *  - If no latest valuation exists, value = 0 (and caller should warn)
 *  - Value = units × latestSharePrice × unrealisedFraction
 */
export function computeCurrentValue(
  units: number,
  latestSharePrice: number | null,
  unrealisedFraction: number,
  dealStatus: string
): number {
  if (dealStatus !== "Active") return 0;
  if (latestSharePrice === null) return 0;
  return units * latestSharePrice * unrealisedFraction;
}

// ─── FX conversion ─────────────────────────────────────────────────────────────

/**
 * Convert an amount from one currency to another via USD as the bridge currency.
 *
 * rates: currency → to_usd (e.g. "GBP" → 1.27 means 1 GBP = 1.27 USD).
 *
 * Formula: amount × fromRate / toRate
 * Edge cases:
 *  - Same currency: identity
 *  - Missing rate: returns amount unchanged (caller should warn)
 */
export function bridgeConvert(
  amount: number,
  fromCcy: string,
  toCcy: string,
  rates: ReadonlyMap<string, number>
): { value: number; ratesMissing: boolean } {
  if (fromCcy === toCcy) return { value: amount, ratesMissing: false };

  const fromRate = rates.get(fromCcy);
  const toRate = rates.get(toCcy);

  if (!fromRate || !toRate) {
    return { value: amount, ratesMissing: true };
  }

  return { value: (amount * fromRate) / toRate, ratesMissing: false };
}

// ─── Weighted average price ────────────────────────────────────────────────────

/**
 * Weighted average cost basis across multiple rounds.
 * Weight = contributed capital in a common currency.
 *
 * Returns null if total contributed is 0.
 */
export function computeWeightedAvgPrice(
  rounds: { contributed: number; effectiveSharePrice: number }[]
): number | null {
  const totalContributed = rounds.reduce((s, r) => s + r.contributed, 0);
  if (totalContributed <= 0) return null;

  const weightedSum = rounds.reduce(
    (s, r) => s + r.contributed * r.effectiveSharePrice,
    0
  );
  return weightedSum / totalContributed;
}

// ─── Sector concentration ──────────────────────────────────────────────────────

export interface SectorAmount {
  sector: string;
  amount: number; // in reporting currency
}

export interface ConcentrationOutput {
  buckets: { sector: string; amount: number; pct: number }[];
  dominantSector: string | null;
  herfindahlIndex: number;
}

/**
 * Compute sector concentration statistics.
 *
 * herfindahlIndex (HHI) = sum of squared fractional shares (0–1 scale).
 *   HHI = 1 → one sector holds everything
 *   HHI → 0 → perfectly diversified
 *
 * dominantSector: any sector with > 50% share.
 */
export function computeSectorConcentration(
  sectorAmounts: SectorAmount[]
): ConcentrationOutput {
  const total = sectorAmounts.reduce((s, b) => s + b.amount, 0);
  if (total <= 0) {
    return { buckets: [], dominantSector: null, herfindahlIndex: 0 };
  }

  const buckets = sectorAmounts
    .map((b) => ({
      sector: b.sector,
      amount: b.amount,
      pct: (b.amount / total) * 100,
    }))
    .sort((a, b) => b.amount - a.amount);

  const herfindahlIndex = buckets.reduce(
    (s, b) => s + (b.pct / 100) ** 2,
    0
  );

  const dominantSector =
    buckets.find((b) => b.pct > 50)?.sector ?? null;

  return { buckets, dominantSector, herfindahlIndex };
}

// ─── Personalization heuristic ─────────────────────────────────────────────────

export type SophisticationLevel = "Emerging" | "Established" | "Experienced";

/**
 * Derive investor sophistication from observable signals.
 *
 * Rules (in priority order):
 *  - Experienced: High tech savviness OR ≥5 deals
 *  - Emerging: Low tech savviness OR age ≥65 OR ≤1 deal
 *  - Established: everything else
 */
export function deriveSophistication(
  techSavviness: string,
  dealCount: number,
  age: number | null
): SophisticationLevel {
  if (techSavviness === "High" || dealCount >= 5) return "Experienced";
  if (techSavviness === "Low" || dealCount <= 1 || (age !== null && age >= 65)) {
    return "Emerging";
  }
  return "Established";
}
