import type { Database } from "../data/loader";
import type { EngineResult } from "./types";
import type { EvidenceItem } from "../domain/types";
import { convertCurrency, fmt } from "../domain/fx";

const REPORT_DATE = "2026-06-25";

// ─── Result types ──────────────────────────────────────────────────────────────

export interface FeeScheduleLine {
  feeType: "Management Fee" | "Performance Fee" | "Structuring Fee" | "Admin Fee";
  basis: "% of commitment" | "flat USD";
  /** Standard rate: percentage for %, flat USD for Admin */
  standardRate: number;
  /** This investor's effective rate */
  effectiveRate: number;
  /** Percentage point difference (null for Admin Fee — meaningless as pct) */
  savingPp: number | null;
  /** Flat USD saved per period (Admin Fee only; null for others) */
  savingUsd: number | null;
  /**
   * One-period saving converted to reporting currency, for % fees.
   * For Mgmt Fee: (stdPct - effPct) × commitment.
   * For Structuring Fee: (stdPct - effPct) × commitment (one-time).
   * For Admin Fee: (std - eff) USD × fx.
   * For Performance Fee: null — can't know until exit.
   */
  savingRpt: number | null;
  discounted: boolean;
  /** True when the saving amount cannot be computed (Performance Fee before exit) */
  savingUndeterminable: boolean;
  /** Human note explaining why saving is undeterminable */
  undeterminableReason: string | null;
}

export interface HistoricalFeeLine {
  feeId: string;
  feeType: string;
  period: string;
  basis: "Commitment" | "Flat";
  amountNativeCcy: number;
  amountRpt: number;
  nativeCurrency: string;
  dueDate: string;
  status: "Paid" | "Upcoming" | "Overdue";
  hasDiscount: boolean;
}

export interface DealFeeResult {
  dealId: string;
  allocationId: string;
  companyName: string;
  round: string;
  dealCurrency: string;
  reportingCurrency: string;
  hasNegotiatedDiscount: boolean;
  schedule: FeeScheduleLine[];
  feeLines: HistoricalFeeLine[];
  totalPaidRpt: number;
  totalUpcomingRpt: number;
  totalOverdueRpt: number;
  /**
   * Estimated total annual saving in reporting currency (Management Fee only,
   * since that's the recurring fee where saving is unambiguous).
   * Null when no mgmt discount.
   */
  estimatedAnnualMgmtSavingRpt: number | null;
  /** Carry is charged at distribution time, not tracked as a fee line. */
  performanceFeeNote: string;
  /** True if no fee lines exist yet (typically a pending allocation). */
  noFeesYet: boolean;
  /** Plain one-sentence summary for Emerging investors. */
  plainSummary: string;
  evidence: EvidenceItem[];
}

export interface FeeBreakdownResult {
  investorId: string;
  reportingCurrency: string;
  companyQuery: string;
  deals: DealFeeResult[];
  hasAnyDiscount: boolean;
  totalPaidRpt: number;
  totalUpcomingRpt: number;
  totalOverdueRpt: number;
}

// ─── Main engine function ──────────────────────────────────────────────────────

