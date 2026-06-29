/**
 * Grounded Answer Composer
 *
 * Takes structured computed results + investor personalization profile + source
 * evidence and produces a rich AnswerObject for the UI.
 *
 * Architecture:
 *   1. Build answer scaffold deterministically (title, key metrics, caveats,
 *      follow-up questions, calculation note)
 *   2. Normalize evidence → NormalizedEvidence[] with source file, fields,
 *      and calculation role
 *   3. Detect glossary terms appropriate for this investor's sophistication
 *   4. Build a strict LLM prompt with the pre-computed data
 *   5. Call LLM → extract JSON { conciseAnswer, detailedNarrative }
 *   6. On failure (no key / bad JSON / LLM error) → deterministic fallback
 *   7. Combine into AnswerObject
 */

import OpenAI from "openai";
import type { AnswerComposerInput, AnswerObject } from "./types";
import { buildTitle, buildKeyMetrics, buildCaveats, buildFollowUps, buildCalculationNote } from "./scaffold";
import { normalizeEvidence } from "./evidence";
import { detectGlossaryTerms } from "./glossary";
import { buildComposerSystemPrompt, buildComposerUserTurn } from "./prompt";
import { buildFallbackNarrative, buildErrorNarrative } from "./fallback";

// ─── Main entry point ──────────────────────────────────────────────────────────

export async function composeAnswer(
  input: AnswerComposerInput,
  openAI: OpenAI | null
): Promise<AnswerObject> {
  const {
    userMessage,
    intent,
    computedData,
    personalization,
    evidence,
    assumptions,
    warnings,
    entities,
  } = input;

  // ── 1. Deterministic scaffold ──────────────────────────────────────────────
  const title = buildTitle(intent, entities, computedData);
  const keyMetrics = buildKeyMetrics(intent, computedData, personalization.reportingCurrency);
  const caveats = buildCaveats(assumptions, warnings);
  const followUpQuestions = buildFollowUps(intent, entities, computedData);
  const calculationNote = buildCalculationNote(intent, computedData);

  // ── 2. Normalize evidence ──────────────────────────────────────────────────
  const evidenceRefs = normalizeEvidence(evidence);

  // ── 3. Glossary (Emerging investors only) ─────────────────────────────────
  const glossaryTerms = personalization.explainJargon
    ? detectGlossaryTerms(intent, entities.metricOrTerm)
    : [];

  // ── 4–6. LLM call (with deterministic fallback) ───────────────────────────
  let conciseAnswer: string;
  let detailedNarrative: string;
  let fallbackMode = false;

  // Check for error payloads (e.g., company not found)
  const dataObj = (computedData ?? {}) as Record<string, unknown>;
  if (typeof dataObj.error === "string") {
    const err = buildErrorNarrative(dataObj.error);
    conciseAnswer = err.conciseAnswer;
    detailedNarrative = err.detailedNarrative;
    fallbackMode = true;
  } else if (openAI) {
    const systemPrompt = buildComposerSystemPrompt(
      personalization,
      intent,
      glossaryTerms,
      caveats
    );
    const userTurn = buildComposerUserTurn(
      userMessage,
      computedData,
      keyMetrics,
      caveats
    );

    try {
      const response = await openAI.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 1400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userTurn },
        ],
      });

      const rawText = response.choices[0]?.message?.content ?? "";
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        throw new Error(`LLM returned non-JSON: ${rawText.slice(0, 100)}`);
      }

      conciseAnswer =
        typeof parsed.conciseAnswer === "string" && parsed.conciseAnswer.trim()
          ? parsed.conciseAnswer.trim()
          : "";
      detailedNarrative =
        typeof parsed.detailedNarrative === "string" && parsed.detailedNarrative.trim()
          ? parsed.detailedNarrative.trim()
          : "";

      if (!conciseAnswer || !detailedNarrative) {
        throw new Error("LLM JSON missing conciseAnswer or detailedNarrative");
      }
    } catch (err) {
      console.error("[composer] LLM call failed, using fallback:", err);
      fallbackMode = true;
      const fb = buildFallbackNarrative(intent, computedData, personalization);
      conciseAnswer = fb.conciseAnswer;
      detailedNarrative = fb.detailedNarrative;
    }
  } else {
    // No API key — use deterministic fallback
    fallbackMode = true;
    const fb = buildFallbackNarrative(intent, computedData, personalization);
    conciseAnswer = fb.conciseAnswer;
    detailedNarrative = fb.detailedNarrative;
  }

  return {
    title,
    conciseAnswer,
    keyMetrics,
    detailedNarrative,
    glossaryTerms,
    evidenceRefs,
    caveats,
    followUpQuestions,
    calculationNote,
    intent,
    personalizationLevel: personalization.sophisticationLevel,
    fallbackMode,
  };
}

export type { AnswerObject, AnswerComposerInput, KeyMetric, GlossaryEntry, NormalizedEvidence } from "./types";
