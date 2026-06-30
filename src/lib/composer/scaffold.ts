import type { KeyMetric } from "./types";
import type { ExtractedEntities, QueryIntent } from "../domain/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type D = Record<string, unknown>;

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNum(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function moicSentiment(raw: unknown): KeyMetric["sentiment"] {
  if (raw === null || raw === undefined || typeof raw !== "number") return "neutral";
  if (raw >= 2) return "positive";
  if (raw >= 1) return "neutral";
  return "negative";
}

function moicFromFormatted(s: string): number | null {
  const m = s.match(/^([\d.]+)×?$/);
  return m ? parseFloat(m[1]) : null;
}

// ─── Title ───────────────────────────────────────────────────────────────────

export function buildTitle(
  intent: QueryIntent,
  entities: ExtractedEntities,
  data: unknown
): string {
  const d = (data ?? {}) as D;

  switch (intent) {
    case "portfolio_overview":
      return "Portfolio Overview";
    case "position_detail":
      return entities.companyName
        ? `Position: ${entities.companyName}`
        : asStr(d.company)
        ? `Position: ${asStr(d.company)}`
        : "Position Detail";
    case "obligations":
      return "Upcoming Obligations";
    case "distributions":
      return "Distributions Received";
    case "fee_detail":
      return entities.companyName
        ? `Fee Breakdown — ${entities.companyName}`
        : "Fee Breakdown";
    case "valuation_history":
      return entities.companyName
        ? `Valuation History — ${entities.companyName}`
        : "Valuation History";
    case "account_statement":
      return "Account Statement Summary";
    case "glossary_or_metric_explanation":
      return entities.metricOrTerm
        ? `What is ${entities.metricOrTerm.toUpperCase()}?`
        : "Term Explanation";
    case "unsupported_or_ambiguous":
      return "Clarification Needed";
    default:
      return "Answer";
  }
}

// ─── Key metrics ──────────────────────────────────────────────────────────────

export function buildKeyMetrics(
  intent: QueryIntent,
  data: unknown,
  reportingCurrency: string
): KeyMetric[] {
  const d = (data ?? {}) as D;

  switch (intent) {
    case "portfolio_overview": {
      const moicStr = asStr(d.portfolioMoicFormatted);
      const moicNum = moicFromFormatted(moicStr);
      const positions = asArr(d.positions);
      const pending = asNum(d.pendingPositions);
      return [
        {
          label: "Portfolio MOIC",
          value: moicStr || "N/A",
          subtext: "total value ÷ contributed",
          sentiment: moicSentiment(moicNum),
        },
        {
          label: "Total Value",
          value: asStr(d.totalValue),
          subtext: `${reportingCurrency} (unrealised + distributions)`,
          sentiment: "neutral",
        },
        {
          label: "Contributed",
          value: asStr(d.totalContributed),
          subtext: reportingCurrency,
        },
        {
          label: "Current Value",
          value: asStr(d.totalCurrentValue),
          subtext: "unrealised only",
        },
        {
          label: "Net Distributions",
          value: asStr(d.totalDistributionsNet),
          subtext: "cash received",
          sentiment: "positive",
        },
        {
          label: "Active Positions",
          value: String(asNum(d.activePositions)),
          subtext: pending > 0 ? `+ ${pending} pending` : undefined,
        },
      ].filter(m => m.value !== "") as KeyMetric[];
    }

    case "position_detail": {
      const moicStr = asStr(d.companyMoic);
      const moicNum = moicFromFormatted(moicStr);
      const rounds = asArr(d.rounds);
      return [
        {
          label: "Company MOIC",
          value: moicStr || "N/A",
          subtext: "across all rounds",
          sentiment: moicSentiment(moicNum),
        },
        {
          label: "Total Value",
          value: asStr(d.totalValue),
          subtext: reportingCurrency,
          sentiment: "neutral",
        },
        {
          label: "Contributed",
          value: asStr(d.totalContributed),
          subtext: reportingCurrency,
        },
        {
          label: "Current Value",
          value: asStr(d.totalCurrentValue),
          subtext: "unrealised",
        },
        {
          label: "Distributions",
          value: asStr(d.totalDistributions),
          subtext: "net received",
          sentiment: "positive",
        },
        ...(rounds.length > 1
          ? [{ label: "Rounds", value: String(rounds.length), subtext: "deal rounds" }]
          : []),
      ].filter(m => m.value !== "") as KeyMetric[];
    }

    case "obligations": {
      const callsArr = asArr(d.capitalCalls);
      const feesArr = asArr(d.fees);
      const overdueCount = feesArr.filter(
        (f) => (f as D).status === "Overdue"
      ).length;
      return [
        {
          label: "Total Obligations",
          value: asStr(d.totalObligations),
          subtext: reportingCurrency,
          sentiment: overdueCount > 0 ? "warning" : "neutral",
        },
        {
          label: "Capital Calls",
          value: asStr(d.totalCapitalCalls),
          subtext: `${callsArr.length} call${callsArr.length !== 1 ? "s" : ""}`,
        },
        {
          label: "Fees Due",
          value: asStr(d.totalFees),
          subtext: `${feesArr.length} line${feesArr.length !== 1 ? "s" : ""}`,
        },
        ...(overdueCount > 0
          ? [
              {
                label: "Overdue",
                value: `${overdueCount} item${overdueCount !== 1 ? "s" : ""}`,
                sentiment: "negative" as const,
              },
            ]
          : []),
      ].filter(m => m.value !== "") as KeyMetric[];
    }

    case "distributions": {
      const distsArr = asArr(d.distributions);
      return [
        {
          label: "Net Received",
          value: asStr(d.totalNet),
          subtext: `${reportingCurrency} after carry`,
          sentiment: "positive",
        },
        {
          label: "Gross",
          value: asStr(d.totalGross),
          subtext: reportingCurrency,
        },
        {
          label: "Carry Paid",
          value: asStr(d.totalPerformanceFee),
          subtext: "performance fee withheld",
          sentiment: "neutral",
        },
        {
          label: "Events",
          value: String(distsArr.length),
          subtext: `distribution event${distsArr.length !== 1 ? "s" : ""}`,
        },
      ].filter(m => m.value !== "") as KeyMetric[];
    }

    case "account_statement": {
      const summary = (d.summary ?? {}) as D;
      const netStr = asStr(summary.netCashFlow);
      const netRaw = typeof summary.netCashFlowRaw === "number" ? summary.netCashFlowRaw : null;
      const isPositiveFlow = netRaw !== null ? netRaw > 0 : !netStr.includes("-") && parseFloat(netStr.replace(/[^0-9.-]/g, "")) > 0;
      return [
        {
          label: "Net Cash Flow",
          value: isPositiveFlow ? netStr : `−${netStr}`,
          subtext: reportingCurrency,
          sentiment: isPositiveFlow ? "positive" : "neutral",
        },
        {
          label: "Contributions",
          value: asStr(summary.totalContributions),
          subtext: "cash deployed",
        },
        {
          label: "Distributions",
          value: asStr(summary.totalDistributions),
          subtext: "cash received",
          sentiment: "positive",
        },
        {
          label: "Fees Paid",
          value: asStr(summary.totalFees),
          subtext: "management + admin",
        },
      ].filter(m => m.value !== "") as KeyMetric[];
    }

    case "fee_detail": {
      const feeDeals = asArr(d.deals);
      const hasDiscount = d.hasAnyDiscount === true;
      return [
        {
          label: "Total Paid",
          value: asStr(d.totalFeesPaid),
          subtext: reportingCurrency,
        },
        {
          label: "Upcoming",
          value: asStr(d.totalFeesUpcoming),
          subtext: "still due",
          sentiment: "neutral",
        },
        ...(hasDiscount
          ? [
              {
                label: "Discount",
                value: "Yes",
                subtext: "negotiated rate",
                sentiment: "positive" as const,
              },
            ]
          : []),
        {
          label: "Deals",
          value: String(feeDeals.length),
          subtext: "with fee schedule",
        },
      ].filter(m => m.value !== "") as KeyMetric[];
    }

    default:
      return [];
  }
}

// ─── Caveats ──────────────────────────────────────────────────────────────────

/**
 * Combines engine assumptions + warnings into a single ordered caveat list.
 * Warnings (anomalies) appear first; assumptions follow.
 */
export function buildCaveats(assumptions: string[], warnings: string[]): string[] {
  const caveats: string[] = [];
  if (warnings.length > 0) caveats.push(...warnings);
  if (assumptions.length > 0) caveats.push(...assumptions);
  return caveats;
}

// ─── Follow-up questions ──────────────────────────────────────────────────────

export function buildFollowUps(
  intent: QueryIntent,
  entities: ExtractedEntities,
  data: unknown
): string[] {
  const d = (data ?? {}) as D;

  switch (intent) {
    case "portfolio_overview": {
      const positions = asArr(d.positions);
      const topCompany = (positions[0] as D | undefined)?.company;
      const followUps: string[] = [
        "What are my upcoming obligations?",
        "What have I received in distributions?",
        "What's my account statement?",
      ];
      if (topCompany) followUps.unshift(`Tell me about my position in ${topCompany}`);
      return followUps.slice(0, 4);
    }

    case "position_detail": {
      const company = entities.companyName ?? asStr(d.company);
      return [
        company ? `Show me the valuation history for ${company}` : "Show valuation history",
        company ? `What fees am I paying on ${company}?` : "What are my fees?",
        "Give me a portfolio overview",
        "What have I received in distributions?",
      ].slice(0, 3);
    }

    case "obligations": {
      const calls = asArr(d.capitalCalls);
      const topCompany = (calls[0] as D | undefined)?.company;
      return [
        topCompany
          ? `Tell me about my ${topCompany} position`
          : "Give me a portfolio overview",
        "What distributions have I received?",
        "What's my account statement?",
      ];
    }

    case "distributions": {
      const dists = asArr(d.distributions);
      const topCompany = (dists[0] as D | undefined)?.company;
      return [
        topCompany
          ? `Tell me about my position in ${topCompany}`
          : "Give me a portfolio overview",
        "What are my upcoming obligations?",
        "Give me a portfolio overview",
      ];
    }

    case "account_statement":
      return [
        "Give me a portfolio overview",
        "What are my upcoming obligations?",
        "What have I received in distributions?",
      ];

    case "fee_detail": {
      const company = entities.companyName;
      return [
        company ? `Tell me about my position in ${company}` : "Give me a portfolio overview",
        "What distributions have I received?",
        "What are my upcoming obligations?",
      ];
    }

    case "valuation_history": {
      const company = entities.companyName;
      return [
        company ? `Tell me about my position in ${company}` : "Give me a portfolio overview",
        company ? `What fees am I paying on ${company}?` : "What are my fees?",
        "Give me a portfolio overview",
      ];
    }

    default:
      return ["Give me a portfolio overview", "What are my upcoming obligations?"];
  }
}

// ─── Calculation note ──────────────────────────────────────────────────────────

export function buildCalculationNote(
  intent: QueryIntent,
  data: unknown
): string | null {
  const d = (data ?? {}) as D;

  switch (intent) {
    case "portfolio_overview":
      return [
        "**Portfolio MOIC** = (Total current unrealised value + Total net distributions) ÷ Total contributed capital.",
        "**Current value** = units × latest share price × (1 − realised fraction), per position.",
        "Exited / Written Off positions contribute 0 to current value; any proceeds appear in distributions.",
        "**FX**: all deal-currency amounts converted to reporting currency via USD bridge at static 2026-06-25 rates.",
        "Pending allocations (0 contributed) excluded from MOIC and contributed totals.",
      ].join(" ");

    case "position_detail": {
      const rounds = asArr(d.rounds);
      const multiRound = rounds.length > 1;
      return [
        multiRound
          ? `**Company MOIC** aggregates across ${rounds.length} rounds in reporting currency.`
          : "**MOIC** = (current value + net distributions) ÷ contributed capital for this round.",
        "**Unrealised value** = units × latest share price × (1 − Σ fraction_of_units from distributions).",
        "**Effective share price**: this investor's actual entry price after any negotiated discount.",
        "**FX**: deal-currency amounts converted to reporting currency at static rates.",
      ].join(" ");
    }

    case "obligations":
      return [
        "Capital call amounts are from capital_calls.csv, in deal currency, converted to reporting currency at static rates.",
        "Fee amounts from fees.csv. Admin fees are in USD regardless of deal currency.",
        '"Overdue" and "Upcoming" statuses are as recorded in the dataset — they reflect the snapshot date, not today.',
      ].join(" ");

    case "distributions":
      return [
        "**Net received** = Gross distribution − Performance fee (carry).",
        "Carry % is per the investor's allocation agreement for each deal.",
        "fraction_of_units indicates what share of the original position was realised in each event (1.0 = full exit).",
        "**FX**: distribution amounts converted to reporting currency at static rates as of 2026-06-25.",
      ].join(" ");

    case "account_statement":
      return [
        "**Net cash flow** = Total distributions received − Total capital contributions − Total fees paid.",
        "Signed convention: negative = cash out (contributions, fees); positive = cash in (distributions).",
        "Grouped by calendar month. All amounts in reporting currency at static FX rates.",
      ].join(" ");

    case "fee_detail":
      return [
        "**Effective rate** is this investor's negotiated rate. **Standard rate** is the deal's published rate.",
        "**Management fee saving** = (standard rate − effective rate) × commitment amount × months remaining / 12.",
        "**Performance fee saving** cannot be computed before exit — carry applies only to realised gains.",
        "**Admin fee**: flat USD amount — savings shown in USD, not as percentage points.",
      ].join(" ");

    case "valuation_history":
      return [
        "**MOIC at mark** = (investor value at that date + cumulative net distributions up to that date) ÷ contributed.",
        "Distributions are date-accurate: only distributions on or before each mark date are included.",
        "**Down round**: any mark where share price fell > 0.01% vs. the previous mark.",
        "Valuations sourced exclusively from valuations.csv — no interpolation between marks.",
      ].join(" ");

    default:
      return null;
  }
}