export function getInvestorFeeBreakdown(
  investorId: string,
  companyQuery: string,
  db: Database
): EngineResult<FeeBreakdownResult> {
  const investor = db.investors.get(investorId);
  if (!investor) throw new Error(`Investor ${investorId} not found`);

  const rptCcy = investor.reporting_currency;
  const toRpt = (amount: number, fromCcy: string) =>
    convertCurrency(amount, fromCcy, rptCcy, db.fxRates);

  // ── Company resolution (scored matching) ──────────────────────────────────
  const lower = companyQuery.toLowerCase().trim();
  let targetCompanyId: string | null = null;
  const warnings: string[] = [];

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
    } else if (topMatches.length > 1) {
      const names = topMatches
        .map((m) => db.companies.get(m.id)?.company_name)
        .filter(Boolean);
      warnings.push(
        `Ambiguous company query "${companyQuery}" matched ${names.join(", ")}. Showing all matching deals.`
      );
    }
  }

  // ── Compute per-deal fee breakdown ────────────────────────────────────────
  const allocIds = db.allocationsByInvestor.get(investorId) ?? [];
  const deals: DealFeeResult[] = [];
  const evidence: EvidenceItem[] = [];

  let totalPaidRpt = 0;
  let totalUpcomingRpt = 0;
  let totalOverdueRpt = 0;
  let hasAnyDiscount = false;

  for (const allocId of allocIds) {
    const alloc = db.allocations.get(allocId);
    if (!alloc) continue;
    const deal = db.deals.get(alloc.deal_id);
    if (!deal) continue;
    const company = db.companies.get(deal.company_id);
    if (!company) continue;

    if (targetCompanyId && company.company_id !== targetCompanyId) continue;

    const commitment = parseFloat(alloc.commitment_amount);
    const dealCcy = alloc.deal_currency;

    // ── Standard rates from deal ───────────────────────────────────────────
    const stdMgmtPct = parseFloat(deal.std_mgmt_fee_pct);
    const stdPerfPct = parseFloat(deal.std_performance_fee_pct);
    const stdStructPct = parseFloat(deal.std_structuring_fee_pct);
    const stdAdminUsd = parseFloat(deal.std_admin_fee_usd);

    // ── Effective rates from investor's allocation ─────────────────────────
    const effMgmtPct = parseFloat(alloc.mgmt_fee_pct);
    const effPerfPct = parseFloat(alloc.performance_fee_pct);
    const effStructPct = parseFloat(alloc.structuring_fee_pct);
    const effAdminUsd = parseFloat(alloc.admin_fee_usd);

    const hasDiscount = alloc.fee_discount === "Yes";
    if (hasDiscount) hasAnyDiscount = true;

    // ── Build fee schedule ─────────────────────────────────────────────────
    const schedule: FeeScheduleLine[] = [];

    // Management Fee
    const mgmtSavingPp = stdMgmtPct - effMgmtPct;
    const mgmtDiscounted = mgmtSavingPp > 0.0001;
    const mgmtSavingRpt = mgmtDiscounted
      ? toRpt((mgmtSavingPp / 100) * commitment, dealCcy)
      : null;
    schedule.push({
      feeType: "Management Fee",
      basis: "% of commitment",
      standardRate: stdMgmtPct,
      effectiveRate: effMgmtPct,
      savingPp: mgmtDiscounted ? mgmtSavingPp : null,
      savingUsd: null,
      savingRpt: mgmtSavingRpt,
      discounted: mgmtDiscounted,
      savingUndeterminable: false,
      undeterminableReason: null,
    });

    // Performance Fee (carry)
    const perfSavingPp = stdPerfPct - effPerfPct;
    const perfDiscounted = perfSavingPp > 0.0001;
    schedule.push({
      feeType: "Performance Fee",
      basis: "% of commitment",
      standardRate: stdPerfPct,
      effectiveRate: effPerfPct,
      savingPp: perfDiscounted ? perfSavingPp : null,
      savingUsd: null,
      savingRpt: null, // can't compute: depends on future exit proceeds
      discounted: perfDiscounted,
      savingUndeterminable: true,
      undeterminableReason:
        "Performance fee (carry) is applied to exit proceeds at distribution time. The saving in dollar terms cannot be determined until the deal exits.",
    });

    // Structuring Fee (one-time)
    const structSavingPp = stdStructPct - effStructPct;
    const structDiscounted = structSavingPp > 0.0001;
    const structSavingRpt = structDiscounted
      ? toRpt((structSavingPp / 100) * commitment, dealCcy)
      : null;
    schedule.push({
      feeType: "Structuring Fee",
      basis: "% of commitment",
      standardRate: stdStructPct,
      effectiveRate: effStructPct,
      savingPp: structDiscounted ? structSavingPp : null,
      savingUsd: null,
      savingRpt: structSavingRpt,
      discounted: structDiscounted,
      savingUndeterminable: false,
      undeterminableReason: null,
    });

    // Admin Fee (flat USD)
    const adminSavingUsd = stdAdminUsd - effAdminUsd;
    const adminDiscounted = adminSavingUsd > 0.01;
    const adminSavingRpt = adminDiscounted ? toRpt(adminSavingUsd, "USD") : null;
    schedule.push({
      feeType: "Admin Fee",
      basis: "flat USD",
      standardRate: stdAdminUsd,
      effectiveRate: effAdminUsd,
      savingPp: null, // meaningless for flat fee
      savingUsd: adminDiscounted ? adminSavingUsd : null,
      savingRpt: adminSavingRpt,
      discounted: adminDiscounted,
      savingUndeterminable: false,
      undeterminableReason: null,
    });

    // ── Build historical fee lines ─────────────────────────────────────────
    const feeIds = db.feesByAllocation.get(allocId) ?? [];
    const feeLines: HistoricalFeeLine[] = [];

    let dealPaidRpt = 0;
    let dealUpcomingRpt = 0;
    let dealOverdueRpt = 0;

    for (const feeId of feeIds) {
      const fee = db.fees.get(feeId);
      if (!fee) continue;

      const amtNative = parseFloat(fee.amount);
      const amtRpt = toRpt(amtNative, fee.currency);

      const feeStatus = fee.status as "Paid" | "Upcoming" | "Overdue";
      if (feeStatus === "Paid") dealPaidRpt += amtRpt;
      else if (feeStatus === "Overdue") dealOverdueRpt += amtRpt;
      else dealUpcomingRpt += amtRpt;

      // Per-line discount flag
      let lineHasDiscount = false;
      if (fee.fee_type === "Management Fee") lineHasDiscount = mgmtDiscounted;
      else if (fee.fee_type === "Structuring Fee") lineHasDiscount = structDiscounted;
      else if (fee.fee_type === "Admin Fee") lineHasDiscount = adminDiscounted;

      feeLines.push({
        feeId: fee.fee_id,
        feeType: fee.fee_type,
        period: fee.period,
        basis: fee.basis as "Commitment" | "Flat",
        amountNativeCcy: amtNative,
        amountRpt: amtRpt,
        nativeCurrency: fee.currency,
        dueDate: fee.due_date,
        status: feeStatus,
        hasDiscount: lineHasDiscount,
      });

      evidence.push({
        id: fee.fee_id,
        sourceType: "fee",
        label: `${company.company_name} ${deal.round} — ${fee.fee_type} (${fee.period})`,
        detail: `${fee.basis === "Flat" ? "Flat" : `Rate: ${fee.fee_rate_pct}%`} | Amount: ${fmt(amtNative, fee.currency)} | Due: ${fee.due_date} | ${fee.status}${lineHasDiscount ? " ✓ discounted" : ""}`,
        amount: amtRpt,
        currency: rptCcy,
        date: fee.due_date,
      });
    }

    const noFeesYet = feeLines.length === 0;
    if (noFeesYet) {
      warnings.push(
        `${company.company_name} ${deal.round}: No fee history found. This is normal for a Pending allocation — fees will be charged once capital is called and the deal is active.`
      );
    }

    totalPaidRpt += dealPaidRpt;
    totalUpcomingRpt += dealUpcomingRpt;
    totalOverdueRpt += dealOverdueRpt;

    if (dealOverdueRpt > 0) {
      warnings.push(
        `${company.company_name} ${deal.round}: Overdue fees totalling ${fmt(dealOverdueRpt, rptCcy)}.`
      );
    }

    // ── Performance fee note ───────────────────────────────────────────────
    const performanceFeeNote = effPerfPct === 0
      ? `No performance fee (carry) applies to your position in ${company.company_name} ${deal.round}.`
      : `Performance fee (carry): ${effPerfPct}% of net profits${perfDiscounted ? ` — discounted from the standard ${stdPerfPct}% (saving ${perfSavingPp.toFixed(1)} pp)` : ""}. This is charged at exit or secondary sale, not as an ongoing fee. It is deducted from gross distribution proceeds.`;

    // ── Plain-language summary ─────────────────────────────────────────────
    const discountedItems = schedule.filter((s) => s.discounted).map((s) => s.feeType);
    const plainSummary = buildPlainSummary(
      company.company_name,
      deal.round,
      hasDiscount,
      discountedItems,
      effMgmtPct,
      stdMgmtPct,
      effPerfPct,
      noFeesYet
    );

    deals.push({
      dealId: alloc.deal_id,
      allocationId: allocId,
      companyName: company.company_name,
      round: deal.round,
      dealCurrency: dealCcy,
      reportingCurrency: rptCcy,
      hasNegotiatedDiscount: hasDiscount,
      schedule,
      feeLines: feeLines.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      totalPaidRpt: dealPaidRpt,
      totalUpcomingRpt: dealUpcomingRpt,
      totalOverdueRpt: dealOverdueRpt,
      estimatedAnnualMgmtSavingRpt: mgmtSavingRpt,
      performanceFeeNote,
      noFeesYet,
      plainSummary,
      evidence,
    });
  }

  // ── Cross-deal warnings ───────────────────────────────────────────────────
  if (deals.length === 0) {
    if (lower) {
      warnings.push(
        `No deals found matching "${companyQuery}" in this investor's portfolio.`
      );
    } else {
      warnings.push("No deals found for this investor.");
    }
  }

  const currencies = new Set(deals.map((d) => d.dealCurrency));
  currencies.delete(rptCcy);
  if (currencies.size > 0) {
    warnings.push(
      `Fee amounts in [${[...currencies].join(", ")}] converted to ${rptCcy} at static FX rates as of ${REPORT_DATE}.`
    );
  }

  return {
    result: {
      investorId,
      reportingCurrency: rptCcy,
      companyQuery,
      deals,
      hasAnyDiscount,
      totalPaidRpt,
      totalUpcomingRpt,
      totalOverdueRpt,
    },
    evidence,
    assumptions: [
      "Standard fee schedule sourced from the deal record (deals.csv).",
      "Investor-specific rates sourced from the allocation record (allocations.csv).",
      "Management fee is calculated on committed capital, charged periodically.",
      "Structuring fee is a one-time fee on committed capital, charged at deal entry.",
      "Admin fee is a flat annual amount in USD, regardless of deal currency.",
      "Performance fee (carry) is charged on net profits at the time of exit or secondary sale. It is not tracked as a fee line item — it appears in distribution records as a deduction from gross proceeds.",
      `FX rates fixed at ${REPORT_DATE}.`,
    ],
    warnings,
  };
}

// ─── Plain-language summary builder ──────────────────────────────────────────

function buildPlainSummary(
  company: string,
  round: string,
  hasDiscount: boolean,
  discountedItems: string[],
  effMgmtPct: number,
  stdMgmtPct: number,
  effPerfPct: number,
  noFeesYet: boolean
): string {
  if (noFeesYet) {
    return `No fees have been charged yet for ${company} ${round} — this is expected if your investment is still pending or very recent.`;
  }

  const managedStr =
    effMgmtPct > 0
      ? `an ongoing management fee of ${effMgmtPct}% of your committed amount per year`
      : "no ongoing management fee";

  const carryStr =
    effPerfPct > 0
      ? `, plus a ${effPerfPct}% performance fee (called "carry") on any profits when the company exits`
      : "";

  const discountStr =
    hasDiscount && discountedItems.length > 0
      ? ` You have negotiated lower rates on: ${discountedItems.join(", ")}.`
      : effMgmtPct < stdMgmtPct
      ? ` Note: your management fee rate (${effMgmtPct}%) is lower than the standard rate (${stdMgmtPct}%).`
      : "";

  return `For your investment in ${company} ${round}, you pay ${managedStr}${carryStr}.${discountStr}`;
}
