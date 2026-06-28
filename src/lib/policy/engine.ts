/**
 * Policy engine — orchestrates all guards for a chat request.
 *
 * Call order:
 *   1. guardInvestorExists            — investor must be in dataset
 *   2. guardNoCrossInvestorRequest    — message must not mention other investors
 *   3. guardNoExternalDataRequest     — message must not ask for live/market data
 *   4. resolveInvestorContext         — build immutable context (used by later checks)
 *
 * After intent classification, call runIntentPolicyChecks:
 *   5. guardAmbiguousEntity           — clarify before proceeding
 *   6. guardCompanyInPortfolio        — company must be in investor's portfolio
 *   7. guardEvidenceIntegrity         — post-computation safety net
 *
 * Every decision is logged via the audit logger.
 */

import type { Database } from "../data/loader";
import type { EvidenceItem } from "../domain/types";
import type { PolicyCheckResult, IntentPolicyResult, InvestorContext } from "./types";
import { resolveInvestorContext } from "./context";
import {
  guardInvestorExists,
  guardNoCrossInvestorRequest,
  guardNoExternalDataRequest,
  guardAmbiguousEntity,
  guardCompanyInPortfolio,
  guardEvidenceIntegrity,
} from "./guards";
import { logPolicyDecision, redactMessage } from "./logger";

// ─── Pre-computation checks ────────────────────────────────────────────────────

export function runPolicyChecks(
  investorId: string,
  message: string,
  db: Database
): PolicyCheckResult {
  const messageSummary = redactMessage(message);
  const action = "chat_request";

  // G1 — Investor must exist
  const g1 = guardInvestorExists(investorId, db);
  if (!g1.allowed) {
    const logEntry = logPolicyDecision({
      timestamp: new Date().toISOString(),
      investorId,
      action,
      allowed: false,
      violationCode: g1.violationCode,
      reason: g1.reason,
      messageSummary,
    });
    return { allowed: false, violationCode: g1.violationCode, safeResponse: g1.safeResponse, logEntry };
  }

  // G2 — No cross-investor references
  const g2 = guardNoCrossInvestorRequest(message, investorId);
  if (!g2.allowed) {
    const logEntry = logPolicyDecision({
      timestamp: new Date().toISOString(),
      investorId,
      action,
      allowed: false,
      violationCode: g2.violationCode,
      reason: g2.reason,
      messageSummary,
    });
    return { allowed: false, violationCode: g2.violationCode, safeResponse: g2.safeResponse, logEntry };
  }

  // G3 — No external/market data requests
  const g3 = guardNoExternalDataRequest(message);
  if (!g3.allowed) {
    const logEntry = logPolicyDecision({
      timestamp: new Date().toISOString(),
      investorId,
      action,
      allowed: false,
      violationCode: g3.violationCode,
      reason: g3.reason,
      messageSummary,
    });
    return { allowed: false, violationCode: g3.violationCode, safeResponse: g3.safeResponse, logEntry };
  }

  // G4 — Resolve investor context (guaranteed to succeed after G1)
  const investorContext = resolveInvestorContext(investorId, db)!;

  const logEntry = logPolicyDecision({
    timestamp: new Date().toISOString(),
    investorId,
    action,
    allowed: true,
    messageSummary,
  });

  return { allowed: true, investorContext, logEntry };
}

// ─── Post-intent checks ────────────────────────────────────────────────────────

export function runIntentPolicyChecks(
  opts: {
    investorId: string;
    intent: string;
    companyName?: string;
    ambiguous?: string[];
    investorContext: InvestorContext;
    db: Database;
  }
): IntentPolicyResult {
  const { investorId, intent, companyName, ambiguous, investorContext, db } = opts;

  // G5 — Ambiguous entity → require clarification
  if (ambiguous && ambiguous.length > 1) {
    const g5 = guardAmbiguousEntity(ambiguous);
    if (!g5.allowed) {
      logPolicyDecision({
        timestamp: new Date().toISOString(),
        investorId,
        action: "intent_check",
        allowed: false,
        violationCode: g5.violationCode,
        reason: g5.reason,
        messageSummary: `ambiguous entity: ${ambiguous.join(" / ")}`,
        intent,
      });
      return { allowed: false, violationCode: g5.violationCode, safeResponse: g5.safeResponse };
    }
  }

  // G6 — Named company must be in this investor's portfolio
  if (companyName) {
    const g6 = guardCompanyInPortfolio(companyName, investorContext, db);
    if (!g6.allowed) {
      logPolicyDecision({
        timestamp: new Date().toISOString(),
        investorId,
        action: "intent_check",
        allowed: false,
        violationCode: g6.violationCode,
        reason: g6.reason,
        messageSummary: `company: ${companyName}`,
        intent,
      });
      return { allowed: false, violationCode: g6.violationCode, safeResponse: g6.safeResponse };
    }
  }

  logPolicyDecision({
    timestamp: new Date().toISOString(),
    investorId,
    action: "intent_check",
    allowed: true,
    messageSummary: `company: ${companyName ?? "-"}`,
    intent,
  });

  return { allowed: true };
}

// ─── Post-computation integrity check ─────────────────────────────────────────

export function runEvidenceIntegrityCheck(
  investorId: string,
  evidence: EvidenceItem[],
  db: Database
): IntentPolicyResult {
  const g7 = guardEvidenceIntegrity(
    investorId,
    evidence.map((e) => e.id),
    db
  );
  if (!g7.allowed) {
    logPolicyDecision({
      timestamp: new Date().toISOString(),
      investorId,
      action: "evidence_integrity",
      allowed: false,
      violationCode: g7.violationCode,
      reason: g7.reason,
      messageSummary: `${evidence.length} evidence items`,
    });
    return { allowed: false, violationCode: g7.violationCode, safeResponse: g7.safeResponse };
  }
  return { allowed: true };
}
