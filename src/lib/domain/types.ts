// Domain answer shapes and evidence types

export interface EvidenceItem {
  id: string; // row PK, e.g. ALC0001
  sourceType:
    | "allocation"
    | "valuation"
    | "capital_call"
    | "fee"
    | "distribution"
    | "statement_line"
    | "deal";
  label: string; // human-readable label
  detail: string; // key fields as a formatted string
  amount?: number;
  currency?: string;
  date?: string;
}

// ─── Portfolio overview ───────────────────────────────────────────────────────

export interface PositionSummary {
  allocationId: string;
  dealId: string;
  companyId: string;
  companyName: string;
  round: string;
  sector: string;
  dealStatus: "Active" | "Exited" | "Written Off";
  allocationStatus: "Active" | "Pending";
  dealCurrency: string;
  reportingCurrency: string;

  // deal-currency amounts (raw)
  commitmentDealCcy: number;
  contributedDealCcy: number;
  currentValueDealCcy: number;
  distributionsNetDealCcy: number;

  // reporting-currency amounts (for display + aggregation)
  commitmentRpt: number;
  contributedRpt: number;
  currentValueRpt: number;
  distributionsNetRpt: number;

  moic: number | null; // null when contributed = 0 (Pending)

  latestSharePrice: number | null;
  entrySharePrice: number;
  effectiveSharePrice: number;
  units: number;
  priceDiscountPct: number;
}

export interface PortfolioOverview {
  investorId: string;
  reportingCurrency: string;
  totalCommittedRpt: number;
  totalContributedRpt: number;
  totalCurrentValueRpt: number;
  totalDistributionsRpt: number;
  totalValueRpt: number; // current + distributions
  portfolioMoic: number | null;
  activePositions: number;
  pendingPositions: number;
  positions: PositionSummary[];
  evidence: EvidenceItem[];
}

// ─── Position detail (single company, possibly multi-round) ───────────────────

export interface RoundDetail extends PositionSummary {
  distributionDetails: {
    distributionId: string;
    date: string;
    type: string;
    grossDealCcy: number;
    performanceFeePct: number;
    performanceFeeAmount: number;
    netDealCcy: number;
    netRpt: number;
    fractionOfUnits: number;
  }[];
}

export interface PositionDetail {
  companyName: string;
  sector: string;
  hqCountry: string;
  companyStatus: string;
  rounds: RoundDetail[];
  // aggregated across rounds
  totalCommittedRpt: number;
  totalContributedRpt: number;
  totalCurrentValueRpt: number;
  totalDistributionsRpt: number;
  totalValueRpt: number;
  companyMoic: number | null;
  reportingCurrency: string;
  evidence: EvidenceItem[];
}

// ─── Obligations ──────────────────────────────────────────────────────────────

export interface UpcomingCapitalCall {
  callId: string;
  dealId: string;
  companyName: string;
  round: string;
  callNumber: number;
  dueDate: string;
  amountDealCcy: number;
  amountRpt: number;
  dealCurrency: string;
  reportingCurrency: string;
  status: string;
}

export interface UpcomingFee {
  feeId: string;
  dealId: string;
  companyName: string;
  round: string;
  feeType: string;
  period: string;
  amountFeeNativeCcy: number;
  amountRpt: number;
  feeCurrency: string;
  reportingCurrency: string;
  dueDate: string;
  status: "Upcoming" | "Overdue";
}

export interface Obligations {
  investorId: string;
  reportingCurrency: string;
  capitalCalls: UpcomingCapitalCall[];
  fees: UpcomingFee[];
  totalCapitalCallsRpt: number;
  totalFeesRpt: number;
  totalObligationsRpt: number;
  evidence: EvidenceItem[];
}

// ─── Distributions ────────────────────────────────────────────────────────────

export interface DistributionDetail {
  distributionId: string;
  dealId: string;
  companyName: string;
  round: string;
  date: string;
  type: string;
  grossDealCcy: number;
  performanceFeePct: number;
  performanceFeeAmountDealCcy: number;
  netDealCcy: number;
  netRpt: number;
  dealCurrency: string;
  reportingCurrency: string;
  fractionOfUnits: number;
}

export interface DistributionSummary {
  investorId: string;
  reportingCurrency: string;
  distributions: DistributionDetail[];
  totalGrossRpt: number;
  totalNetRpt: number;
  totalPerformanceFeeRpt: number;
  evidence: EvidenceItem[];
}

