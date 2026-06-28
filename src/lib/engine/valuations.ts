import type { Database } from "../data/loader";
import type { EngineResult } from "./types";
import type { EvidenceItem } from "../domain/types";
import { convertCurrency, fmt } from "../domain/fx";

// ─── Result types ──────────────────────────────────────────────────────────────

export type MarkSource = "Entry" | "Internal" | "Markup Round" | "Exit" | "Write Off";

export interface MarkAnalysis {
  valuationId: string;
  date: string;
  sharePrice: number;
  companyValuationM: number;
  markSource: MarkSource;
  multipleVsEntry: number;

  // Change vs previous mark
  priceChangePct: number | null;    // null for first mark
  priceChangeAbs: number | null;    // deal-currency absolute
  isDownRound: boolean;
  daysSincePreviousMark: number | null;

  // Investor-specific — computed at this date
  realisedFractionAtDate: number;   // only distributions on or before this mark
  unrealisedUnitsAtDate: number;
  investorValueDealCcy: number;
  investorValueRpt: number;
  distributionsNetToDateRpt: number; // cumulative net distributions up to this mark
  moicAtMark: number | null;         // null when contributed = 0
  unrealisedGainLossRpt: number;     // investorValueRpt + distToDateRpt - contributedRpt
}

export interface DownRoundEvent {
  date: string;
  prevDate: string;
  fromPrice: number;
  toPrice: number;
  pctDrop: number;
  dealCurrency: string;
}

export interface ValuationTimeline {
  dealId: string;
  allocationId: string;
  companyName: string;
  round: string;
  dealCurrency: string;
  reportingCurrency: string;
  dealStatus: "Active" | "Exited" | "Written Off";

  // Entry context
  entrySharePrice: number;
  effectiveSharePrice: number;
  units: number;
  contributedRpt: number;

  marks: MarkAnalysis[];

  // Cadence / span analytics
  markCount: number;
  firstMarkDate: string | null;
  lastMarkDate: string | null;
  spanDays: number;                  // first → last mark
  maxGapDays: number;                // longest consecutive gap
  isSparse: boolean;                 // maxGapDays > 365

  // Summary at latest mark
  latestSharePrice: number | null;
  latestMoic: number | null;
  latestInvestorValueRpt: number | null;

  // Peak (highest MOIC ever reached)
  peakMoic: number | null;
  peakMoicDate: string | null;
  peakSharePrice: number | null;

  // Net gain/loss at latest mark
  currentUnrealisedGainLossRpt: number | null;

  // Flags
  hasDownRound: boolean;
  downRounds: DownRoundEvent[];
  isWrittenOff: boolean;
  isExited: boolean;

  evidence: EvidenceItem[];
}

export interface ValuationTimelineResult {
  investorId: string;
  reportingCurrency: string;
  companyQuery: string;
  timelines: ValuationTimeline[];
  noDataReason: string | null;
}

// ─── Main engine function ──────────────────────────────────────────────────────

