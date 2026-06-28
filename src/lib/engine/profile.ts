import type { Database } from "../data/loader";
import type { EngineResult, InvestorProfileResult, PersonalizationProfile, AnswerStyle } from "./types";
import { deriveSophistication } from "./math";
import { convertCurrency } from "../domain/fx";

const REPORT_DATE = "2026-06-25";

// ─── getInvestorProfile ────────────────────────────────────────────────────────

export function getInvestorProfile(
  investorId: string,
  db: Database
): EngineResult<InvestorProfileResult> {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const age =
    investor.age && investor.age.trim() !== ""
      ? parseFloat(investor.age)
      : null;

  const result: InvestorProfileResult = {
    investorId: investor.investor_id,
    name: investor.investor_name,
    type: investor.investor_type,
    country: investor.country,
    reportingCurrency: investor.reporting_currency,
    kycStatus: investor.kyc_status,
    onboardedDate: investor.onboarded_date,
    email: investor.email,
    age: age !== null && isFinite(age) ? age : null,
    techSavviness: investor.tech_savviness as "Low" | "Medium" | "High",
  };

  const warnings: string[] = [];
  if (investor.kyc_status !== "Verified") {
    warnings.push(`KYC status is ${investor.kyc_status} — this investor may not be cleared for all transactions.`);
  }

  return {
    result,
    evidence: [],
    assumptions: [
      "Profile data sourced directly from the investors.csv dataset.",
      `Dataset as of ${REPORT_DATE}.`,
    ],
    warnings,
  };
}

// ─── getInvestorPersonalizationProfile ────────────────────────────────────────

export function getInvestorPersonalizationProfile(
  investorId: string,
  db: Database
): EngineResult<PersonalizationProfile> {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const allocIds = db.allocationsByInvestor.get(investorId) ?? [];
  const dealCount = allocIds.length;

  const age =
    investor.age && investor.age.trim() !== ""
      ? parseFloat(investor.age)
      : null;

  const techSavviness = investor.tech_savviness as "Low" | "Medium" | "High";
  const sophisticationLevel = deriveSophistication(
    techSavviness,
    dealCount,
    age !== null && isFinite(age) ? age : null
  );

  // Sector breakdown
  const sectorCommitments = new Map<string, number>();
  const rptCcy = investor.reporting_currency;
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
    totalCommittedRpt += commitmentRpt;
    sectorCommitments.set(
      company.sector,
      (sectorCommitments.get(company.sector) ?? 0) + commitmentRpt
    );
  }

  const sortedSectors = [...sectorCommitments.entries()]
    .sort((a, b) => b[1] - a[1]);

  const primarySectors = sortedSectors.slice(0, 3).map(([s]) => s);

  const dominantSector =
    totalCommittedRpt > 0
      ? sortedSectors.find(([, amt]) => amt / totalCommittedRpt > 0.5)?.[0] ?? null
      : null;

  const sectorConcentrationFlag = dominantSector !== null;

  // Answer style: derived from sophistication + age
  const answerStyle: AnswerStyle =
    sophisticationLevel === "Experienced"
      ? "concise"
      : sophisticationLevel === "Emerging"
      ? "explanatory"
      : "balanced";

  // Jargon: explain for Emerging, don't for Experienced
  const explainJargon = sophisticationLevel === "Emerging";

  const warnings: string[] = [];
  if (sectorConcentrationFlag && dominantSector) {
    warnings.push(
      `High sector concentration: ${dominantSector} accounts for more than 50% of committed capital.`
    );
  }
  if (dealCount === 0) {
    warnings.push("Investor has no allocations — cannot derive sector or deal context.");
  }

  return {
    result: {
      investorId,
      name: investor.investor_name,
      age: age !== null && isFinite(age) ? age : null,
      techSavviness,
      dealCount,
      sophisticationLevel,
      primarySectors,
      sectorConcentrationFlag,
      answerStyle,
      explainJargon,
      reportingCurrency: rptCcy,
    },
    evidence: [],
    assumptions: [
      "Sophistication level is a heuristic: Experienced = High tech_savviness OR ≥5 deals; Emerging = Low tech_savviness OR age ≥65 OR ≤1 deal; Established = all other cases.",
      "Sector concentration uses committed capital (not contributed), in reporting currency.",
      "Primary sectors are the top 3 by committed capital.",
    ],
    warnings,
  };
}
