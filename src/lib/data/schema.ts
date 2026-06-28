/**
 * Canonical schema definitions for every CSV in the dataset.
 * Derived from the actual headers confirmed by inspection on 2026-06-28.
 * Used by parser.ts to validate headers and field values at load time.
 */

export interface ColumnDef {
  required: boolean;
  numeric?: boolean; // must parse to a finite number
  enumValues?: readonly string[]; // if set, value must be one of these
  fk?: { file: string; field: string }; // foreign-key reference (for validate.ts)
  isPk?: boolean; // marks the primary-key column
  allowBlank?: boolean; // e.g. age is blank for Entity investors
}

export interface TableSchema {
  file: string; // filename, e.g. "investors.csv"
  pkField: string; // column that acts as PK
  columns: Record<string, ColumnDef>;
}

// ─── Enum constants ────────────────────────────────────────────────────────────

const ENTITY_STATUS = ["Active", "Exited", "Written Off"] as const;
const CURRENCIES = ["USD", "GBP", "EUR", "AED"] as const;
const YES_NO = ["Yes", "No"] as const;
const KYC_STATUS = ["Verified", "Pending"] as const;
const TECH_SAVVINESS = ["Low", "Medium", "High"] as const;
const INVESTOR_TYPE = ["Individual", "Entity"] as const;
const ALLOC_STATUS = ["Active", "Pending"] as const;
const MARK_SOURCE = ["Entry", "Internal", "Markup Round", "Exit", "Write Off"] as const;
const CALL_STATUS = ["Paid", "Upcoming"] as const;
const FEE_TYPE = ["Management Fee", "Structuring Fee", "Admin Fee"] as const;
const FEE_BASIS = ["Commitment", "Flat"] as const;
const FEE_STATUS = ["Paid", "Upcoming", "Overdue"] as const;
const DIST_TYPE = ["Exit Proceeds", "Secondary Sale"] as const;
const STMT_TYPE = [
  "Capital Contribution",
  "Management Fee",
  "Structuring Fee",
  "Admin Fee",
  "Exit Proceeds",
  "Secondary Sale",
] as const;

// ─── Table schemas ─────────────────────────────────────────────────────────────

