// Raw CSV row shapes — string fields only, no parsed numerics

export interface RawInvestor {
  investor_id: string;
  investor_name: string;
  investor_type: "Individual" | "Entity";
  country: string;
  reporting_currency: string;
  age: string; // blank for Entity
  tech_savviness: "Low" | "Medium" | "High";
  kyc_status: "Verified" | "Pending";
  onboarded_date: string;
  email: string;
}

export interface RawPortfolioCompany {
  company_id: string;
  company_name: string;
  sector: string;
  hq_country: string;
  status: "Active" | "Exited" | "Written Off";
  website: string;
}

export interface RawDeal {
  deal_id: string;
  company_id: string;
  company_name: string;
  round: string;
  instrument: string;
  spv_name: string;
  deal_currency: string;
  deal_date: string;
  pre_money_valuation_m: string;
  post_money_valuation_m: string;
  round_size_m: string;
  equitie_allocation_m: string;
  entry_share_price: string;
  contributed_pct: string;
  std_mgmt_fee_pct: string;
  std_performance_fee_pct: string;
  std_structuring_fee_pct: string;
  std_admin_fee_usd: string;
  status: "Active" | "Exited" | "Written Off";
}

export interface RawAllocation {
  allocation_id: string;
  deal_id: string;
  investor_id: string;
  deal_currency: string;
  commitment_amount: string;
  price_discount_pct: string;
  effective_share_price: string;
  units: string;
  contributed_amount: string;
  outstanding_commitment: string;
  mgmt_fee_pct: string;
  performance_fee_pct: string;
  structuring_fee_pct: string;
  admin_fee_usd: string;
  fee_discount: "Yes" | "No";
  allocation_status: "Active" | "Pending";
  allocation_date: string;
}

export interface RawValuation {
  valuation_id: string;
  deal_id: string;
  valuation_date: string;
  share_price: string;
  company_valuation_m: string;
  mark_source: "Entry" | "Internal" | "Markup Round" | "Exit" | "Write Off";
  multiple_vs_entry: string;
}

export interface RawCapitalCall {
  call_id: string;
  allocation_id: string;
  investor_id: string;
  deal_id: string;
  call_number: string;
  call_date: string;
  amount: string;
  currency: string;
  due_date: string;
  status: "Paid" | "Upcoming";
}

export interface RawFee {
  fee_id: string;
  allocation_id: string;
  investor_id: string;
  deal_id: string;
  fee_type: "Management Fee" | "Structuring Fee" | "Admin Fee";
  period: string;
  fee_rate_pct: string;
  basis: "Commitment" | "Flat";
  amount: string;
  currency: string; // USD for admin fee regardless of deal currency
  due_date: string;
  status: "Paid" | "Upcoming" | "Overdue";
}

export interface RawDistribution {
  distribution_id: string;
  deal_id: string;
  allocation_id: string;
  investor_id: string;
  distribution_date: string;
  distribution_type: "Exit Proceeds" | "Secondary Sale";
  gross_amount: string;
  performance_fee_pct: string;
  performance_fee_amount: string;
  net_amount: string;
  currency: string;
  fraction_of_units: string;
}

export interface RawStatementLine {
  line_id: string;
  investor_id: string;
  date: string;
  type:
    | "Capital Contribution"
    | "Management Fee"
    | "Structuring Fee"
    | "Admin Fee"
    | "Exit Proceeds"
    | "Secondary Sale";
  deal_id: string;
  amount: string; // signed: negative = cash out, positive = cash in
  currency: string;
  reference_id: string;
}

export interface RawFxRate {
  currency: string;
  to_usd: string;
  as_of: string;
}
