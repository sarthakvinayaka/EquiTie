/**
 * Engine layer public types.
 *
 * The engine wraps every domain function in a standardized envelope so that
 * callers (the chat route, tests, API handlers) always receive the same shape:
 *
 *   result      — the computed answer (typed per function)
 *   evidence    — source rows used to produce the answer (for the evidence panel)
 *   assumptions — documented rules the calculation relies on
 *   warnings    — detected anomalies that may affect interpretation
 */

import type { EvidenceItem } from "../domain/types";

export interface EngineResult<T> {
  result: T;
  evidence: EvidenceItem[];
  assumptions: string[];
  warnings: string[];
}

// ─── Profile ───────────────────────────────────────────────────────────────────

export interface InvestorProfileResult {
  investorId: string;
  name: string;
  type: string;
  country: string;
  reportingCurrency: string;
  kycStatus: string;
  onboardedDate: string;
  email: string;
  age: number | null;
  techSavviness: "Low" | "Medium" | "High";
}

// ─── Personalization ───────────────────────────────────────────────────────────

export type SophisticationLevel = "Emerging" | "Established" | "Experienced";
export type AnswerStyle = "concise" | "balanced" | "explanatory";

export interface PersonalizationProfile {
  investorId: string;
  name: string;
  age: number | null;
  techSavviness: "Low" | "Medium" | "High";
  dealCount: number;
  sophisticationLevel: SophisticationLevel;
  primarySectors: string[];
  sectorConcentrationFlag: boolean; // true if any single sector > 50% of committed
  answerStyle: AnswerStyle;
  explainJargon: boolean;
  reportingCurrency: string;
}

// ─── Sector concentration ──────────────────────────────────────────────────────

export interface SectorBucket {
  sector: string;
  allocationCount: number;
  committedRpt: number;
  committedPct: number; // 0–100
}

export interface SectorConcentration {
  reportingCurrency: string;
  totalCommittedRpt: number;
  buckets: SectorBucket[]; // sorted by committedRpt desc
  dominantSector: string | null; // sector with > 50% commitment, or null
  herfindahlIndex: number; // 0–1; higher = more concentrated (sum of squared shares)
}
