import type { Database } from "../data/loader";
import type { DistributionSummary } from "../domain/types";
import type { EngineResult } from "./types";
import { getDistributions } from "../domain/distributions";
import { fmt } from "../domain/fx";

const REPORT_DATE = "2026-06-25";

export function getInvestorDistributions(
  investorId: string,
  db: Database
): EngineResult<DistributionSummary> {
  const raw = getDistributions(investorId, db);
  const warnings: string[] = [];

  if (raw.distributions.length === 0) {
    warnings.push("No distributions found for this investor.");
    return {
      result: raw,
      evidence: [],
      assumptions: [
        "Distributions include both Exit Proceeds (full or partial exits) and Secondary Sales.",
        "Net amount = Gross − Performance fee (carry).",
      ],
      warnings,
    };
  }

  // Exits vs secondary sales breakdown
  const exits = raw.distributions.filter((d) => d.type === "Exit Proceeds");
  const secondaries = raw.distributions.filter((d) => d.type === "Secondary Sale");
  if (exits.length > 0 && secondaries.length > 0) {
    warnings.push(
      `Mixed distribution types: ${exits.length} exit event(s) and ${secondaries.length} secondary sale(s).`
    );
  }

  // High carry warning (any distribution with carry > 25%)
  const highCarry = raw.distributions.filter((d) => d.performanceFeePct > 25);
  if (highCarry.length > 0) {
    const items = highCarry
      .map((d) => `${d.companyName} ${d.round} (${d.performanceFeePct}%)`)
      .join(", ");
    warnings.push(`Performance fee above 25% on: ${items}.`);
  }

  // FX warning
  const distCcys = new Set(raw.distributions.map((d) => d.dealCurrency));
  distCcys.delete(raw.reportingCurrency);
  if (distCcys.size > 0) {
    warnings.push(
      `Distribution currencies [${[...distCcys].join(", ")}] converted to ${raw.reportingCurrency} at static rates as of ${REPORT_DATE}.`
    );
  }

  // Effective carry rate across all distributions
  const totalCarry = raw.totalPerformanceFeeRpt;
  const totalGross = raw.totalGrossRpt;
  if (totalGross > 0) {
    const effectiveCarryPct = (totalCarry / totalGross) * 100;
    if (effectiveCarryPct > 0) {
      warnings.push(
        `Effective carry rate across all distributions: ${effectiveCarryPct.toFixed(1)}% (${fmt(totalCarry, raw.reportingCurrency)} of ${fmt(totalGross, raw.reportingCurrency)} gross).`
      );
    }
  }

  return {
    result: raw,
    evidence: raw.evidence,
    assumptions: [
      `Report date: ${REPORT_DATE}.`,
      "Distributions sorted most-recent-first.",
      "Net amount = Gross − Performance fee (carry). Carry % varies per investor allocation agreement.",
      "fraction_of_units: the share of the original position sold in each event. 1.0 = full exit.",
      "All amounts converted to reporting currency via USD bridge at static rates.",
    ],
    warnings,
  };
}
