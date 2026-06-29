import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/data/loader";
import { validateInvestor } from "@/lib/policy/access";
import { getPortfolioOverview } from "@/lib/domain/portfolio";
import { getObligations } from "@/lib/domain/obligations";
import { buildStarterPrompts } from "@/lib/query/router";
import { fmt, fmtMultiple } from "@/lib/domain/fx";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ investorId: string }> }
): Promise<NextResponse> {
  try {
    const { investorId } = await params;
    const db = getDatabase();

    const validation = validateInvestor(investorId, db);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.reason }, { status: 404 });
    }

    const investor = db.investors.get(investorId)!;
    const overview = getPortfolioOverview(investorId, db);
    const obligations = getObligations(investorId, db);
    const starterPrompts = buildStarterPrompts(investorId, db);

    // Derive top sectors
    const sectorCounts = new Map<string, number>();
    for (const pos of overview.positions) {
      sectorCounts.set(pos.sector, (sectorCounts.get(pos.sector) ?? 0) + 1);
    }
    const topSectors = [...sectorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s]) => s);

    // Build compact holdings list
    const holdings = overview.positions.map((p) => ({
      allocationId: p.allocationId,
      company: p.companyName,
      round: p.round,
      sector: p.sector,
      dealStatus: p.dealStatus,
      allocationStatus: p.allocationStatus,
      moic: p.moic,
      moicFormatted: fmtMultiple(p.moic),
      currentValue: fmt(p.currentValueRpt, p.reportingCurrency),
      contributed: fmt(p.contributedRpt, p.reportingCurrency),
    }));

    const hasOverdue = obligations.fees.some((f) => f.status === "Overdue");
    const upcomingCount =
      obligations.capitalCalls.length + obligations.fees.length;

    // ── Demo-flow enrichment ──────────────────────────────────────────────────
    const allocIds = db.allocationsByInvestor.get(investorId) ?? [];

    // Build company → rounds map for demo context
    const companyRoundsMap = new Map<string, { name: string; rounds: string[]; hasFeeDiscount: boolean }>();
    for (const allocId of allocIds) {
      const alloc = db.allocations.get(allocId);
      if (!alloc) continue;
      const deal = db.deals.get(alloc.deal_id);
      if (!deal) continue;
      const existing = companyRoundsMap.get(deal.company_id) ?? { name: deal.company_name, rounds: [], hasFeeDiscount: false };
      if (!existing.rounds.includes(deal.round)) existing.rounds.push(deal.round);
      if (alloc.fee_discount === "Yes") existing.hasFeeDiscount = true;
      companyRoundsMap.set(deal.company_id, existing);
    }

    const allCompanyRounds = [...companyRoundsMap.values()];
    const multiRoundEntry = allCompanyRounds
      .filter((c) => c.rounds.length >= 2)
      .sort((a, b) => b.rounds.length - a.rounds.length)[0] ?? null;

    const hasDistributions = (db.distributionsByInvestor.get(investorId) ?? []).length > 0;
    const hasFeeDiscount = allCompanyRounds.some((c) => c.hasFeeDiscount);

    const personalizationTier: "Emerging" | "Established" | "Experienced" =
      investor.tech_savviness === "High"
        ? "Experienced"
        : investor.tech_savviness === "Medium"
        ? "Established"
        : "Emerging";

    return NextResponse.json({
      investor: {
        id: investor.investor_id,
        name: investor.investor_name,
        type: investor.investor_type,
        country: investor.country,
        reportingCurrency: investor.reporting_currency,
        kycStatus: investor.kyc_status,
        onboardedDate: investor.onboarded_date,
        techSavviness: investor.tech_savviness,
        age: investor.age || null,
        email: investor.email,
      },
      snapshot: {
        reportDate: "2026-06-25",
        reportingCurrency: overview.reportingCurrency,
        totalValue: fmt(overview.totalValueRpt, overview.reportingCurrency),
        totalValueRaw: overview.totalValueRpt,
        totalContributed: fmt(overview.totalContributedRpt, overview.reportingCurrency),
        totalContributedRaw: overview.totalContributedRpt,
        totalCommitted: fmt(overview.totalCommittedRpt, overview.reportingCurrency),
        portfolioMoic: fmtMultiple(overview.portfolioMoic),
        portfolioMoicRaw: overview.portfolioMoic,
        activePositions: overview.activePositions,
        pendingPositions: overview.pendingPositions,
        topSectors,
        holdings,
        hasOverdueObligations: hasOverdue,
        upcomingObligationsCount: upcomingCount,
        totalObligations: fmt(
          obligations.totalObligationsRpt,
          overview.reportingCurrency
        ),
        // Demo-flow fields
        multiRoundCompany: multiRoundEntry
          ? { name: multiRoundEntry.name, roundCount: multiRoundEntry.rounds.length, rounds: multiRoundEntry.rounds }
          : null,
        hasDistributions,
        hasFeeDiscount,
        personalizationTier,
      },
      starterPrompts,
    });
  } catch (err) {
    console.error("[snapshot] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
