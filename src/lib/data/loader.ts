import fs from "fs";
import path from "path";
import Papa from "papaparse";
import type {
  RawInvestor,
  RawPortfolioCompany,
  RawDeal,
  RawAllocation,
  RawValuation,
  RawCapitalCall,
  RawFee,
  RawDistribution,
  RawStatementLine,
  RawFxRate,
} from "./types";

export interface Database {
  investors: Map<string, RawInvestor>;
  companies: Map<string, RawPortfolioCompany>;
  companiesByName: Map<string, RawPortfolioCompany>; // lowercase name → company
  deals: Map<string, RawDeal>;
  dealsByCompany: Map<string, string[]>; // company_id → deal_id[]
  allocations: Map<string, RawAllocation>; // allocation_id → allocation
  allocationsByInvestor: Map<string, string[]>; // investor_id → allocation_id[]
  allocationsByDeal: Map<string, string[]>; // deal_id → allocation_id[]
  valuationsByDeal: Map<string, RawValuation[]>; // deal_id → valuations sorted date asc
  latestValuation: Map<string, RawValuation>; // deal_id → latest
  capitalCalls: Map<string, RawCapitalCall>; // call_id → call
  capitalCallsByAllocation: Map<string, string[]>; // allocation_id → call_id[]
  capitalCallsByInvestor: Map<string, string[]>; // investor_id → call_id[]
  fees: Map<string, RawFee>; // fee_id → fee
  feesByAllocation: Map<string, string[]>; // allocation_id → fee_id[]
  feesByInvestor: Map<string, string[]>; // investor_id → fee_id[]
  distributions: Map<string, RawDistribution>; // dist_id → dist
  distributionsByAllocation: Map<string, string[]>; // allocation_id → dist_id[]
  distributionsByInvestor: Map<string, string[]>; // investor_id → dist_id[]
  statementLines: Map<string, RawStatementLine[]>; // investor_id → lines sorted date asc
  fxRates: Map<string, number>; // currency → to_usd
}

function loadCsv<T>(filename: string): T[] {
  const filePath = path.join(process.cwd(), "data", filename);
  const content = fs.readFileSync(filePath, "utf-8");
  const result = Papa.parse<T>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  return result.data;
}

let _db: Database | null = null;

export function getDatabase(): Database {
  if (_db) return _db;

  const investors = loadCsv<RawInvestor>("investors.csv");
  const companies = loadCsv<RawPortfolioCompany>("portfolio_companies.csv");
  const deals = loadCsv<RawDeal>("deals.csv");
  const allocations = loadCsv<RawAllocation>("allocations.csv");
  const valuations = loadCsv<RawValuation>("valuations.csv");
  const capitalCalls = loadCsv<RawCapitalCall>("capital_calls.csv");
  const fees = loadCsv<RawFee>("fees.csv");
  const distributions = loadCsv<RawDistribution>("distributions.csv");
  const statementLines = loadCsv<RawStatementLine>("statement_lines.csv");
  const fxRates = loadCsv<RawFxRate>("fx_rates.csv");

  const db: Database = {
    investors: new Map(investors.map((i) => [i.investor_id, i])),
    companies: new Map(companies.map((c) => [c.company_id, c])),
    companiesByName: new Map(
      companies.map((c) => [c.company_name.toLowerCase(), c])
    ),
    deals: new Map(deals.map((d) => [d.deal_id, d])),
    dealsByCompany: new Map(),
    allocations: new Map(allocations.map((a) => [a.allocation_id, a])),
    allocationsByInvestor: new Map(),
    allocationsByDeal: new Map(),
    valuationsByDeal: new Map(),
    latestValuation: new Map(),
    capitalCalls: new Map(capitalCalls.map((c) => [c.call_id, c])),
    capitalCallsByAllocation: new Map(),
    capitalCallsByInvestor: new Map(),
    fees: new Map(fees.map((f) => [f.fee_id, f])),
    feesByAllocation: new Map(),
    feesByInvestor: new Map(),
    distributions: new Map(distributions.map((d) => [d.distribution_id, d])),
    distributionsByAllocation: new Map(),
    distributionsByInvestor: new Map(),
    statementLines: new Map(),
    fxRates: new Map(fxRates.map((fx) => [fx.currency, parseFloat(fx.to_usd)])),
  };

  // Index deals by company
  for (const deal of deals) {
    push(db.dealsByCompany, deal.company_id, deal.deal_id);
  }

  // Index allocations
  for (const alloc of allocations) {
    push(db.allocationsByInvestor, alloc.investor_id, alloc.allocation_id);
    push(db.allocationsByDeal, alloc.deal_id, alloc.allocation_id);
  }

  // Index and sort valuations; pick latest per deal
  for (const val of valuations) {
    const existing = db.valuationsByDeal.get(val.deal_id) ?? [];
    existing.push(val);
    db.valuationsByDeal.set(val.deal_id, existing);
  }
  for (const [dealId, vals] of db.valuationsByDeal) {
    const sorted = [...vals].sort(
      (a, b) =>
        new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
    );
    db.valuationsByDeal.set(dealId, sorted);
    db.latestValuation.set(dealId, sorted[sorted.length - 1]);
  }

  // Index capital calls
  for (const call of capitalCalls) {
    push(db.capitalCallsByAllocation, call.allocation_id, call.call_id);
    push(db.capitalCallsByInvestor, call.investor_id, call.call_id);
  }

  // Index fees
  for (const fee of fees) {
    push(db.feesByAllocation, fee.allocation_id, fee.fee_id);
    push(db.feesByInvestor, fee.investor_id, fee.fee_id);
  }

  // Index distributions
  for (const dist of distributions) {
    push(db.distributionsByAllocation, dist.allocation_id, dist.distribution_id);
    push(db.distributionsByInvestor, dist.investor_id, dist.distribution_id);
  }

  // Index statement lines sorted by date
  const stmtByInvestor = new Map<string, RawStatementLine[]>();
  for (const line of statementLines) {
    if (!stmtByInvestor.has(line.investor_id)) stmtByInvestor.set(line.investor_id, []);
    stmtByInvestor.get(line.investor_id)!.push(line);
  }
  for (const [invId, lines] of stmtByInvestor) {
    db.statementLines.set(
      invId,
      lines.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      )
    );
  }

  _db = db;
  return _db;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(value);
}

/** List all investors as { id, name } for the selector */
export function listInvestors(
  db: Database
): { id: string; name: string; type: string; reportingCurrency: string }[] {
  return [...db.investors.values()]
    .map((i) => ({
      id: i.investor_id,
      name: i.investor_name,
      type: i.investor_type,
      reportingCurrency: i.reporting_currency,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