// ─── Fee detail ───────────────────────────────────────────────────────────────

export interface FeeLineItem {
  feeId: string;
  feeType: string;
  period: string;
  effectiveRatePct: number | null;
  standardRatePct: number | null;
  hasDiscount: boolean;
  amountNativeCcy: number;
  amountRpt: number;
  nativeCurrency: string;
  dueDate: string;
  status: string;
}

export interface DealFeeBreakdown {
  dealId: string;
  companyName: string;
  round: string;
  dealCurrency: string;
  reportingCurrency: string;
  allocationId: string;
  feeDiscount: boolean;
  // standard rates from deal
  stdMgmtFeePct: number;
  stdPerfFeePct: number;
  stdStructuringFeePct: number;
  stdAdminFeeUsd: number;
  // this investor's effective rates
  effMgmtFeePct: number;
  effPerfFeePct: number;
  effStructuringFeePct: number;
  effAdminFeeUsd: number;
  fees: FeeLineItem[];
  totalPaidRpt: number;
  totalUpcomingRpt: number;
  evidence: EvidenceItem[];
}

// ─── Valuation history ────────────────────────────────────────────────────────

export interface ValuationMark {
  valuationId: string;
  date: string;
  sharePrice: number;
  companyValuationM: number;
  markSource: string;
  multipleVsEntry: number;
  // investor's portfolio value at this mark
  investorValueDealCcy: number | null;
  investorValueRpt: number | null;
  moicAtMark: number | null;
}

export interface ValuationHistory {
  dealId: string;
  companyName: string;
  round: string;
  dealCurrency: string;
  reportingCurrency: string;
  entrySharePrice: number;
  effectiveSharePrice: number;
  units: number;
  contributed: number;
  marks: ValuationMark[];
  evidence: EvidenceItem[];
}

// ─── Account statement ────────────────────────────────────────────────────────

export interface StatementLine {
  lineId: string;
  date: string;
  type: string;
  dealId: string;
  companyName: string;
  round: string;
  amountDealCcy: number; // signed
  amountRpt: number; // signed, in reporting currency
  dealCurrency: string;
  referenceId: string;
}

export interface AccountStatement {
  investorId: string;
  reportingCurrency: string;
  lines: StatementLine[];
  totalContributionsRpt: number; // always positive
  totalFeesRpt: number; // always positive
  totalDistributionsRpt: number; // always positive
  netCashFlowRpt: number; // positive = net inflow
  evidence: EvidenceItem[];
}

// ─── Query routing ────────────────────────────────────────────────────────────

export type QueryIntent =
  | "portfolio_overview"
  | "position_detail"
  | "obligations"
  | "distributions"
  | "fee_detail"
  | "valuation_history"
  | "account_statement"
  | "glossary_or_metric_explanation"
  | "unsupported_or_ambiguous"
  | "general_help"; // kept for policy layer backward-compat

export interface ExtractedEntities {
  /** Resolved company name from the message (null if none mentioned or ambiguous) */
  companyName: string | null;
  /** Internal company_id for the resolved company */
  companyId: string | null;
  /** Deal round if mentioned, e.g. "Series A", "Seed" */
  round: string | null;
  /** Financial term if this is a glossary question, e.g. "MOIC", "carry" */
  metricOrTerm: string | null;
  /** Date range hint extracted from the message */
  dateRange: { from: string | null; to: string | null } | null;
  /** Company names when the query is ambiguous (multiple matches) */
  ambiguousCompanies: string[] | null;
}

export interface RouterOutput {
  intent: QueryIntent;
  /** 0.0–1.0: how confident the router is in this routing decision */
  confidence: number;
  entities: ExtractedEntities;
  /** Name of the deterministic backend function to call */
  backendFunction: string;
  /** Params the caller should forward to that function */
  backendParams: Record<string, unknown>;
  /** Non-null when the user should be prompted to clarify before proceeding */
  clarificationPrompt: string | null;
  /** Dev-readable explanation of why this intent was chosen */
  reasoning: string;
  /** Which regex keywords or patterns triggered this classification */
  matchedKeywords: string[];
}

/** Backward-compat alias — consumers should migrate to RouterOutput */
export type IntentResult = RouterOutput;

// ─── Chat API types ───────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  investorId: string;
  history: ChatMessage[];
}

export interface ChatResponse {
  answer: string;
  intent: QueryIntent;
  evidence: EvidenceItem[];
  fallbackMode: boolean;
}
