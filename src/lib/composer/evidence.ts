import type { EvidenceItem } from "../domain/types";
import type { NormalizedEvidence } from "./types";

// ─── Source file mapping ──────────────────────────────────────────────────────

const SOURCE_FILE: Record<string, string> = {
  allocation: "allocations.csv",
  valuation: "valuations.csv",
  capital_call: "capital_calls.csv",
  fee: "fees.csv",
  distribution: "distributions.csv",
  statement_line: "account_statement.csv",
  deal: "deals.csv",
};

// ─── Fields used per source type ──────────────────────────────────────────────

const FIELDS_USED: Record<string, string[]> = {
  allocation: [
    "commitment_amount",
    "contributed_amount",
    "units",
    "effective_share_price",
    "deal_currency",
    "status",
    "allocation_status",
  ],
  valuation: [
    "valuation_date",
    "share_price",
    "company_valuation_m",
    "mark_source",
    "multiple_vs_entry",
  ],
  capital_call: ["due_date", "amount", "status", "call_number", "deal_id"],
  fee: [
    "fee_type",
    "amount",
    "period",
    "due_date",
    "status",
    "effective_rate",
    "standard_rate",
  ],
  distribution: [
    "distribution_date",
    "type",
    "gross_amount",
    "performance_fee_pct",
    "net_amount",
    "fraction_of_units",
  ],
  statement_line: ["date", "type", "amount", "signed_amount", "reference_id"],
  deal: [
    "company_name",
    "round",
    "entry_share_price",
    "status",
    "deal_currency",
  ],
};

// ─── Calculation role per source type ─────────────────────────────────────────

const CALCULATION_ROLE: Record<string, string> = {
  allocation: "MOIC denominator (contributed capital) and unrealised position size",
  valuation: "Latest share price for current value; history for MOIC-at-mark",
  capital_call: "Upcoming / overdue obligation amount and due date",
  fee: "Fee schedule line — management, performance, structuring, or admin",
  distribution: "Net distributions received (MOIC numerator and DPI)",
  statement_line: "Cash flow line item for net cash flow calculation",
  deal: "Entry price, round, and deal status used in position and valuation calculations",
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Converts raw EvidenceItem[] (from engine functions) into a richer
 * NormalizedEvidence[] that points to the source file, fields, and
 * explains what each row contributed to the answer.
 */
export function normalizeEvidence(items: EvidenceItem[]): NormalizedEvidence[] {
  return items.map((item) => ({
    id: item.id,
    sourceFile: SOURCE_FILE[item.sourceType] ?? `${item.sourceType} (unknown file)`,
    sourceType: item.sourceType,
    label: item.label,
    detail: item.detail,
    fieldsUsed: FIELDS_USED[item.sourceType] ?? [],
    calculationRole: CALCULATION_ROLE[item.sourceType] ?? "Source row for this answer",
    date: item.date,
    amount: item.amount,
    currency: item.currency,
  }));
}

/**
 * Group normalized evidence by source file for the "How this was calculated" display.
 */
export function groupEvidenceByFile(
  items: NormalizedEvidence[]
): Map<string, NormalizedEvidence[]> {
  const groups = new Map<string, NormalizedEvidence[]>();
  for (const item of items) {
    const existing = groups.get(item.sourceFile) ?? [];
    existing.push(item);
    groups.set(item.sourceFile, existing);
  }
  return groups;
}
