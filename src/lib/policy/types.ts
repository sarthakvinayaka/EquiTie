/**
 * Core types for the investor policy and access control layer.
 *
 * Every decision the policy engine makes is expressed as one of these typed
 * objects. Nothing downstream receives investor data until a PolicyCheckResult
 * with allowed=true has been produced and logged.
 */

// ─── Violation codes ───────────────────────────────────────────────────────────

export type PolicyViolationCode =
  | "UNKNOWN_INVESTOR"           // investor_id not found in dataset
  | "CROSS_INVESTOR_ACCESS"      // message or request references another investor
  | "COMPANY_NOT_IN_PORTFOLIO"   // requested company is not in this investor's allocations
  | "AMBIGUOUS_ENTITY"           // multiple companies matched — need clarification
  | "EXTERNAL_DATA_REQUEST"      // message asks for real-world / market data
  | "NO_STRUCTURED_DATA"         // intent resolved but dataset has no rows to answer it
  | "UNSUPPORTED_INFERENCE";     // model would need to guess; no backing rows

// ─── Policy result ─────────────────────────────────────────────────────────────

export interface PolicyResult {
  /** false = request must not proceed; true = proceed */
  allowed: boolean;
  violationCode?: PolicyViolationCode;
  /** Plain-text message safe to show the end user when allowed=false */
  safeResponse?: string;
  /** Machine-readable reason for logging */
  reason?: string;
}

// ─── Audit log entry ───────────────────────────────────────────────────────────

export interface PolicyLogEntry {
  timestamp: string;
  /** Sequential request counter within this server process */
  seq: number;
  investorId: string;
  action: string;
  allowed: boolean;
  violationCode?: PolicyViolationCode;
  reason?: string;
  /** Redacted summary of the message — never the full text in prod */
  messageSummary: string;
  intent?: string;
}

// ─── Investor context ──────────────────────────────────────────────────────────

/**
 * Resolved context for a verified investor.
 * Built once per request and used by all subsequent policy checks and domain
 * functions. Immutable after construction.
 */
export interface InvestorContext {
  readonly investorId: string;
  readonly investorName: string;
  readonly reportingCurrency: string;
  readonly techSavviness: "Low" | "Medium" | "High";
  readonly age: number | null;
  /** Company IDs this investor has any allocation in (active or pending) */
  readonly companyIds: ReadonlySet<string>;
  /** Deal IDs this investor has any allocation in */
  readonly dealIds: ReadonlySet<string>;
  /** All allocation IDs belonging to this investor */
  readonly allocationIds: ReadonlySet<string>;
  /** Lowercase canonical company names for fast matching */
  readonly companyNamesLower: ReadonlySet<string>;
}

// ─── Engine-level results ──────────────────────────────────────────────────────

export interface PolicyCheckResult {
  allowed: boolean;
  /** Populated when allowed=true; used by downstream domain functions */
  investorContext?: InvestorContext;
  violationCode?: PolicyViolationCode;
  safeResponse?: string;
  logEntry: PolicyLogEntry;
}

export interface IntentPolicyResult {
  allowed: boolean;
  violationCode?: PolicyViolationCode;
  safeResponse?: string;
}
