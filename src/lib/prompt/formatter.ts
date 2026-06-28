import type { Database } from "../data/loader";
import type { QueryIntent } from "../domain/types";

interface InvestorProfile {
  name: string;
  techSavviness: "Low" | "Medium" | "High";
  age: number | null;
  reportingCurrency: string;
  dealCount: number;
  topSectors: string[];
  kycStatus: string;
}

export function buildInvestorProfile(
  investorId: string,
  db: Database
): InvestorProfile {
  const investor = db.investors.get(investorId)!;
  const allocIds = db.allocationsByInvestor.get(investorId) ?? [];

  const dealCount = allocIds.length;
  const age =
    investor.age && investor.age !== ""
      ? parseInt(investor.age, 10)
      : null;

  // Derive top sectors from allocations
  const sectorCounts = new Map<string, number>();
  for (const allocId of allocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    const company = db.companies.get(deal.company_id);
    if (!company) continue;
    sectorCounts.set(
      company.sector,
      (sectorCounts.get(company.sector) ?? 0) + 1
    );
  }
  const topSectors = [...sectorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sector]) => sector);

  return {
    name: investor.investor_name,
    techSavviness: investor.tech_savviness,
    age,
    reportingCurrency: investor.reporting_currency,
    dealCount,
    topSectors,
    kycStatus: investor.kyc_status,
  };
}

export function buildSystemPrompt(
  profile: InvestorProfile,
  intent: QueryIntent
): string {
  const { name, techSavviness, age, dealCount, topSectors, reportingCurrency } =
    profile;

  const isExperienced = techSavviness === "High" || dealCount >= 5;
  const isNovice = techSavviness === "Low" || (age !== null && age >= 65);

  // Style guidance based on profile
  const styleGuide = isNovice
    ? `- Use plain, jargon-free language.
- Define financial terms when you use them: explain MOIC as "return multiple", carry as "performance fee withheld", SPV as "the investment vehicle", etc.
- Keep answers concise (3–5 sentences per topic). Avoid tables unless essential.
- Lead with the "what it means for you" conclusion before the numbers.`
    : isExperienced
    ? `- Be concise and data-dense. Assume full fluency with MOIC, IRR, carry, SPV, cost basis, DPI, RVPI, FX.
- Use structured formatting: tables, bullet lists, numbers first.
- No need to define standard VC terms.
- Skip preamble — lead directly with the data.`
    : `- Balance clarity with depth. Define only truly complex or deal-specific terms.
- Use short structured answers with key numbers highlighted.
- Assume the investor understands basic investing concepts.`;

  const sectorContext =
    topSectors.length > 0
      ? `Their strongest exposure is in: ${topSectors.join(", ")}.`
      : "";

  return `You are the EquiTie Investor Assistant, serving ${name}.

INVESTOR PROFILE:
- Technical sophistication: ${techSavviness}
- ${age !== null ? `Age: ${age}` : "Type: Entity/Corporation"}
- Active investments: ${dealCount}
- Reporting currency: ${reportingCurrency}
- ${sectorContext}

RESPONSE STYLE:
${styleGuide}

RULES (non-negotiable):
1. Use ONLY the numbers in the DATA section below. Never fabricate or estimate figures.
2. Every amount you cite must match a value in the provided data. If a number isn't there, say so.
3. Always specify the currency (${reportingCurrency} unless the data shows otherwise).
4. Do not give investment advice, predictions, or recommendations.
5. The report date is 25 June 2026.
6. If data is missing or an edge case applies (Pending allocation, Write Off, zero contribution), acknowledge it explicitly.
7. For ${intent === "fee_detail" ? "fee questions: clearly distinguish between the deal's standard rate and this investor's negotiated effective rate." : intent === "distributions" ? "distribution questions: always show gross amount, performance fee withheld, and net received." : intent === "obligations" ? "obligation questions: flag Overdue items prominently before Upcoming ones." : "portfolio questions: include both unrealised current value and realised distributions in total value."}

The data below was computed deterministically by EquiTie's finance engine. Your sole job is to phrase it as a clear, accurate, personalised answer.`;
}

export function buildUserTurn(
  userMessage: string,
  computedData: unknown
): string {
  return `User question: "${userMessage}"

DATA (do not modify these numbers):
${JSON.stringify(computedData, null, 2)}

Please answer the question using this data. Format your response clearly for the investor.`;
}
