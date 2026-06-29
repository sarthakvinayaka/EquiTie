import type { PersonalizationProfile } from "../engine/types";
import type { EvidenceItem, ExtractedEntities, QueryIntent } from "../domain/types";

// ─── Key metric ───────────────────────────────────────────────────────────────

export interface KeyMetric {
  label: string;
  value: string;
  subtext?: string;
  sentiment?: "positive" | "negative" | "neutral" | "warning";
}

// ─── Glossary ─────────────────────────────────────────────────────────────────

export interface GlossaryEntry {
  term: string;
  abbreviation?: string;
  shortDef: string;
  formula?: string;
  context?: string;
}

// ─── Normalized evidence ──────────────────────────────────────────────────────

export interface NormalizedEvidence {
  id: string;
  sourceFile: string;
  sourceType: string;
  label: string;
  detail: string;
  fieldsUsed: string[];
  calculationRole: string;
  date?: string;
  amount?: number;
  currency?: string;
}

// ─── Answer object ────────────────────────────────────────────────────────────

export interface AnswerObject {
  title: string;
  conciseAnswer: string;
  keyMetrics: KeyMetric[];
  detailedNarrative: string;
  glossaryTerms: GlossaryEntry[];
  evidenceRefs: NormalizedEvidence[];
  caveats: string[];
  followUpQuestions: string[];
  calculationNote: string | null;
  intent: string;
  personalizationLevel: "Emerging" | "Established" | "Experienced";
  fallbackMode: boolean;
}

// ─── Composer input ───────────────────────────────────────────────────────────

export interface AnswerComposerInput {
  userMessage: string;
  intent: QueryIntent;
  computedData: unknown;
  personalization: PersonalizationProfile;
  evidence: EvidenceItem[];
  assumptions: string[];
  warnings: string[];
  entities: ExtractedEntities;
}