export function getInvestorValuationTimeline(
  investorId: string,
  companyQuery: string,
  db: Database
): EngineResult<ValuationTimelineResult> {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const toRpt = (amount: number, fromCcy: string) =>
    convertCurrency(amount, fromCcy, rptCcy, db.fxRates);

  const warnings: string[] = [];
  const lower = companyQuery.toLowerCase().trim();

  // ── Scored company matching ────────────────────────────────────────────────
  let targetCompanyId: string | null = null;
  // When a query is provided but matches nothing, we must return empty rather than all deals
  let queryResolved = !lower; // true when no query (show all), false until a match is found

  if (lower) {
    const scored: { id: string; score: number }[] = [];
    for (const [name, co] of db.companiesByName) {
      let score = 0;
      if (lower === name) {
        score = 1.0;
      } else if (name.includes(lower) || lower.includes(name)) {
        score = 0.8;
      } else {
        const words = name.split(/\s+/).filter((w) => w.length > 2);
        const matched = words.filter((w) => lower.includes(w)).length;
        if (matched > 0) score = (matched / Math.max(words.length, 1)) * 0.5;
      }
      if (score > 0) scored.push({ id: co.company_id, score });
    }

    const maxScore = scored.reduce((m, s) => Math.max(m, s.score), 0);
    const topMatches = scored.filter((s) => s.score === maxScore);

    if (topMatches.length === 1) {
      targetCompanyId = topMatches[0].id;
      queryResolved = true;
    } else if (topMatches.length > 1) {
      const names = topMatches
        .map((m) => db.companies.get(m.id)?.company_name)
        .filter(Boolean);
      warnings.push(
        `"${companyQuery}" matched multiple companies: ${names.join(", ")}. Please be more specific.`
      );
      // Treat as unresolved — no timelines to avoid data mixing
    }
    // If topMatches.length === 0, queryResolved stays false → returns empty
  }

  // ── Build timelines ────────────────────────────────────────────────────────
  const allocIds = db.allocationsByInvestor.get(investorId) ?? [];
  const timelines: ValuationTimeline[] = [];
  const allEvidence: EvidenceItem[] = [];
  const seenDealIds = new Set<string>();

  // If a company query was given but couldn't be resolved to any company, return early
  if (!queryResolved) {
    return {
      result: {
        investorId,
        reportingCurrency: rptCcy,
        companyQuery,
        timelines: [],
        noDataReason: `No company matching "${companyQuery}" found in this investor's portfolio.`,
      },
      evidence: [],
      assumptions: [],
      warnings: [...warnings, `No company matching "${companyQuery}" found.`],
    };
  }

  for (const allocId of allocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    const company = db.companies.get(deal.company_id);
    if (!company) continue;

    if (targetCompanyId && company.company_id !== targetCompanyId) continue;
    if (seenDealIds.has(deal.deal_id)) continue; // dedupe (one alloc per deal per investor)
    seenDealIds.add(deal.deal_id);

    const rawMarks = db.valuationsByDeal.get(deal.deal_id) ?? [];
    if (rawMarks.length === 0) {
      warnings.push(
        `${company.company_name} ${deal.round}: No valuation marks found in the dataset.`
      );
      continue;
    }

    const dealCcy = alloc.deal_currency;
    const units = parseFloat(alloc.units);
    const contributed = parseFloat(alloc.contributed_amount);
    const contributedRpt = toRpt(contributed, dealCcy);

    // All distributions for this allocation, with their dates
    const distIds = db.distributionsByAllocation.get(allocId) ?? [];
    const distsSorted = distIds
      .map((id) => db.distributions.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.distribution_date.localeCompare(b.distribution_date));

    // ── Build per-mark analysis ────────────────────────────────────────────
    const marksSorted = [...rawMarks].sort((a, b) =>
      a.valuation_date.localeCompare(b.valuation_date)
    );

    const evidence: EvidenceItem[] = [];
    const markAnalyses: MarkAnalysis[] = [];
    let prevMark: (typeof marksSorted)[0] | null = null;

    for (const raw of marksSorted) {
      const sharePrice = parseFloat(raw.share_price);
      const companyValM = parseFloat(raw.company_valuation_m);
      const markSource = raw.mark_source as MarkSource;
      const multipleVsEntry = parseFloat(raw.multiple_vs_entry);

      // Date-accurate realised fraction: only include distributions on or before this mark
      let realisedFractionAtDate = 0;
      let distNetToDate = 0;
      for (const d of distsSorted) {
        if (d.distribution_date <= raw.valuation_date) {
          realisedFractionAtDate += parseFloat(d.fraction_of_units);
          distNetToDate += parseFloat(d.net_amount);
        }
      }
      realisedFractionAtDate = Math.min(1, realisedFractionAtDate);
      const distNetToDateRpt = toRpt(distNetToDate, dealCcy);

      // Unrealised units at this date
      const unrealisedUnitsAtDate =
        markSource === "Exit" || markSource === "Write Off"
          ? 0
          : Math.max(0, 1 - realisedFractionAtDate) * units;

      const investorValueDealCcy = unrealisedUnitsAtDate * sharePrice;
      const investorValueRpt = toRpt(investorValueDealCcy, dealCcy);

      const moicAtMark =
        contributedRpt > 0
          ? (investorValueRpt + distNetToDateRpt) / contributedRpt
          : null;

      const unrealisedGainLossRpt =
        investorValueRpt + distNetToDateRpt - contributedRpt;

      // vs previous mark
      const priceChangePct =
        prevMark
          ? ((sharePrice - parseFloat(prevMark.share_price)) /
              parseFloat(prevMark.share_price)) *
            100
          : null;
      const priceChangeAbs =
        prevMark ? sharePrice - parseFloat(prevMark.share_price) : null;
      const isDownRound = priceChangePct !== null && priceChangePct < -0.01;

      const daysSincePreviousMark =
        prevMark
          ? Math.round(
              (new Date(raw.valuation_date).getTime() -
                new Date(prevMark.valuation_date).getTime()) /
                86_400_000
            )
          : null;

      markAnalyses.push({
        valuationId: raw.valuation_id,
        date: raw.valuation_date,
        sharePrice,
        companyValuationM: companyValM,
        markSource,
        multipleVsEntry,
        priceChangePct,
        priceChangeAbs,
        isDownRound,
        daysSincePreviousMark,
        realisedFractionAtDate,
        unrealisedUnitsAtDate,
        investorValueDealCcy,
        investorValueRpt,
        distributionsNetToDateRpt: distNetToDateRpt,
        moicAtMark,
        unrealisedGainLossRpt,
      });

      evidence.push({
        id: raw.valuation_id,
        sourceType: "valuation",
        label: `${company.company_name} ${deal.round} — ${markSource} (${raw.valuation_date})`,
        detail: `Share price: ${fmt(sharePrice, dealCcy)} | Company: ${companyValM}M ${dealCcy} | ${multipleVsEntry}× entry${
          isDownRound
            ? ` ↓ DOWN ROUND (${priceChangePct!.toFixed(1)}%)`
            : ""
        }${
          moicAtMark !== null
            ? ` | Investor MOIC at mark: ${moicAtMark.toFixed(2)}×`
            : ""
        }`,
        date: raw.valuation_date,
      });

      prevMark = raw;
    }

    // ── Summary analytics ──────────────────────────────────────────────────
    const markCount = markAnalyses.length;
    const firstMarkDate = markAnalyses[0]?.date ?? null;
    const lastMarkDate = markAnalyses[markCount - 1]?.date ?? null;

    const spanDays =
      firstMarkDate && lastMarkDate
        ? Math.round(
            (new Date(lastMarkDate).getTime() -
              new Date(firstMarkDate).getTime()) /
              86_400_000
          )
        : 0;

    const maxGapDays = markAnalyses.reduce((max, m, i) => {
      if (i === 0) return max;
      return Math.max(max, m.daysSincePreviousMark ?? 0);
    }, 0);

    const isSparse = maxGapDays > 365;

    if (isSparse) {
      warnings.push(
        `${company.company_name} ${deal.round}: Longest gap between valuation marks is ${Math.round(maxGapDays / 30)} months. Valuations are infrequent — position value between marks is unobservable.`
      );
    }

    const latestMark = markAnalyses[markCount - 1];
    const latestSharePrice = latestMark?.sharePrice ?? null;
    const latestMoic = latestMark?.moicAtMark ?? null;
    const latestInvestorValueRpt = latestMark?.investorValueRpt ?? null;
    const currentUnrealisedGainLossRpt = latestMark?.unrealisedGainLossRpt ?? null;

    // Peak MOIC
    const withMoic = markAnalyses.filter((m) => m.moicAtMark !== null);
    const peakMark =
      withMoic.length > 0
        ? withMoic.reduce((best, m) => (m.moicAtMark! > best.moicAtMark! ? m : best))
        : null;
    const peakMoic = peakMark?.moicAtMark ?? null;
    const peakMoicDate = peakMark?.date ?? null;
    const peakSharePrice = peakMark?.sharePrice ?? null;

    // Down rounds
    const downRounds: DownRoundEvent[] = markAnalyses
      .filter((m) => m.isDownRound)
      .map((m, i) => {
        const prevIdx = markAnalyses.findIndex((x) => x.valuationId === m.valuationId) - 1;
        const prev = markAnalyses[prevIdx];
        return {
          date: m.date,
          prevDate: prev?.date ?? "",
          fromPrice: prev?.sharePrice ?? 0,
          toPrice: m.sharePrice,
          pctDrop: Math.abs(m.priceChangePct ?? 0),
          dealCurrency: dealCcy,
        };
      });

    const isWrittenOff = markAnalyses.some((m) => m.markSource === "Write Off");
    const isExited = markAnalyses.some((m) => m.markSource === "Exit");

    if (isWrittenOff) {
      warnings.push(
        `${company.company_name} ${deal.round}: Written off — position value is zero.`
      );
    }
    if (downRounds.length > 0) {
      warnings.push(
        `${company.company_name} ${deal.round}: ${downRounds.length} down round(s) detected — share price declined at these marks: ${downRounds.map((d) => d.date).join(", ")}.`
      );
    }
    if (markCount < 3 && spanDays > 365) {
      warnings.push(
        `${company.company_name} ${deal.round}: Only ${markCount} valuation mark(s) over ${Math.round(spanDays / 365)} year(s). Fair value between marks is not observable from this dataset.`
      );
    }

    allEvidence.push(...evidence);

    timelines.push({
      dealId: deal.deal_id,
      allocationId: allocId,
      companyName: company.company_name,
      round: deal.round,
      dealCurrency: dealCcy,
      reportingCurrency: rptCcy,
      dealStatus: deal.status,
      entrySharePrice: parseFloat(deal.entry_share_price),
      effectiveSharePrice: parseFloat(alloc.effective_share_price),
      units,
      contributedRpt,
      marks: markAnalyses,
      markCount,
      firstMarkDate,
      lastMarkDate,
      spanDays,
      maxGapDays,
      isSparse,
      latestSharePrice,
      latestMoic,
      latestInvestorValueRpt,
      peakMoic,
      peakMoicDate,
      peakSharePrice,
      currentUnrealisedGainLossRpt,
      hasDownRound: downRounds.length > 0,
      downRounds,
      isWrittenOff,
      isExited,
      evidence,
    });
  }

  const noDataReason =
    timelines.length === 0
      ? lower
        ? `No valuation history found for "${companyQuery}" in this investor's portfolio.`
        : "No valuation history found for this investor."
      : null;

  if (noDataReason) warnings.push(noDataReason);

  return {
    result: {
      investorId,
      reportingCurrency: rptCcy,
      companyQuery,
      timelines,
      noDataReason,
    },
    evidence: allEvidence,
    assumptions: [
      "Valuation marks are sourced exclusively from valuations.csv — no interpolation or extrapolation between marks.",
      "MOIC at each mark = (investor's unrealised value at that mark + cumulative net distributions up to that date) ÷ contributed capital.",
      "Unrealised value at each mark = unrealised units × share price at that mark, where unrealised units accounts only for distributions dated on or before that mark.",
      "For Exit and Write Off marks, unrealised value = 0 (position fully realised or worthless).",
      "Unrealised gain/loss = investor value at latest mark + cumulative distributions − total contributed capital.",
      "All amounts converted to reporting currency via USD bridge at static FX rates. Multi-currency positions are affected by the rate snapshot date.",
      "Mark cadence is as reported — EquiTie does not fill gaps between marks.",
    ],
    warnings,
  };
}
