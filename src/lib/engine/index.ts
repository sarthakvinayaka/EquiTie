/**
 * Deterministic Investor Portfolio Engine — public API.
 *
 * All financial calculations happen in code before any LLM is called.
 * Every function returns EngineResult<T>: { result, evidence, assumptions, warnings }
 *
 * Usage (server-side only — functions need the Database singleton):
 *
 *   import { getInvestorPortfolioOverview } from "@/lib/engine";
 *   import { getDatabase } from "@/lib/data/loader";
 *
 *   const db = getDatabase();
 *   const { result, evidence, assumptions, warnings } =
 *     getInvestorPortfolioOverview("INV001", db);
 */

export type { EngineResult, InvestorProfileResult, PersonalizationProfile, SectorConcentration, SectorBucket, SophisticationLevel, AnswerStyle } from "./types";
export type { StatementSummaryResult, StatementGroup } from "./statement";

export { getInvestorProfile, getInvestorPersonalizationProfile } from "./profile";
export {
  getInvestorPortfolioOverview,
  getInvestorPositions,
  getInvestorPositionByCompany,
} from "./portfolio";
export { getInvestorUpcomingObligations } from "./obligations";
export { getInvestorDistributions } from "./distributions";
export { getInvestorStatementSummary } from "./statement";
export { getInvestorSectorConcentration } from "./concentration";
export { getInvestorFeeBreakdown } from "./fees";
export type { FeeBreakdownResult, DealFeeResult, FeeScheduleLine, HistoricalFeeLine } from "./fees";

// Re-export math utilities for testing
export {
  computeMoic,
  computeUnrealisedFraction,
  computeCurrentValue,
  bridgeConvert,
  computeWeightedAvgPrice,
  computeSectorConcentration,
  deriveSophistication,
} from "./math";
