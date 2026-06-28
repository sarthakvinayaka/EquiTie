/**
 * Investor access policy — public API for the policy layer.
 *
 * This module re-exports from the focused sub-modules and retains the legacy
 * AccessDeniedError + assertInvestorAccess + filterToInvestor surface for
 * backward compatibility with existing code.
 *
 * New code should prefer:
 *   - runPolicyChecks()      from ./engine  (pre-computation gate)
 *   - runIntentPolicyChecks() from ./engine  (post-intent gate)
 *   - resolveInvestorContext() from ./context
 *   - buildScopedDb()        from ./scoped
 */

import type { Database } from "../data/loader";

// ─── Re-exports from focused modules ──────────────────────────────────────────

export type { InvestorContext, PolicyResult, PolicyCheckResult, IntentPolicyResult, PolicyViolationCode, PolicyLogEntry } from "./types";
export { resolveInvestorContext } from "./context";
export { buildScopedDb, assertScopedDbIntegrity } from "./scoped";
export type { InvestorScopedDb } from "./scoped";
export { runPolicyChecks, runIntentPolicyChecks, runEvidenceIntegrityCheck } from "./engine";
export { getPolicyLog, getPolicyLogStats } from "./logger";
export {
  guardInvestorExists,
  guardNoCrossInvestorRequest,
  guardNoExternalDataRequest,
  guardAmbiguousEntity,
  guardCompanyInPortfolio,
  guardEvidenceIntegrity,
} from "./guards";

// ─── Legacy API (kept for existing callers) ────────────────────────────────────

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

/**
 * @deprecated Use runPolicyChecks() from ./engine instead.
 * Kept for backward compatibility with code that calls assertInvestorAccess.
 */
export function assertInvestorAccess(
  loggedInInvestorId: string,
  requestedInvestorId: string
): void {
  if (loggedInInvestorId !== requestedInvestorId) {
    throw new AccessDeniedError(
      `Access denied: investor ${loggedInInvestorId} may not view data for investor ${requestedInvestorId}`
    );
  }
}

/**
 * @deprecated Use resolveInvestorContext() instead.
 * Returns valid:true if the investor exists in the dataset.
 */
export function validateInvestor(
  investorId: string,
  db: Database
): { valid: boolean; reason?: string } {
  const investor = db.investors.get(investorId);
  if (!investor) {
    return { valid: false, reason: "Investor not found" };
  }
  return { valid: true };
}

/**
 * Belt-and-suspenders filter: given an array of rows that have an investor_id
 * field, returns only those belonging to loggedInInvestorId.
 */
export function filterToInvestor<T extends { investor_id?: string }>(
  rows: T[],
  investorId: string
): T[] {
  return rows.filter((r) => r.investor_id === investorId);
}