export const SCHEMAS: Record<string, TableSchema> = {
  investors: {
    file: "investors.csv",
    pkField: "investor_id",
    columns: {
      investor_id:         { required: true,  isPk: true },
      investor_name:       { required: true },
      investor_type:       { required: true,  enumValues: INVESTOR_TYPE },
      country:             { required: true },
      reporting_currency:  { required: true,  enumValues: CURRENCIES },
      age:                 { required: false, numeric: true, allowBlank: true },
      tech_savviness:      { required: true,  enumValues: TECH_SAVVINESS },
      kyc_status:          { required: true,  enumValues: KYC_STATUS },
      onboarded_date:      { required: true },
      email:               { required: true },
    },
  },

  portfolio_companies: {
    file: "portfolio_companies.csv",
    pkField: "company_id",
    columns: {
      company_id:   { required: true,  isPk: true },
      company_name: { required: true },
      sector:       { required: true },
      hq_country:   { required: true },
      status:       { required: true,  enumValues: ENTITY_STATUS },
      website:      { required: false },
    },
  },

  deals: {
    file: "deals.csv",
    pkField: "deal_id",
    columns: {
      deal_id:                   { required: true,  isPk: true },
      company_id:                { required: true,  fk: { file: "portfolio_companies.csv", field: "company_id" } },
      company_name:              { required: true },
      round:                     { required: true },
      instrument:                { required: true },
      spv_name:                  { required: true },
      deal_currency:             { required: true,  enumValues: CURRENCIES },
      deal_date:                 { required: true },
      pre_money_valuation_m:     { required: true,  numeric: true },
      post_money_valuation_m:    { required: true,  numeric: true },
      round_size_m:              { required: true,  numeric: true },
      equitie_allocation_m:      { required: true,  numeric: true },
      entry_share_price:         { required: true,  numeric: true },
      contributed_pct:           { required: true,  numeric: true },
      std_mgmt_fee_pct:          { required: true,  numeric: true },
      std_performance_fee_pct:   { required: true,  numeric: true },
      std_structuring_fee_pct:   { required: true,  numeric: true },
      std_admin_fee_usd:         { required: true,  numeric: true },
      status:                    { required: true,  enumValues: ENTITY_STATUS },
    },
  },

  allocations: {
    file: "allocations.csv",
    pkField: "allocation_id",
    columns: {
      allocation_id:           { required: true,  isPk: true },
      deal_id:                 { required: true,  fk: { file: "deals.csv", field: "deal_id" } },
      investor_id:             { required: true,  fk: { file: "investors.csv", field: "investor_id" } },
      deal_currency:           { required: true,  enumValues: CURRENCIES },
      commitment_amount:       { required: true,  numeric: true },
      price_discount_pct:      { required: true,  numeric: true },
      effective_share_price:   { required: true,  numeric: true },
      units:                   { required: true,  numeric: true },
      contributed_amount:      { required: true,  numeric: true },
      outstanding_commitment:  { required: true,  numeric: true },
      mgmt_fee_pct:            { required: true,  numeric: true },
      performance_fee_pct:     { required: true,  numeric: true },
      structuring_fee_pct:     { required: true,  numeric: true },
      admin_fee_usd:           { required: true,  numeric: true },
      fee_discount:            { required: true,  enumValues: YES_NO },
      allocation_status:       { required: true,  enumValues: ALLOC_STATUS },
      allocation_date:         { required: true },
    },
  },

  valuations: {
    file: "valuations.csv",
    pkField: "valuation_id",
    columns: {
      valuation_id:       { required: true,  isPk: true },
      deal_id:            { required: true,  fk: { file: "deals.csv", field: "deal_id" } },
      valuation_date:     { required: true },
      share_price:        { required: true,  numeric: true },
      company_valuation_m: { required: true, numeric: true },
      mark_source:        { required: true,  enumValues: MARK_SOURCE },
      multiple_vs_entry:  { required: true,  numeric: true },
    },
  },

  capital_calls: {
    file: "capital_calls.csv",
    pkField: "call_id",
    columns: {
      call_id:       { required: true,  isPk: true },
      allocation_id: { required: true,  fk: { file: "allocations.csv", field: "allocation_id" } },
      investor_id:   { required: true,  fk: { file: "investors.csv", field: "investor_id" } },
      deal_id:       { required: true,  fk: { file: "deals.csv", field: "deal_id" } },
      call_number:   { required: true,  numeric: true },
      call_date:     { required: true },
      amount:        { required: true,  numeric: true },
      currency:      { required: true,  enumValues: CURRENCIES },
      due_date:      { required: true },
      status:        { required: true,  enumValues: CALL_STATUS },
    },
  },

  fees: {
    file: "fees.csv",
    pkField: "fee_id",
    columns: {
      fee_id:        { required: true,  isPk: true },
      allocation_id: { required: true,  fk: { file: "allocations.csv", field: "allocation_id" } },
      investor_id:   { required: true,  fk: { file: "investors.csv", field: "investor_id" } },
      deal_id:       { required: true,  fk: { file: "deals.csv", field: "deal_id" } },
      fee_type:      { required: true,  enumValues: FEE_TYPE },
      period:        { required: true },
      fee_rate_pct:  { required: false, numeric: true, allowBlank: true },
      basis:         { required: true,  enumValues: FEE_BASIS },
      amount:        { required: true,  numeric: true },
      currency:      { required: true,  enumValues: CURRENCIES },
      due_date:      { required: true },
      status:        { required: true,  enumValues: FEE_STATUS },
    },
  },

  distributions: {
    file: "distributions.csv",
    pkField: "distribution_id",
    columns: {
      distribution_id:       { required: true,  isPk: true },
      deal_id:               { required: true,  fk: { file: "deals.csv", field: "deal_id" } },
      allocation_id:         { required: true,  fk: { file: "allocations.csv", field: "allocation_id" } },
      investor_id:           { required: true,  fk: { file: "investors.csv", field: "investor_id" } },
      distribution_date:     { required: true },
      distribution_type:     { required: true,  enumValues: DIST_TYPE },
      gross_amount:          { required: true,  numeric: true },
      performance_fee_pct:   { required: true,  numeric: true },
      performance_fee_amount:{ required: true,  numeric: true },
      net_amount:            { required: true,  numeric: true },
      currency:              { required: true,  enumValues: CURRENCIES },
      fraction_of_units:     { required: true,  numeric: true },
    },
  },

  statement_lines: {
    file: "statement_lines.csv",
    pkField: "line_id",
    columns: {
      line_id:      { required: true,  isPk: true },
      investor_id:  { required: true,  fk: { file: "investors.csv", field: "investor_id" } },
      date:         { required: true },
      type:         { required: true,  enumValues: STMT_TYPE },
      deal_id:      { required: true,  fk: { file: "deals.csv", field: "deal_id" } },
      amount:       { required: true,  numeric: true },
      currency:     { required: true,  enumValues: CURRENCIES },
      reference_id: { required: true },
    },
  },

  fx_rates: {
    file: "fx_rates.csv",
    pkField: "currency",
    columns: {
      currency: { required: true, isPk: true, enumValues: CURRENCIES },
      to_usd:   { required: true, numeric: true },
      as_of:    { required: true },
    },
  },
};

/** Return the schema for a given table key. Throws if unknown. */
export function getSchema(tableKey: string): TableSchema {
  const s = SCHEMAS[tableKey];
  if (!s) throw new Error(`No schema defined for table key "${tableKey}"`);
  return s;
}

/** All expected column names for a table, in order. */
export function expectedColumns(tableKey: string): string[] {
  return Object.keys(getSchema(tableKey).columns);
}
