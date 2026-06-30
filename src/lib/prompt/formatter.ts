import type { Database } from "../data/loader";
import type { QueryIntent } from "../domain/types";

interface InvestorProfile {
  name: string;
  techSavviness: "Low" | "Medium" | "High";
  age: number | null;
  reportingCurrency: string;
  dealCount: number;
  topSectors: string[];
  sectorCount: number;
  multiRoundCompanies: string[];
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

  const sectorCounts = new Map<string, number>();
  const companyRoundCounts = new Map<string, number>();

  for (const allocId of allocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    const company = db.companies.get(deal.company_id);
    if (!company) continue;
    sectorCounts.set(company.sector, (sectorCounts.get(company.sector) ?? 0) + 1);
    companyRoundCounts.set(company.company_name, (companyRoundCounts.get(company.company_name) ?? 0) + 1);
  }

  const topSectors = [...sectorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sector]) => sector);

  const multiRoundCompanies = [...companyRoundCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  return {
    name: investor.investor_name,
    techSavviness: investor.tech_savviness,
    age,
    reportingCurrency: investor.reporting_currency,
    dealCount,
    topSectors,
    sectorCount: sectorCounts.size,
    multiRoundCompanies,
    kycStatus: investor.kyc_status,
  };
}

export function buildSystemPrompt(
  profile: InvestorProfile,
  intent: QueryIntent
): string {
  const { name, techSavviness, age, dealCount, topSectors, sectorCount, multiRoundCompanies, reportingCurrency } =
    profile;

  // Tech savviness is the primary signal.
  // Age >= 65 nudges toward novice only when tech savviness is not High —
  // a technically sophisticated older investor should not get patronising treatment.
  const isNovice = techSavviness === "Low" || (age !== null && age >= 65 && techSavviness !== "High");
  const isExperienced = !isNovice && (techSavviness === "High" || dealCount >= 5);

  // Portfolio shape — concentration and follow-on behaviour
  const portfolioShape = buildPortfolioShape(dealCount, topSectors, sectorCount, multiRoundCompanies);

  const styleGuide = isNovice
    ? `- Use plain, jargon-free language. Never talk down — the investor may be very experienced in their own field.
- Define financial terms the first time you use them: MOIC = "return multiple", carry = "performance fee withheld", SPV = "the investment vehicle", DPI = "cash returned vs deployed".
- Keep answers focused (3–5 sentences per topic). Avoid tables unless they genuinely help.
- Lead with the "what this means for you" takeaway before the numbers.
- Ground answers in this investor's specific holdings by name — do not answer generically.`
    : isExperienced
    ? `- Be concise and data-dense. Assume full fluency with MOIC, IRR, carry, SPV, cost basis, DPI, RVPI, FX.
- Use structured formatting: tables and bullet lists, numbers first.
- No need to define standard VC terms.
- Skip preamble — lead directly with the data.
- Where relevant, tie the answer back to this investor's portfolio shape: their sectors, concentration, and follow-on history.`
    : `- Balance clarity with depth. Define only deal-specific or non-standard terms.
- Use short structured answers with key numbers highlighted.
- Assume the investor understands basic investing concepts.
- Connect the answer to this investor's specific positions and sectors rather than speaking in generalities.`;

  return `You are the EquiTie Investor Assistant, serving ${name}.

INVESTOR PROFILE:
- Technical sophistication: ${techSavviness}
- ${age !== null ? `Age: ${age}` : "Type: Entity/Corporation"}
- Active investments: ${dealCount}
- Reporting currency: ${reportingCurrency}
- Portfolio shape: ${portfolioShape}

RESPONSE STYLE:
${styleGuide}

RULES (non-negotiable):
1. Use ONLY the numbers in the DATA section below. Never fabricate or estimate figures.
2. Every amount you cite must match a value in the provided data. If a number isn't there, say so.
3. Always specify the currency (${reportingCurrency} unless the data shows otherwise).
4. Do not give investment advice, predictions, or recommendations.
5. The report date is 25 June 2026.
6. If data is missing or an edge case applies (Pending allocation, Write Off, zero contribution), acknowledge it explicitly.
7. Never be patronising. Adjust tone and depth, not respect. Never over-explain to someone capable of understanding more.
8. For ${intent === "fee_detail" ? "fee questions: clearly distinguish between the deal's standard rate and this investor's negotiated effective rate." : intent === "distributions" ? "distribution questions: always show gross amount, performance fee withheld, and net received." : intent === "obligations" ? "obligation questions: flag Overdue items prominently before Upcoming ones." : "portfolio questions: include both unrealised current value and realised distributions in total value."}

The data below was computed deterministically by EquiTie's finance engine. Your sole job is to phrase it as a clear, accurate, personalised answer.`;
}

function buildPortfolioShape(
  dealCount: number,
  topSectors: string[],
  sectorCount: number,
  multiRoundCompanies: string[]
): string {
  if (dealCount === 0) return "No active investments yet.";

  const parts: string[] = [];

  if (sectorCount === 1 && topSectors[0]) {
    parts.push(`Fully concentrated in ${topSectors[0]}`);
  } else if (sectorCount === 2) {
    parts.push(`Concentrated across ${topSectors.slice(0, 2).join(" and ")}`);
  } else if (topSectors.length >= 3) {
    parts.push(`Diversified across ${topSectors[0]}, ${topSectors[1]}, and ${topSectors[2]}`);
  }

  if (multiRoundCompanies.length > 0) {
    parts.push(`Has followed on into multiple rounds of: ${multiRoundCompanies.join(", ")}`);
  }

  return parts.join(". ") || `${dealCount} active deal${dealCount !== 1 ? "s" : ""}`;
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
