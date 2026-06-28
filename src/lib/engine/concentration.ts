import type { Database } from "../data/loader";
import type { EngineResult, SectorConcentration, SectorBucket } from "./types";
import { convertCurrency } from "../domain/fx";
import { computeSectorConcentration } from "./math";

const REPORT_DATE = "2026-06-25";

export function getInvestorSectorConcentration(
  investorId: string,
  db: Database
): EngineResult<SectorConcentration> {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const allocIds = db.allocationsByInvestor.get(investorId) ?? [];
  const warnings: string[] = [];

  // Accumulate committed capital by sector in reporting currency
  const sectorMap = new Map<string, { amount: number; count: number }>();
  let totalCommittedRpt = 0;

  for (const allocId of allocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    const company = db.companies.get(deal.company_id);
    if (!company) continue;

    const commitment = parseFloat(alloc.commitment_amount);
    const commitmentRpt = convertCurrency(
      commitment,
      alloc.deal_currency,
      rptCcy,
      db.fxRates
    );

    const existing = sectorMap.get(company.sector) ?? { amount: 0, count: 0 };
    sectorMap.set(company.sector, {
      amount: existing.amount + commitmentRpt,
      count: existing.count + 1,
    });
    totalCommittedRpt += commitmentRpt;
  }

  if (allocIds.length === 0) {
    warnings.push("No allocations found — sector concentration cannot be computed.");
    return {
      result: {
        reportingCurrency: rptCcy,
        totalCommittedRpt: 0,
        buckets: [],
        dominantSector: null,
        herfindahlIndex: 0,
      },
      evidence: [],
      assumptions: [],
      warnings,
    };
  }

  // Compute concentration metrics
  const sectorAmounts = [...sectorMap.entries()].map(([sector, { amount }]) => ({
    sector,
    amount,
  }));
  const { buckets: rawBuckets, dominantSector, herfindahlIndex } =
    computeSectorConcentration(sectorAmounts);

  const buckets: SectorBucket[] = rawBuckets.map((b) => ({
    sector: b.sector,
    allocationCount: sectorMap.get(b.sector)?.count ?? 0,
    committedRpt: b.amount,
    committedPct: b.pct,
  }));

  // Warnings
  if (dominantSector) {
    const bucket = buckets.find((b) => b.sector === dominantSector);
    warnings.push(
      `High concentration: ${dominantSector} represents ${bucket?.committedPct.toFixed(1)}% of committed capital — consider diversification risk.`
    );
  }

  if (herfindahlIndex > 0.5) {
    warnings.push(
      `HHI = ${herfindahlIndex.toFixed(3)} (above 0.5 threshold) — portfolio is highly concentrated.`
    );
  } else if (herfindahlIndex > 0.25) {
    warnings.push(
      `HHI = ${herfindahlIndex.toFixed(3)} (moderate concentration between 0.25–0.5).`
    );
  }

  const currencies = new Set(
    allocIds
      .map((id) => db.allocations.get(id)?.deal_currency)
      .filter(Boolean) as string[]
  );
  currencies.delete(rptCcy);
  if (currencies.size > 0) {
    warnings.push(
      `Commitment amounts in [${[...currencies].join(", ")}] converted to ${rptCcy} at static FX rates as of ${REPORT_DATE}.`
    );
  }

  return {
    result: {
      reportingCurrency: rptCcy,
      totalCommittedRpt,
      buckets,
      dominantSector,
      herfindahlIndex,
    },
    evidence: [],
    assumptions: [
      "Concentration uses committed capital (not contributed) in reporting currency.",
      "Pending allocations are included — they represent a commitment even if capital hasn't been called.",
      `Herfindahl-Hirschman Index (HHI) = sum of squared sector shares (0–1 scale). HHI > 0.5 = high concentration.`,
      `FX rates fixed at ${REPORT_DATE}.`,
    ],
    warnings,
  };
}
