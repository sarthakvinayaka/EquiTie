"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  ChevronDown,
  X,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Shield,
  ShieldAlert,
  LayoutGrid,
  FileText,
  BookOpen,
  Loader2,
  Tag,
  CheckCircle2,
  Info,
  ArrowUpRight,
  Activity,
  Database,
  Calendar,
  Users,
  ChevronsUpDown,
  Layers,
  Percent,
  Printer,
} from "lucide-react";
import clsx from "clsx";
import type { ChatMessage, EvidenceItem, QueryIntent } from "@/lib/domain/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Investor {
  id: string;
  name: string;
  type: string;
  reportingCurrency: string;
}

interface MultiRoundCompany {
  name: string;
  roundCount: number;
  rounds: string[];
}

interface SnapshotData {
  investor: {
    id: string;
    name: string;
    type: string;
    country: string;
    reportingCurrency: string;
    kycStatus: string;
    onboardedDate: string;
    techSavviness: string;
    age: string | null;
    email: string;
  };
  snapshot: {
    reportDate: string;
    reportingCurrency: string;
    totalValue: string;
    totalValueRaw: number;
    totalContributed: string;
    portfolioMoic: string;
    portfolioMoicRaw: number | null;
    activePositions: number;
    pendingPositions: number;
    topSectors: string[];
    holdings: {
      allocationId: string;
      company: string;
      round: string;
      sector: string;
      dealStatus: string;
      allocationStatus: string;
      moicFormatted: string;
      moic: number | null;
      currentValue: string;
      contributed: string;
    }[];
    hasOverdueObligations: boolean;
    upcomingObligationsCount: number;
    totalObligations: string;
    multiRoundCompany: MultiRoundCompany | null;
    hasDistributions: boolean;
    hasFeeDiscount: boolean;
    personalizationTier: "Emerging" | "Established" | "Experienced";
  };
  starterPrompts: string[];
}

// ─── Fee card types ────────────────────────────────────────────────────────────

interface FeeCardScheduleLine {
  feeType: string;
  basis: string;
  standardDisplay: string;
  effectiveDisplay: string;
  discounted: boolean;
  savingDisplay: string | null;
  savingRptDisplay: string | null;
  undeterminable: boolean;
  undeterminableReason: string | null;
}

interface FeeCardFeeLine {
  feeId: string;
  feeType: string;
  period: string;
  amountDisplay: string;
  amountRptDisplay: string;
  status: string;
  hasDiscount: boolean;
  dueDate: string;
}

interface FeeCardDeal {
  company: string;
  round: string;
  dealCurrency: string;
  hasDiscount: boolean;
  noFeesYet: boolean;
  plainSummary: string;
  performanceFeeNote: string;
  schedule: FeeCardScheduleLine[];
  feeLines: FeeCardFeeLine[];
  totalPaid: string;
  totalUpcoming: string;
  totalOverdue: string | null;
  estimatedAnnualMgmtSaving: string | null;
}

interface FeeCard {
  reportingCurrency: string;
  hasAnyDiscount: boolean;
  totalPaid: string;
  totalUpcoming: string;
  deals: FeeCardDeal[];
}

// ─── Valuation card types ──────────────────────────────────────────────────────

interface ValuationMark {
  valuationId: string;
  date: string;
  sharePrice: number;
  sharePriceDisplay: string;
  companyValuationM: number;
  markSource: string;
  multipleVsEntry: number;
  priceChangePct: number | null;
  isDownRound: boolean;
  daysSincePreviousMark: number | null;
  investorValueRpt: number;
  investorValueDisplay: string;
  moicAtMark: number | null;
  moicDisplay: string;
  unrealisedGainLossRpt: number;
  unrealisedGainLossDisplay: string;
}

interface ValuationCardTimeline {
  company: string;
  round: string;
  dealCurrency: string;
  reportingCurrency: string;
  dealStatus: string;
  isWrittenOff: boolean;
  isExited: boolean;
  hasDownRound: boolean;
  isSparse: boolean;
  markCount: number;
  spanDays: number;
  maxGapDays: number;
  entrySharePrice: number;
  effectiveSharePrice: number;
  contributedDisplay: string;
  latestSharePrice: number | null;
  latestSharePriceDisplay: string | null;
  latestMoic: number | null;
  latestMoicDisplay: string;
  latestInvestorValueDisplay: string | null;
  currentUnrealisedGainLoss: number | null;
  currentUnrealisedGainLossDisplay: string | null;
  peakMoic: number | null;
  peakMoicDisplay: string;
  peakMoicDate: string | null;
  downRounds: { date: string; prevDate: string; fromPrice: number; toPrice: number; pctDrop: number; dealCurrency: string }[];
  marks: ValuationMark[];
}

interface ValuationCard {
  reportingCurrency: string;
  timelines: ValuationCardTimeline[];
}

// ─── Statement card types ──────────────────────────────────────────────────────

interface StatementLineItem {
  lineId: string;
  date: string;
  type: string;
  company: string;
  round: string;
  amountDisplay: string;
  amountRptDisplay: string;
  dealCurrency: string;
  direction: "in" | "out";
  referenceId: string;
}

interface StatementCategoryData {
  name: string;
  subLabel: string;
  direction: "in" | "out";
  totalDisplay: string;
  lineCount: number;
  lines: StatementLineItem[];
}

interface StatementCard {
  reportingCurrency: string;
  reportDate: string;
  investorName: string;
  earliestDate: string | null;
  latestDate: string | null;
  summary: {
    totalContributions: string;
    totalFees: string;
    totalDistributions: string;
    netCashFlow: string;
    netCashFlowRaw: number;
  };
  categories: StatementCategoryData[];
  totalLines: number;
  plainSummary: string;
  fxNote: string | null;
}

// ─── Router debug types ────────────────────────────────────────────────────────

interface RouterDebugEntities {
  companyName: string | null;
  companyId: string | null;
  round: string | null;
  metricOrTerm: string | null;
  dateRange: { from: string | null; to: string | null } | null;
  ambiguousCompanies: string[] | null;
}

interface RouterDebugData {
  intent: string;
  confidence: number;
  entities: RouterDebugEntities;
  backendFunction: string;
  backendParams: Record<string, unknown>;
  clarificationPrompt: string | null;
  reasoning: string;
  matchedKeywords: string[];
  evidenceCount: number;
}

// ─── Answer object types ───────────────────────────────────────────────────────

interface KeyMetricData {
  label: string;
  value: string;
  subtext?: string;
  sentiment?: "positive" | "negative" | "neutral" | "warning";
}

interface GlossaryEntryData {
  term: string;
  abbreviation?: string;
  shortDef: string;
  formula?: string;
}

interface AnswerObjectData {
  title: string;
  conciseAnswer: string;
  keyMetrics: KeyMetricData[];
  detailedNarrative: string;
  glossaryTerms: GlossaryEntryData[];
  evidenceRefs: unknown[];
  caveats: string[];
  followUpQuestions: string[];
  calculationNote: string | null;
  intent: string;
  personalizationLevel: "Emerging" | "Established" | "Experienced";
  fallbackMode: boolean;
}

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: QueryIntent;
  evidence?: EvidenceItem[];
  fallbackMode?: boolean;
  error?: boolean;
  feeCard?: FeeCard;
  valuationCard?: ValuationCard;
  statementCard?: StatementCard;
  routerDebug?: RouterDebugData;
  answerObject?: AnswerObjectData;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^\| (.+) \|$/gm, (match, row) => {
      if (row.includes("---")) return "";
      const cells = row.split(" | ").map((c: string) => c.trim());
      const isHeader = cells.some((c: string) => c === c.toUpperCase() && c.length > 1);
      const tag = isHeader ? "th" : "td";
      return "<tr>" + cells.map((c: string) => `<${tag}>${c}</${tag}>`).join("") + "</tr>";
    })
    .replace(/((<tr>.*<\/tr>\n?)+)/g, "<table>$1</table>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^([^<\n].+)$/gm, (line) => {
      if (line.startsWith("<")) return line;
      return line;
    });
}

function MoicBadge({ moic }: { moic: number | null }) {
  if (moic === null) return <span className="text-slate-600 text-xs tabular-nums">N/A</span>;
  const color = moic >= 2 ? "text-emerald-400" : moic >= 1 ? "text-slate-300" : "text-red-400";
  const Icon = moic >= 1 ? TrendingUp : TrendingDown;
  return (
    <span className={clsx("inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums", color)}>
      <Icon className="w-3 h-3" />
      {moic.toFixed(2)}×
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = clsx({
    "badge-active": status === "Active" || status === "Verified",
    "badge-exited": status === "Exited",
    "badge-written-off": status === "Written Off",
    "badge-pending": status === "Pending",
    "badge-overdue": status === "Overdue",
  });
  return <span className={cls}>{status}</span>;
}

function SourceTypePill({ type }: { type: EvidenceItem["sourceType"] }) {
  const labels: Record<EvidenceItem["sourceType"], string> = {
    allocation: "Allocation", valuation: "Valuation", capital_call: "Capital Call",
    fee: "Fee", distribution: "Distribution", statement_line: "Statement", deal: "Deal",
  };
  const colors: Record<EvidenceItem["sourceType"], string> = {
    allocation: "bg-teal-950/80 text-teal-400 border-teal-900/60",
    valuation: "bg-blue-950/80 text-blue-400 border-blue-900/60",
    capital_call: "bg-amber-950/80 text-amber-400 border-amber-900/60",
    fee: "bg-orange-950/80 text-orange-400 border-orange-900/60",
    distribution: "bg-emerald-950/80 text-emerald-400 border-emerald-900/60",
    statement_line: "bg-slate-800/80 text-slate-400 border-slate-700/60",
    deal: "bg-slate-800/60 text-slate-500 border-slate-700/40",
  };
  return (
    <span className={clsx("source-pill", colors[type])}>{labels[type]}</span>
  );
}

const INTENT_LABELS: Record<string, string> = {
  portfolio_overview: "Portfolio Overview",
  position_detail: "Position Detail",
  obligations: "Upcoming Obligations",
  distributions: "Distributions",
  fee_detail: "Fee Breakdown",
  valuation_history: "Valuation History",
  account_statement: "Account Statement",
  glossary_or_metric_explanation: "Definition",
  unsupported_or_ambiguous: "Clarification",
  general_help: "General",
};

const TIER_CONFIG: Record<
  "Emerging" | "Established" | "Experienced",
  { label: string; color: string; description: string }
> = {
  Emerging: {
    label: "Emerging Investor",
    color: "text-blue-400 bg-blue-950/60 border-blue-900/50",
    description: "Responses use plain language and explain key terms",
  },
  Established: {
    label: "Established Investor",
    color: "text-amber-400 bg-amber-950/60 border-amber-900/50",
    description: "Responses assume familiarity with private equity concepts",
  },
  Experienced: {
    label: "Experienced Investor",
    color: "text-emerald-400 bg-emerald-950/60 border-emerald-900/50",
    description: "Responses use technical language with full calculation detail",
  },
};

// ─── Logo mark ─────────────────────────────────────────────────────────────────

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="2" y="2" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.9" />
      <rect x="13" y="2" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="2" y="13" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="13" y="13" width="9" height="9" rx="1.5" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

// ─── Personalization badge ────────────────────────────────────────────────────

function PersonalizationBadge({ tier }: { tier: "Emerging" | "Established" | "Experienced" }) {
  const cfg = TIER_CONFIG[tier];
  return (
    <div className="relative group">
      <span className={clsx("text-[9px] font-medium px-1.5 py-0.5 rounded border cursor-default", cfg.color)}>
        {tier}
      </span>
      <div className="absolute right-0 top-full mt-1.5 w-48 p-2 rounded-lg bg-base-elevated border border-base-border-strong text-[10px] text-slate-400 leading-relaxed z-30 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity shadow-xl">
        <p className="font-medium text-slate-300 mb-0.5">{cfg.label}</p>
        <p>{cfg.description}</p>
      </div>
    </div>
  );
}

// ─── Main Portal ──────────────────────────────────────────────────────────────

export default function InvestorPortal({
  investors,
  defaultInvestorId,
}: {
  investors: Investor[];
  defaultInvestorId: string;
}) {
  const [selectedInvestorId, setSelectedInvestorId] = useState(defaultInvestorId);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [evidencePanelOpen, setEvidencePanelOpen] = useState(false);
  const [activeEvidence, setActiveEvidence] = useState<EvidenceItem[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [evaluatorOpen, setEvaluatorOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasFallbackMode = messages.some((m) => m.fallbackMode);
  const isDev = process.env.NODE_ENV === "development";

  const loadSnapshot = useCallback(async (investorId: string) => {
    setSnapshotLoading(true);
    try {
      const res = await fetch(`/api/snapshot/${investorId}`);
      if (!res.ok) throw new Error("Failed to load snapshot");
      const data = await res.json();
      setSnapshot(data);
    } catch {
      setSnapshot(null);
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshot(selectedInvestorId);
    setMessages([]);
    setActiveEvidence([]);
    setEvidencePanelOpen(false);
  }, [selectedInvestorId, loadSnapshot]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const handleSend = async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || isThinking) return;
    setInput("");

    const userMsg: AssistantMessage = {
      id: Date.now().toString(),
      role: "user",
      content: userText,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);

    try {
      const history: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, investorId: selectedInvestorId, history }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Request failed");
      }
      const data = await res.json();
      const assistantMsg: AssistantMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.answerObject?.detailedNarrative ?? data.answer,
        intent: data.intent,
        evidence: data.evidence ?? [],
        fallbackMode: data.fallbackMode ?? false,
        feeCard: data.feeCard ?? undefined,
        valuationCard: data.valuationCard ?? undefined,
        statementCard: data.statementCard ?? undefined,
        routerDebug: data.routerDebug ?? undefined,
        answerObject: data.answerObject ?? undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (data.evidence?.length > 0) {
        setActiveEvidence(data.evidence);
        setEvidencePanelOpen(true);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: err instanceof Error ? err.message : "An unexpected error occurred.",
          error: true,
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const currentInvestor = investors.find((i) => i.id === selectedInvestorId);

  return (
    <div className="flex flex-col h-screen bg-base">

      {/* ── Top bar ───────────────────────────────────────────────────────────── */}
      <header className="flex-none flex items-center justify-between px-5 border-b border-base-border bg-base-surface" style={{ height: "52px" }}>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <LogoMark className="w-5 h-5 text-accent" />
            <span className="text-slate-100 font-semibold text-sm tracking-tight">EquiTie</span>
            <span className="w-px h-4 bg-base-border" />
            <span className="text-slate-600 text-xs">Investor Portal</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Demo badge — always visible */}
          <div className="flex items-center gap-1.5 text-[10px] text-accent/70 bg-accent-subtle border border-accent-muted/30 px-2 py-1 rounded-md font-medium tracking-wide uppercase">
            Demo
          </div>

          {hasFallbackMode && (
            <div className="flex items-center gap-1.5 text-amber-500/80 text-[11px] bg-amber-950/30 border border-amber-900/40 px-2.5 py-1 rounded-md">
              <AlertTriangle className="w-3 h-3" />
              Template mode — no API key
            </div>
          )}

          {isDev && (
            <button
              onClick={() => setShowDebug((d) => !d)}
              className={clsx(
                "px-2 py-1 rounded text-[10px] font-mono border transition-colors",
                showDebug
                  ? "bg-violet-950/50 border-violet-700/60 text-violet-300"
                  : "border-base-border text-slate-700 hover:text-violet-500"
              )}
            >
              {"{/}"}
            </button>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <Calendar className="w-3 h-3" />
            <span className="tabular-nums">25 Jun 2026</span>
          </div>

          {/* Evaluator investor switcher */}
          <div className="relative">
            <button
              onClick={() => setEvaluatorOpen((o) => !o)}
              className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg border border-base-border hover:border-base-border-strong hover:bg-base-elevated transition-all"
            >
              <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center flex-none">
                <span className="text-accent text-[10px] font-semibold">
                  {currentInvestor?.name.charAt(0) ?? "?"}
                </span>
              </div>
              <div className="text-left">
                <div className="text-slate-300 text-xs font-medium max-w-[130px] truncate leading-tight">
                  {currentInvestor?.name ?? "Select investor"}
                </div>
                <div className="text-slate-700 text-[9px] tabular-nums font-mono leading-tight">{selectedInvestorId}</div>
              </div>
              <ChevronsUpDown className="w-3 h-3 text-slate-600 flex-none" />
            </button>

            {evaluatorOpen && (
              <div className="absolute top-full right-0 mt-1.5 w-72 bg-base-elevated border border-base-border-strong rounded-xl shadow-2xl z-50 overflow-hidden animate-fade-in">
                <div className="px-3 pt-3 pb-2 border-b border-base-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="w-3 h-3 text-slate-500" />
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">Evaluator Access</p>
                  </div>
                  <p className="text-[10px] text-slate-700 leading-snug">
                    Switch investor to test different portfolio scenarios. Each ID fully scopes data — investor isolation is enforced.
                  </p>
                </div>
                <div className="px-2 py-2 max-h-72 overflow-y-auto">
                  {investors.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => { setSelectedInvestorId(inv.id); setEvaluatorOpen(false); }}
                      className={clsx(
                        "w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors mb-0.5",
                        inv.id === selectedInvestorId
                          ? "bg-accent-subtle text-accent border border-accent/20"
                          : "text-slate-400 hover:bg-base-surface hover:text-slate-200"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={clsx(
                          "w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold flex-none",
                          inv.id === selectedInvestorId ? "bg-accent/20 text-accent" : "bg-base-border text-slate-600"
                        )}>
                          {inv.name.charAt(0)}
                        </div>
                        <span className="font-medium truncate">{inv.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-none ml-2">
                        <span className="text-slate-700 text-[9px] font-mono">{inv.id}</span>
                        <span className="text-slate-700 text-[9px]">{inv.reportingCurrency}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="px-3 py-2 border-t border-base-border bg-base-surface">
                  <p className="text-[10px] text-slate-700 flex items-center gap-1.5">
                    <Database className="w-3 h-3 flex-none" />
                    All answers grounded in provided dataset · 25 Jun 2026
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        <aside className="flex-none w-72 border-r border-base-border flex flex-col overflow-hidden bg-base-surface">
          {snapshotLoading ? (
            <SidebarSkeleton />
          ) : !snapshot ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center">
                <AlertTriangle className="w-5 h-5 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-600 text-xs">Failed to load investor data</p>
              </div>
            </div>
          ) : (
            <>
              {/* Identity block */}
              <div className="px-5 pt-5 pb-4 border-b border-base-border">
                {/* ID + KYC + tier row */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono text-slate-700 bg-base-elevated border border-base-border px-1.5 py-0.5 rounded tracking-wider">
                      {snapshot.investor.id}
                    </span>
                    {snapshot.investor.kycStatus === "Verified" ? (
                      <span className="flex items-center gap-0.5 text-emerald-500/80 text-[10px]">
                        <Shield className="w-3 h-3" />
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-amber-500/80 text-[10px]">
                        <ShieldAlert className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <PersonalizationBadge tier={snapshot.snapshot.personalizationTier} />
                </div>

                {/* Avatar + name */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-base-elevated border border-base-border flex items-center justify-center flex-none">
                    <span className="font-display text-accent text-base leading-none">
                      {snapshot.investor.name.charAt(0)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="font-display text-slate-100 text-sm leading-snug">
                      {snapshot.investor.name}
                    </div>
                    <div className="text-slate-500 text-[11px] mt-0.5">
                      {snapshot.investor.type} · {snapshot.investor.country}
                    </div>
                  </div>
                </div>

                {/* Report date bar */}
                <div className="flex items-center gap-1.5 text-[10px] text-slate-700 bg-base-elevated border border-base-border rounded-md px-2.5 py-1.5">
                  <Calendar className="w-3 h-3 flex-none text-slate-600" />
                  <span>Data as at <span className="text-slate-500 tabular-nums">25 Jun 2026</span></span>
                  <span className="mx-1 text-slate-800">·</span>
                  <span className="text-slate-600">{snapshot.investor.reportingCurrency}</span>
                </div>
              </div>

              {/* Portfolio KPIs */}
              <div className="px-5 pt-4 pb-4 border-b border-base-border">
                <p className="card-section-label">Portfolio</p>

                <div className="mb-4">
                  <div className="font-display text-slate-100 tabular-nums leading-none" style={{ fontSize: "1.5rem" }}>
                    {snapshot.snapshot.totalValue}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-1">total value · {snapshot.snapshot.reportingCurrency}</div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Contributed</div>
                    <div className="text-sm text-slate-300 tabular-nums font-medium">{snapshot.snapshot.totalContributed}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Portfolio MOIC</div>
                    <MoicBadge moic={snapshot.snapshot.portfolioMoicRaw} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Active positions</div>
                    <div className="text-sm text-slate-300 font-medium">{snapshot.snapshot.activePositions}</div>
                  </div>
                  {snapshot.snapshot.pendingPositions > 0 && (
                    <div>
                      <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Pending</div>
                      <div className="text-sm text-amber-500 font-medium">{snapshot.snapshot.pendingPositions}</div>
                    </div>
                  )}
                </div>

                {/* Portfolio signal chips */}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {snapshot.snapshot.multiRoundCompany && (
                    <button
                      onClick={() => handleSend(`Walk me through my ${snapshot.snapshot.multiRoundCompany!.name} positions — I'm invested across ${snapshot.snapshot.multiRoundCompany!.roundCount} rounds`)}
                      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-base-elevated border border-base-border text-slate-500 hover:border-base-border-strong hover:text-slate-300 transition-colors"
                    >
                      <Layers className="w-2.5 h-2.5" />
                      {snapshot.snapshot.multiRoundCompany.roundCount} rounds · {snapshot.snapshot.multiRoundCompany.name}
                    </button>
                  )}
                  {snapshot.snapshot.hasFeeDiscount && (
                    <button
                      onClick={() => handleSend("Do I have any fee discounts, and how much am I saving vs. standard rates?")}
                      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent-subtle border border-accent-muted/30 text-accent/70 hover:text-accent transition-colors"
                    >
                      <Percent className="w-2.5 h-2.5" />
                      Fee discount
                    </button>
                  )}
                  {snapshot.snapshot.hasDistributions && (
                    <button
                      onClick={() => handleSend("What have I actually received in cash — distributions and exit proceeds?")}
                      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-900/30 text-emerald-500/70 hover:text-emerald-400 transition-colors"
                    >
                      <TrendingUp className="w-2.5 h-2.5" />
                      Distributions
                    </button>
                  )}
                </div>

                {snapshot.snapshot.topSectors.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5">Sectors</div>
                    <div className="flex flex-wrap gap-1">
                      {snapshot.snapshot.topSectors.map((s) => (
                        <span key={s} className="text-[10px] px-2 py-0.5 rounded-sm bg-base-elevated text-slate-500 border border-base-border">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {snapshot.snapshot.hasOverdueObligations && (
                  <button
                    onClick={() => handleSend("What are my upcoming and overdue obligations?")}
                    className="mt-3 w-full flex items-center gap-2 text-red-400 text-[11px] bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2 hover:bg-red-950/40 transition-colors text-left"
                  >
                    <AlertTriangle className="w-3 h-3 flex-none" />
                    Overdue obligations — view →
                  </button>
                )}
              </div>

              {/* Holdings list */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-5 pt-4 pb-2">
                  <p className="card-section-label">Holdings</p>
                </div>
                <div className="px-2 pb-4 space-y-0.5">
                  {snapshot.snapshot.holdings.map((h) => (
                    <button
                      key={h.allocationId}
                      onClick={() => handleSend(`Tell me about my position in ${h.company}`)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-base-elevated transition-all group"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-slate-300 text-xs font-medium truncate group-hover:text-slate-100 transition-colors">
                          {h.company}
                        </span>
                        <MoicBadge moic={h.moic} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-600">{h.round}</span>
                        <span className="text-slate-800">·</span>
                        <StatusBadge status={h.dealStatus} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>

        {/* ── Main chat area ─────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-base">
          <div className="flex-1 overflow-y-auto py-6 space-y-3">
            {messages.length === 0 && !snapshotLoading && snapshot && (
              <EmptyState
                investorName={snapshot.investor.name}
                starterPrompts={snapshot.starterPrompts}
                personalizationTier={snapshot.snapshot.personalizationTier}
                multiRoundCompany={snapshot.snapshot.multiRoundCompany}
                hasDistributions={snapshot.snapshot.hasDistributions}
                hasFeeDiscount={snapshot.snapshot.hasFeeDiscount}
                reportingCurrency={snapshot.snapshot.reportingCurrency}
                onPrompt={handleSend}
              />
            )}

            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                showDebug={showDebug}
                onViewSources={(evidence) => {
                  setActiveEvidence(evidence);
                  setEvidencePanelOpen(true);
                }}
                onSend={handleSend}
              />
            ))}

            {isThinking && <ThinkingIndicator />}
            <div ref={chatEndRef} />
          </div>

          {/* Input composer */}
          <div className="flex-none border-t border-base-border bg-base-surface px-6 py-4">
            <div className="flex items-end gap-3 max-w-4xl mx-auto">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your portfolio, a position, fees, obligations, or distributions…"
                  rows={1}
                  disabled={isThinking}
                  className="w-full bg-base-elevated border border-base-border rounded-xl px-4 py-3 text-slate-200 text-sm placeholder-slate-700 resize-none focus:outline-none focus:border-base-border-strong transition-all"
                  style={{ minHeight: "48px", maxHeight: "120px" }}
                  onInput={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 120) + "px";
                  }}
                />
              </div>
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isThinking}
                className="flex-none w-10 h-10 rounded-xl bg-accent disabled:bg-base-elevated disabled:border disabled:border-base-border flex items-center justify-center transition-all hover:bg-accent-dim"
              >
                {isThinking ? (
                  <Loader2 className="w-4 h-4 text-slate-950 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 text-slate-950" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-center gap-2 mt-2 text-[10px] text-slate-700">
              <Database className="w-3 h-3" />
              <span>Answers grounded in provided dataset only</span>
              <span className="text-slate-800">·</span>
              <span className="tabular-nums">25 Jun 2026</span>
              <span className="text-slate-800">·</span>
              <span>Not investment advice</span>
            </div>
          </div>
        </main>

        {/* ── Evidence panel ─────────────────────────────────────────────────── */}
        {evidencePanelOpen && (
          <aside className="flex-none w-80 border-l border-base-border flex flex-col overflow-hidden bg-base-surface animate-slide-in-right">
            <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-base-border">
              <div className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs font-semibold text-slate-300">Source data</span>
                <span className="text-[10px] text-slate-600 bg-base-elevated px-1.5 py-0.5 rounded border border-base-border tabular-nums">
                  {activeEvidence.length} records
                </span>
              </div>
              <button
                onClick={() => setEvidencePanelOpen(false)}
                className="w-6 h-6 flex items-center justify-center rounded-md text-slate-600 hover:text-slate-300 hover:bg-base-elevated transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {activeEvidence.map((ev, idx) => (
                <div key={`${ev.id}-${idx}`} className="p-3 rounded-lg border border-base-border bg-base-elevated hover:border-base-border-strong transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <SourceTypePill type={ev.sourceType} />
                    <span className="text-slate-700 text-[10px] font-mono">{ev.id}</span>
                  </div>
                  <div className="text-slate-300 text-[11px] font-medium mb-1 leading-snug">{ev.label}</div>
                  <div className="text-slate-500 text-[11px] leading-relaxed">{ev.detail}</div>
                  {ev.amount !== undefined && ev.currency && (
                    <div className="mt-2 text-accent text-xs font-semibold tabular-nums">
                      {ev.currency} {ev.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                  )}
                  {ev.date && (
                    <div className="text-slate-700 text-[10px] mt-0.5 tabular-nums">{ev.date}</div>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar skeleton ─────────────────────────────────────────────────────────

function SidebarSkeleton() {
  return (
    <div className="p-5 space-y-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-base-elevated" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 bg-base-elevated rounded w-3/4" />
          <div className="h-2.5 bg-base-elevated rounded w-1/2" />
        </div>
      </div>
      <div className="h-6 bg-base-elevated rounded w-full" />
      <div className="space-y-2 pt-2">
        <div className="h-7 bg-base-elevated rounded w-2/3" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-8 bg-base-elevated rounded" />
          <div className="h-8 bg-base-elevated rounded" />
        </div>
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-10 bg-base-elevated rounded-lg" />
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const PROMPT_ICONS: Array<[RegExp, React.ComponentType<{ className?: string }>, string]> = [
  [/overview|portfolio/i, LayoutGrid, "Portfolio"],
  [/walk me through|rounds|round|series/i, Layers, "Multi-round"],
  [/capital call|obligation|owe|due/i, AlertTriangle, "Obligations"],
  [/distribut|exit proceed|received/i, TrendingUp, "Distributions"],
  [/fee|discount|saving/i, Percent, "Fees"],
  [/valuat|mark|how has.*valued/i, Activity, "Valuation"],
  [/statement|cash movement|cash in/i, FileText, "Statement"],
  [/position|tell me about/i, LayoutGrid, "Position"],
];

function promptIcon(prompt: string): { Icon: React.ComponentType<{ className?: string }>; label: string } {
  for (const [re, Icon, label] of PROMPT_ICONS) {
    if (re.test(prompt)) return { Icon, label };
  }
  return { Icon: Activity, label: "Query" };
}

function EmptyState({
  investorName,
  starterPrompts,
  personalizationTier,
  multiRoundCompany,
  hasDistributions,
  hasFeeDiscount,
  reportingCurrency,
  onPrompt,
}: {
  investorName: string;
  starterPrompts: string[];
  personalizationTier: "Emerging" | "Established" | "Experienced";
  multiRoundCompany: MultiRoundCompany | null;
  hasDistributions: boolean;
  hasFeeDiscount: boolean;
  reportingCurrency: string;
  onPrompt: (text: string) => void;
}) {
  const firstName = investorName.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col justify-start pt-10 px-8 max-w-4xl mx-auto w-full">
      {/* Greeting */}
      <div className="mb-7">
        <p className="text-[10px] uppercase tracking-widest text-slate-700 mb-3 font-medium">
          EquiTie Investor Assistant · Demo
        </p>
        <h1 className="font-display text-3xl text-slate-100 leading-tight mb-3">
          {greeting}, {firstName}.
        </h1>
        <p className="text-slate-500 text-sm leading-relaxed max-w-lg mb-4">
          Ask about your portfolio, individual positions, fees, distributions, upcoming obligations, or valuation history.
        </p>

        {/* Personalization + portfolio signal cues */}
        <div className="flex flex-wrap items-center gap-2">
          <div className={clsx(
            "flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md border font-medium",
            TIER_CONFIG[personalizationTier].color
          )}>
            Responses tailored for: {TIER_CONFIG[personalizationTier].label}
          </div>
          {multiRoundCompany && (
            <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-base-border bg-base-elevated text-slate-500">
              <Layers className="w-3 h-3" />
              {multiRoundCompany.name} · {multiRoundCompany.roundCount} rounds
            </div>
          )}
          {hasFeeDiscount && (
            <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-accent-muted/30 bg-accent-subtle text-accent/70">
              <Percent className="w-3 h-3" />
              Fee discount active
            </div>
          )}
          {hasDistributions && (
            <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-emerald-900/30 bg-emerald-950/30 text-emerald-500/70">
              <TrendingUp className="w-3 h-3" />
              Cash distributions received
            </div>
          )}
        </div>
      </div>

      {/* Starter prompts — all 6-8 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-3xl mb-6">
        {starterPrompts.map((prompt) => {
          const { Icon, label } = promptIcon(prompt);
          return (
            <button
              key={prompt}
              onClick={() => onPrompt(prompt)}
              className="group text-left p-4 rounded-xl border border-base-border bg-base-surface hover:border-base-border-strong hover:bg-base-elevated transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 text-slate-600 group-hover:text-slate-500 flex-none mt-0.5 transition-colors" />
                  <span className="text-slate-400 text-sm group-hover:text-slate-200 transition-colors leading-snug">
                    {prompt}
                  </span>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-accent transition-colors flex-none mt-0.5 shrink-0" />
              </div>
              <div className="mt-2 pl-[26px]">
                <span className="text-[9px] uppercase tracking-wider text-slate-700 group-hover:text-slate-600 transition-colors">
                  {label}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Dataset grounding note */}
      <div className="flex items-center gap-2 text-[10px] text-slate-700 max-w-3xl">
        <Database className="w-3 h-3 flex-none text-slate-600" />
        <span>
          All answers grounded in the provided dataset · Figures in {reportingCurrency} (reporting currency) · Data as at 25 Jun 2026 · Not investment advice
        </span>
      </div>
    </div>
  );
}

// ─── Message bubble / response card ───────────────────────────────────────────

function MessageBubble({
  message,
  showDebug,
  onViewSources,
  onSend,
}: {
  message: AssistantMessage;
  showDebug: boolean;
  onViewSources: (ev: EvidenceItem[]) => void;
  onSend: (text: string) => void;
}) {
  const isUser = message.role === "user";
  const hasEvidence = !isUser && (message.evidence?.length ?? 0) > 0;
  const ao = message.answerObject;

  if (isUser) {
    return (
      <div className="flex justify-end px-6">
        <div className="max-w-[65%] px-4 py-2.5 bg-base-elevated border border-base-border rounded-2xl rounded-tr-sm text-slate-300 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.error) {
    return (
      <div className="px-6">
        <div className="max-w-4xl mx-auto rounded-xl border border-red-900/40 bg-red-950/15 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-none mt-0.5" />
          <p className="text-red-300 text-sm leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  const intentLabel = message.intent ? INTENT_LABELS[message.intent] ?? message.intent : "Response";

  return (
    <div className="px-6 animate-slide-up">
      <div className="max-w-4xl mx-auto response-card">

        {/* Card header */}
        <div className="response-card-header">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent flex-none" />
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
              {intentLabel}
            </span>
            {message.fallbackMode && (
              <span className="text-[10px] text-amber-600/80 border border-amber-900/30 bg-amber-950/20 px-1.5 py-0.5 rounded">
                template mode
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {ao?.personalizationLevel && (
              <span className={clsx(
                "text-[9px] px-1.5 py-0.5 rounded border",
                TIER_CONFIG[ao.personalizationLevel].color
              )}>
                {ao.personalizationLevel}
              </span>
            )}
            <span className="text-[10px] text-slate-700">EquiTie AI</span>
          </div>
        </div>

        {/* Card body */}
        <div className="response-card-body">
          {ao?.title && (
            <h3 className="text-slate-100 font-semibold text-base mb-3">{ao.title}</h3>
          )}

          {ao?.conciseAnswer && (
            <p className="text-slate-300 text-sm leading-relaxed font-medium mb-4 pb-4 border-b border-base-border">
              {ao.conciseAnswer}
            </p>
          )}

          {ao && ao.keyMetrics.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 mb-5 pb-5 border-b border-base-border">
              {ao.keyMetrics.map((m, i) => (
                <div key={i} className="kpi-cell">
                  <span className={clsx(
                    "kpi-value",
                    m.sentiment === "positive" && "text-emerald-400",
                    m.sentiment === "negative" && "text-red-400",
                    m.sentiment === "warning" && "text-amber-400",
                    (!m.sentiment || m.sentiment === "neutral") && "text-slate-100",
                  )}>
                    {m.value}
                  </span>
                  <span className="kpi-label">{m.label}</span>
                  {m.subtext && <span className="kpi-sub">{m.subtext}</span>}
                </div>
              ))}
            </div>
          )}

          <div
            className="prose-dark text-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />

          {message.feeCard && <FeeBreakdownCard feeCard={message.feeCard} />}
          {message.valuationCard && <ValuationTimelineCard card={message.valuationCard} />}
          {message.statementCard && (
            <StatementLedger
              card={message.statementCard}
              evidence={message.evidence ?? []}
              onViewSources={onViewSources}
            />
          )}
        </div>

        {ao && ao.glossaryTerms.length > 0 && <AnswerGlossary terms={ao.glossaryTerms} />}
        {ao && ao.caveats.length > 0 && <AnswerCaveats caveats={ao.caveats} />}
        {ao?.calculationNote && <AnswerCalculationNote note={ao.calculationNote} />}

        {showDebug && message.routerDebug && <QueryDebugPanel debug={message.routerDebug} />}

        {(ao?.followUpQuestions?.length || hasEvidence) && (
          <div className="response-card-footer">
            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
              {ao?.followUpQuestions?.map((q, i) => (
                <button key={i} onClick={() => onSend(q)} className="followup-chip">
                  {q}
                </button>
              ))}
            </div>
            {hasEvidence && (
              <button
                onClick={() => onViewSources(message.evidence!)}
                className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex-none whitespace-nowrap"
              >
                <BookOpen className="w-3 h-3" />
                {message.evidence!.length} sources
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thinking indicator ───────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="px-6">
      <div className="max-w-4xl mx-auto rounded-xl border border-base-border bg-base-elevated px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-accent/60 loading-dot" />
            <div className="w-1.5 h-1.5 rounded-full bg-accent/60 loading-dot" />
            <div className="w-1.5 h-1.5 rounded-full bg-accent/60 loading-dot" />
          </div>
          <span className="text-slate-600 text-xs">Analysing your portfolio data…</span>
        </div>
      </div>
    </div>
  );
}

// ─── Answer detail sections ───────────────────────────────────────────────────

function AnswerGlossary({ terms }: { terms: GlossaryEntryData[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-base-border">
      <button onClick={() => setOpen((v) => !v)} className="disclosure-trigger">
        <span className="flex items-center gap-2">
          <BookOpen className="w-3 h-3" />
          Glossary · {terms.length} term{terms.length !== 1 ? "s" : ""}
        </span>
        <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-3 border-t border-base-border">
          {terms.map((t, i) => (
            <div key={i} className="pt-3">
              <p className="text-xs font-semibold text-slate-200">
                {t.term}
                {t.abbreviation && <span className="text-slate-600 font-normal ml-2">({t.abbreviation})</span>}
              </p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{t.shortDef}</p>
              {t.formula && <p className="text-[11px] text-slate-600 mt-0.5 font-mono">{t.formula}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerCaveats({ caveats }: { caveats: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-base-border">
      <button onClick={() => setOpen((v) => !v)} className="disclosure-trigger text-amber-600/70 hover:text-amber-500">
        <span className="flex items-center gap-2">
          <AlertTriangle className="w-3 h-3" />
          {caveats.length} caveat{caveats.length !== 1 ? "s" : ""}
        </span>
        <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="px-5 pb-4 space-y-1.5 border-t border-base-border pt-3">
          {caveats.map((c, i) => (
            <li key={i} className="flex gap-2 text-[11px] text-amber-400/70 leading-relaxed">
              <span className="text-amber-700 flex-none mt-px">–</span>
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnswerCalculationNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-base-border">
      <button onClick={() => setOpen((v) => !v)} className="disclosure-trigger">
        <span className="flex items-center gap-2">
          <Info className="w-3 h-3" />
          Methodology
        </span>
        <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <p className="px-5 pb-4 pt-3 text-[11px] text-slate-500 leading-relaxed border-t border-base-border">
          {note}
        </p>
      )}
    </div>
  );
}

// ─── Fee Breakdown Card ───────────────────────────────────────────────────────

function FeeBreakdownCard({ feeCard }: { feeCard: FeeCard }) {
  if (feeCard.deals.length === 0) return null;
  return (
    <div className="mt-5 space-y-3">
      {feeCard.hasAnyDiscount && (
        <div className="flex items-center gap-2 text-[11px]">
          <Tag className="w-3 h-3 text-accent" />
          <span className="text-accent font-medium">Negotiated discount applied to this investor</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-500">Paid: <span className="text-slate-300 tabular-nums">{feeCard.totalPaid}</span></span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-500">Upcoming: <span className="text-slate-300 tabular-nums">{feeCard.totalUpcoming}</span></span>
        </div>
      )}
      {feeCard.deals.map((deal) => (
        <FeeCardItem key={`${deal.company}-${deal.round}`} deal={deal} />
      ))}
    </div>
  );
}

function FeeCardItem({ deal }: { deal: FeeCardDeal }) {
  const [expanded, setExpanded] = useState(false);

  const statusCls = (s: string) => clsx("text-[10px] px-1.5 py-0.5 rounded border font-medium", {
    "bg-emerald-950/80 text-emerald-400 border-emerald-900/50": s === "Paid",
    "bg-base-elevated text-slate-400 border-base-border": s === "Upcoming",
    "bg-red-950/80 text-red-400 border-red-900/50": s === "Overdue",
  });

  return (
    <div className="rounded-xl border border-base-border bg-base-elevated overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-base-border bg-base-surface">
        <div className="flex items-center gap-2">
          <span className="text-slate-200 text-sm font-medium">{deal.company}</span>
          <span className="text-slate-600 text-xs">{deal.round}</span>
          {deal.hasDiscount && <span className="badge-discount">Discounted</span>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 tabular-nums">
          <span>Paid <span className="text-slate-300">{deal.totalPaid}</span></span>
          {deal.totalOverdue && <span className="text-red-400 font-medium">Overdue {deal.totalOverdue}</span>}
        </div>
      </div>

      <div className="px-4 py-3 border-b border-base-border">
        <p className="text-slate-500 text-xs leading-relaxed">{deal.plainSummary}</p>
      </div>

      {deal.noFeesYet ? (
        <div className="px-4 py-3 flex items-center gap-2 text-slate-600 text-xs">
          <Info className="w-3.5 h-3.5 flex-none" />
          No fee history yet — fees will appear once capital is deployed.
        </div>
      ) : (
        <>
          <div className="px-4 py-3">
            <div className="card-section-label mb-2">Fee schedule</div>
            <div className="space-y-1.5">
              {deal.schedule.map((line) => (
                <FeeScheduleRow key={line.feeType} line={line} />
              ))}
            </div>
          </div>

          <div className="px-4 pb-3">
            <div className="flex items-start gap-2 text-[11px] text-slate-600 bg-base-surface border border-base-border rounded-lg px-3 py-2">
              <Info className="w-3 h-3 flex-none mt-0.5 text-slate-700" />
              <span className="leading-relaxed">{deal.performanceFeeNote}</span>
            </div>
          </div>

          {deal.feeLines.length > 0 && (
            <div className="border-t border-base-border">
              <button onClick={() => setExpanded((e) => !e)} className="disclosure-trigger">
                <span>{deal.feeLines.length} fee line{deal.feeLines.length !== 1 ? "s" : ""}</span>
                <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform duration-150", expanded && "rotate-180")} />
              </button>
              {expanded && (
                <div className="px-4 pb-3 border-t border-base-border">
                  {deal.feeLines.map((fl) => (
                    <div key={fl.feeId} className="flex items-center justify-between text-xs py-2 border-b border-base-border/50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-400 truncate">{fl.feeType}</span>
                        <span className="text-slate-700 text-[10px]">{fl.period}</span>
                        {fl.hasDiscount && <CheckCircle2 className="w-3 h-3 text-emerald-600 flex-none" />}
                      </div>
                      <div className="flex items-center gap-2 flex-none ml-2">
                        <span className="text-slate-300 tabular-nums">{fl.amountRptDisplay}</span>
                        <span className={statusCls(fl.status)}>{fl.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Fee Schedule Row ─────────────────────────────────────────────────────────

function FeeScheduleRow({ line }: { line: FeeCardScheduleLine }) {
  const hasChange = line.discounted || line.standardDisplay !== line.effectiveDisplay;
  return (
    <div className={clsx(
      "grid grid-cols-[1fr_auto_auto] gap-3 items-center text-xs py-2 px-2 rounded-lg",
      line.discounted ? "bg-accent-subtle/50" : ""
    )}>
      <div>
        <span className={clsx("font-medium", line.discounted ? "text-slate-200" : "text-slate-400")}>{line.feeType}</span>
        <span className="text-slate-700 ml-1.5 text-[10px]">{line.basis}</span>
      </div>
      <div className="flex items-center gap-1.5 tabular-nums">
        {hasChange ? (
          <>
            <span className="text-slate-700 line-through text-[11px]">{line.standardDisplay}</span>
            <span className="text-slate-600">→</span>
            <span className={line.discounted ? "text-accent font-semibold" : "text-slate-300"}>{line.effectiveDisplay}</span>
          </>
        ) : (
          <span className="text-slate-400">{line.effectiveDisplay}</span>
        )}
      </div>
      <div className="text-right min-w-[80px]">
        {line.undeterminable ? (
          <span className="text-slate-700 text-[10px] italic">at exit</span>
        ) : line.savingDisplay ? (
          <div>
            <span className="text-accent font-semibold text-[11px]">{line.savingDisplay}</span>
            {line.savingRptDisplay && <div className="text-accent/50 text-[9px]">≈ {line.savingRptDisplay}/period</div>}
          </div>
        ) : (
          <span className="text-slate-800">—</span>
        )}
      </div>
    </div>
  );
}

// ─── Query Debug Panel ────────────────────────────────────────────────────────

const INTENT_COLORS: Record<string, string> = {
  portfolio_overview: "bg-blue-950 text-blue-300 border-blue-800",
  position_detail: "bg-indigo-950 text-indigo-300 border-indigo-800",
  obligations: "bg-amber-950 text-amber-300 border-amber-800",
  distributions: "bg-emerald-950 text-emerald-300 border-emerald-800",
  fee_detail: "bg-orange-950 text-orange-300 border-orange-800",
  valuation_history: "bg-violet-950 text-violet-300 border-violet-800",
  account_statement: "bg-cyan-950 text-cyan-300 border-cyan-800",
  glossary_or_metric_explanation: "bg-teal-950 text-teal-300 border-teal-800",
  unsupported_or_ambiguous: "bg-red-950 text-red-300 border-red-800",
  general_help: "bg-slate-800 text-slate-300 border-slate-700",
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-base-border rounded-full overflow-hidden">
        <div className={clsx("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-slate-500">{pct}%</span>
    </div>
  );
}

function QueryDebugPanel({ debug }: { debug: RouterDebugData }) {
  const [open, setOpen] = useState(false);
  const intentColor = INTENT_COLORS[debug.intent] ?? "bg-slate-800 text-slate-300 border-slate-700";
  return (
    <div className="border-t border-violet-900/40 bg-violet-950/10 font-mono">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-[10px] text-left hover:bg-violet-950/20 transition-colors"
      >
        <span className="text-violet-500">{"{/}"}</span>
        <span className="text-violet-400 font-semibold">Router Debug</span>
        <span className={clsx("px-1.5 py-0.5 rounded border text-[10px]", intentColor)}>{debug.intent}</span>
        <span className="text-slate-600">{Math.round(debug.confidence * 100)}% · {debug.evidenceCount} ev</span>
        <ChevronDown className={clsx("w-3 h-3 text-violet-600 ml-auto transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-violet-900/30 px-4 py-3 space-y-2.5 text-[11px]">
          <div>
            <div className="text-slate-600 mb-1">Confidence</div>
            <ConfidenceBar value={debug.confidence} />
          </div>
          <div>
            <div className="text-slate-600 mb-0.5">Backend</div>
            <div className="text-violet-300">{debug.backendFunction}</div>
          </div>
          {debug.matchedKeywords.length > 0 && (
            <div>
              <div className="text-slate-600 mb-1">Keywords</div>
              <div className="flex flex-wrap gap-1">
                {debug.matchedKeywords.map((kw) => (
                  <span key={kw} className="px-1.5 py-0.5 rounded bg-base-elevated border border-base-border text-slate-400">{kw}</span>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-slate-600 mb-1">Entities</div>
            <div className="space-y-0.5 pl-2 border-l border-base-border">
              {Object.entries(debug.entities).map(([k, v]) => {
                if (v === null || (Array.isArray(v) && v.length === 0)) return null;
                return (
                  <div key={k} className="flex gap-2">
                    <span className="text-slate-700 w-28 flex-none">{k}</span>
                    <span className="text-slate-300">
                      {Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                );
              })}
              {Object.values(debug.entities).every((v) => v === null) && (
                <span className="text-slate-700 italic">no entities</span>
              )}
            </div>
          </div>
          {debug.clarificationPrompt && (
            <div>
              <div className="text-slate-600 mb-0.5">Clarification</div>
              <div className="text-amber-400/80 italic">"{debug.clarificationPrompt}"</div>
            </div>
          )}
          <div>
            <div className="text-slate-600 mb-0.5">Reasoning</div>
            <div className="text-slate-500 leading-relaxed">{debug.reasoning}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Statement Ledger ─────────────────────────────────────────────────────────

function printStatement(card: StatementCard) {
  const win = window.open("", "_blank");
  if (!win) return;

  const allLines = card.categories.flatMap((cat) =>
    cat.lines.map((l) => ({ ...l, categoryName: cat.name }))
  );
  allLines.sort((a, b) => a.date.localeCompare(b.date));

  const netSign = card.summary.netCashFlowRaw >= 0 ? "+" : "−";

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Account Statement — ${card.investorName || "Investor"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Georgia', serif; color: #1a1a2e; margin: 48px; font-size: 12px; line-height: 1.5; }
  h1 { font-size: 22px; font-weight: bold; letter-spacing: -0.02em; margin-bottom: 2px; }
  .subtitle { color: #64748b; font-size: 11px; margin-bottom: 28px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: #e2e8f0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 28px; }
  .summary-cell { background: #f8fafc; padding: 14px 16px; }
  .summary-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 4px; }
  .summary-value { font-size: 16px; font-weight: bold; color: #0f172a; font-variant-numeric: tabular-nums; }
  .summary-value.positive { color: #16a34a; }
  .summary-value.negative { color: #dc2626; }
  .narrative { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; margin-bottom: 24px; font-size: 12px; color: #475569; line-height: 1.7; }
  .category-header { background: #f1f5f9; padding: 8px 12px; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; border-top: 2px solid #cbd5e1; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; padding: 6px 10px; border-bottom: 2px solid #e2e8f0; font-weight: 600; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; font-size: 11px; color: #334155; vertical-align: middle; }
  tr:last-child td { border-bottom: 1px solid #e2e8f0; }
  .td-date { color: #64748b; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .td-type { color: #64748b; font-size: 10px; }
  .td-amount { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .td-amount.out { color: #dc2626; }
  .td-amount.in { color: #16a34a; }
  .td-ref { color: #94a3b8; font-size: 9px; font-family: monospace; }
  .footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; line-height: 1.6; }
  @media print { body { margin: 24px; } @page { margin: 24px; } }
</style>
</head>
<body>
<h1>${card.investorName ? `${card.investorName} — Account Statement` : "Account Statement"}</h1>
<div class="subtitle">As at ${card.reportDate} &nbsp;·&nbsp; Reporting currency: ${card.reportingCurrency} &nbsp;·&nbsp; ${card.totalLines} transaction${card.totalLines !== 1 ? "s" : ""} &nbsp;·&nbsp; ${card.earliestDate ?? "—"} to ${card.latestDate ?? "—"}</div>

<div class="summary-grid">
  <div class="summary-cell"><div class="summary-label">Capital Deployed</div><div class="summary-value negative">−${card.summary.totalContributions}</div></div>
  <div class="summary-cell"><div class="summary-label">Fees Paid</div><div class="summary-value negative">−${card.summary.totalFees}</div></div>
  <div class="summary-cell"><div class="summary-label">Distributions</div><div class="summary-value positive">+${card.summary.totalDistributions}</div></div>
  <div class="summary-cell"><div class="summary-label">Net Cash Flow</div><div class="summary-value ${card.summary.netCashFlowRaw >= 0 ? "positive" : ""}">${netSign}${card.summary.netCashFlow}</div></div>
</div>

<div class="narrative">${card.plainSummary}${card.fxNote ? `<br><br><em>${card.fxNote}</em>` : ""}</div>

${card.categories.map((cat) => `
<div class="category-header">${cat.name} &nbsp; (${cat.lineCount} line${cat.lineCount !== 1 ? "s" : ""}) &nbsp; Total: ${cat.direction === "out" ? "−" : "+"}${cat.totalDisplay}</div>
<table>
<thead><tr>
  <th>Date</th><th>Type</th><th>Company</th><th>Round</th>
  <th style="text-align:right">Deal Amount</th>
  <th style="text-align:right">${card.reportingCurrency}</th>
  <th>Reference</th>
</tr></thead>
<tbody>
${cat.lines.map((l) => `<tr>
  <td class="td-date">${l.date}</td>
  <td class="td-type">${l.type}</td>
  <td>${l.company}</td>
  <td>${l.round}</td>
  <td class="td-amount ${l.direction}">${l.direction === "out" ? "−" : "+"}${l.amountDisplay}</td>
  <td class="td-amount ${l.direction}">${l.direction === "out" ? "−" : "+"}${l.amountRptDisplay}</td>
  <td class="td-ref">${l.referenceId}</td>
</tr>`).join("")}
</tbody>
</table>`).join("")}

<div class="footer">
  <p>This statement is for informational purposes only and does not constitute investment advice. All amounts are in ${card.reportingCurrency} unless otherwise noted.</p>
  ${card.fxNote ? `<p>${card.fxNote}</p>` : ""}
  <p>Statement period: ${card.earliestDate ?? "N/A"} – ${card.latestDate ?? "N/A"} &nbsp;·&nbsp; Generated ${card.reportDate}</p>
</div>
</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

function StatementLedger({
  card,
  evidence,
  onViewSources,
}: {
  card: StatementCard;
  evidence: EvidenceItem[];
  onViewSources: (ev: EvidenceItem[]) => void;
}) {
  const netIsPositive = card.summary.netCashFlowRaw >= 0;

  return (
    <div className="mt-5 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
            Account Statement
          </span>
          {(card.earliestDate || card.latestDate) && (
            <span className="text-[10px] text-slate-700 tabular-nums">
              {card.earliestDate} → {card.latestDate}
            </span>
          )}
        </div>
        <button
          onClick={() => printStatement(card)}
          className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg border border-base-border text-slate-500 hover:text-slate-300 hover:border-base-border-strong transition-colors"
          title="Open printable view (supports Save as PDF)"
        >
          <Printer className="w-3 h-3" />
          Print / Export PDF
        </button>
      </div>

      {/* Plain-language summary */}
      <div className="rounded-xl border border-base-border bg-base-surface px-4 py-3 space-y-1.5">
        <p className="text-slate-300 text-xs leading-relaxed">{card.plainSummary}</p>
        {card.fxNote && (
          <p className="text-[11px] text-slate-600 leading-relaxed">{card.fxNote}</p>
        )}
        <p className="text-[10px] text-slate-700">
          {card.totalLines} transaction{card.totalLines !== 1 ? "s" : ""} recorded
          {" "}· reporting currency: <span className="text-slate-500">{card.reportingCurrency}</span>
          {" "}· data as at <span className="text-slate-500 tabular-nums">{card.reportDate}</span>
        </p>
        <p className="text-[10px] text-amber-600/70 leading-relaxed">
          Statement lines reflect actual cash movements only. Portfolio value (MOIC, unrealised gains) lives in the portfolio overview — these are different views of your account that complement but do not duplicate each other.
        </p>
      </div>

      {/* Summary KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-base-border border border-base-border rounded-xl overflow-hidden bg-base-elevated">
        {[
          { label: "Capital Deployed", value: card.summary.totalContributions, prefix: "−", color: "text-slate-300" },
          { label: "Fees Paid", value: card.summary.totalFees, prefix: "−", color: "text-slate-300" },
          { label: "Distributions", value: card.summary.totalDistributions, prefix: "+", color: "text-emerald-400" },
          {
            label: "Net Cash Flow",
            value: card.summary.netCashFlow,
            prefix: netIsPositive ? "+" : "−",
            color: netIsPositive ? "text-emerald-400" : "text-slate-300",
          },
        ].map((kpi, i) => (
          <div key={i} className="px-4 py-3">
            <div className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">{kpi.label}</div>
            <div className={clsx("text-sm tabular-nums font-semibold", kpi.color)}>
              {kpi.prefix}{kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Category blocks */}
      {card.categories.map((cat) => (
        <StatementCategoryBlock
          key={cat.name}
          category={cat}
          evidence={evidence}
          onViewSources={onViewSources}
          reportingCurrency={card.reportingCurrency}
        />
      ))}
    </div>
  );
}

function StatementCategoryBlock({
  category,
  evidence,
  onViewSources,
  reportingCurrency,
}: {
  category: StatementCategoryData;
  evidence: EvidenceItem[];
  onViewSources: (ev: EvidenceItem[]) => void;
  reportingCurrency: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const isInflow = category.direction === "in";

  const categoryEvidence = evidence.filter((ev) =>
    category.lines.some((l) => l.lineId === ev.id)
  );

  return (
    <div className="rounded-xl border border-base-border bg-base-elevated overflow-hidden">
      {/* Category header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-base-border bg-base-surface">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={clsx(
              "w-1 h-5 rounded-full flex-none",
              isInflow ? "bg-emerald-500/50" : "bg-slate-600/40"
            )}
          />
          <div>
            <div className="text-slate-200 text-sm font-medium">{category.name}</div>
            <div className="text-slate-600 text-[10px]">{category.subLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-none">
          <div className="text-right">
            <div
              className={clsx(
                "text-sm tabular-nums font-semibold",
                isInflow ? "text-emerald-400" : "text-slate-300"
              )}
            >
              {isInflow ? "+" : "−"}{category.totalDisplay}
            </div>
            <div className="text-[10px] text-slate-600">
              {category.lineCount} line{category.lineCount !== 1 ? "s" : ""}
            </div>
          </div>
          {categoryEvidence.length > 0 && (
            <button
              onClick={() => onViewSources(categoryEvidence)}
              className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-accent transition-colors px-2 py-1 rounded border border-transparent hover:border-base-border"
              title={`View all ${categoryEvidence.length} source records for this category`}
            >
              <BookOpen className="w-3 h-3" />
              <span>{categoryEvidence.length}</span>
            </button>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-slate-600 hover:text-slate-300 transition-colors p-1"
          >
            <ChevronDown
              className={clsx("w-4 h-4 transition-transform duration-150", expanded && "rotate-180")}
            />
          </button>
        </div>
      </div>

      {/* Column headers */}
      {expanded && (
        <>
          <div className="grid grid-cols-[80px_1fr_auto] gap-2 px-4 py-1.5 border-b border-base-border/50 bg-base-surface/30">
            <span className="text-[9px] uppercase tracking-widest text-slate-700">Date</span>
            <span className="text-[9px] uppercase tracking-widest text-slate-700">Company · Type</span>
            <span className="text-[9px] uppercase tracking-widest text-slate-700 text-right">Amount</span>
          </div>
          <div className="divide-y divide-base-border/30">
            {category.lines.map((line) => (
              <StatementLineRow
                key={line.lineId}
                line={line}
                evidence={evidence}
                onViewSources={onViewSources}
                reportingCurrency={reportingCurrency}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatementLineRow({
  line,
  evidence,
  onViewSources,
  reportingCurrency,
}: {
  line: StatementLineItem;
  evidence: EvidenceItem[];
  onViewSources: (ev: EvidenceItem[]) => void;
  reportingCurrency: string;
}) {
  const lineEvidence = evidence.filter((ev) => ev.id === line.lineId);
  const isInflow = line.direction === "in";

  return (
    <div className="flex items-center px-4 py-2.5 hover:bg-base-surface/40 transition-colors group gap-2">
      {/* Date */}
      <span className="text-[11px] text-slate-600 tabular-nums w-20 flex-none shrink-0">
        {line.date}
      </span>

      {/* Company + round + type */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-slate-300 font-medium truncate">{line.company}</span>
        {line.round && (
          <>
            <span className="text-slate-700 text-[10px]">·</span>
            <span className="text-[10px] text-slate-500">{line.round}</span>
          </>
        )}
        <span className="text-slate-700 text-[10px]">·</span>
        <span className="text-[10px] text-slate-600">{line.type}</span>
      </div>

      {/* Amounts + reference + source */}
      <div className="flex items-center gap-2.5 flex-none text-right">
        {line.dealCurrency !== reportingCurrency && (
          <span className="text-[10px] text-slate-700 tabular-nums hidden sm:block">
            {isInflow ? "+" : "−"}{line.amountDisplay}
          </span>
        )}
        <span
          className={clsx(
            "text-xs tabular-nums font-semibold w-24 text-right",
            isInflow ? "text-emerald-400" : "text-slate-300"
          )}
        >
          {isInflow ? "+" : "−"}{line.amountRptDisplay}
        </span>
        <span className="text-[9px] text-slate-700 font-mono hidden md:block w-16 text-right truncate">
          {line.referenceId}
        </span>
        <button
          onClick={() => lineEvidence.length > 0 && onViewSources(lineEvidence)}
          className={clsx(
            "w-5 h-5 flex items-center justify-center rounded transition-all",
            lineEvidence.length > 0
              ? "text-slate-700 hover:text-accent opacity-0 group-hover:opacity-100"
              : "invisible"
          )}
          title="View source record"
        >
          <BookOpen className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Valuation Timeline Card ──────────────────────────────────────────────────

const MARK_COLORS: Record<string, string> = {
  "Entry": "#64748b",
  "Internal": "#3b82f6",
  "Markup Round": "#4a9e70",
  "Exit": "#6366f1",
  "Write Off": "#c45b5b",
};

function ValuationSparkline({ marks, entrySharePrice }: {
  marks: ValuationMark[];
  dealCurrency: string;
  entrySharePrice: number;
}) {
  if (marks.length < 2) return null;

  const W = 440; const H = 90;
  const PAD = { top: 10, right: 14, bottom: 20, left: 8 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const prices = marks.map((m) => m.sharePrice);
  const minPrice = Math.min(...prices, entrySharePrice * 0.85);
  const maxPrice = Math.max(...prices) * 1.05;
  const priceRange = maxPrice - minPrice || 1;
  const firstDate = new Date(marks[0].date).getTime();
  const lastDate = new Date(marks[marks.length - 1].date).getTime();
  const dateRange = lastDate - firstDate || 1;

  const toX = (date: string) => PAD.left + ((new Date(date).getTime() - firstDate) / dateRange) * chartW;
  const toY = (price: number) => PAD.top + chartH - ((price - minPrice) / priceRange) * chartH;
  const entryY = toY(entrySharePrice);
  const points = marks.map((m) => ({ x: toX(m.date), y: toY(m.sharePrice), m }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }} aria-hidden="true">
      <line x1={PAD.left} y1={entryY} x2={W - PAD.right} y2={entryY} stroke="#1d2638" strokeWidth="1" strokeDasharray="3 3" />
      <text x={W - PAD.right + 2} y={entryY + 3} fontSize="7.5" fill="#293550">entry</text>
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => {
        if (i === 0 || !p.m.isDownRound) return null;
        const prev = points[i - 1];
        return <rect key={p.m.valuationId + "-shade"} x={prev.x} y={PAD.top} width={p.x - prev.x} height={chartH} fill="#c45b5b" fillOpacity="0.06" />;
      })}
      {points.map((p) => (
        <circle key={p.m.valuationId} cx={p.x} cy={p.y} r={3.5} fill={p.m.isDownRound ? "#c45b5b" : (MARK_COLORS[p.m.markSource] ?? "#64748b")} stroke="#141c28" strokeWidth="1.5" />
      ))}
      <text x={points[0].x} y={H - 2} fontSize="7.5" fill="#293550" textAnchor="middle">{marks[0].date.slice(0, 7)}</text>
      <text x={points[points.length - 1].x} y={H - 2} fontSize="7.5" fill="#293550" textAnchor="middle">{marks[marks.length - 1].date.slice(0, 7)}</text>
      {(() => {
        const peak = [...points].sort((a, b) => b.m.sharePrice - a.m.sharePrice)[0];
        return <text x={peak.x} y={peak.y - 7} fontSize="7.5" fill="#94a3b8" textAnchor="middle" fontWeight="600">{peak.m.sharePriceDisplay}</text>;
      })()}
    </svg>
  );
}

function ValuationTimelineCard({ card }: { card: ValuationCard }) {
  if (card.timelines.length === 0) return null;
  return (
    <div className="mt-5 space-y-3">
      {card.timelines.map((tl) => <ValuationTimelineItem key={`${tl.company}-${tl.round}`} tl={tl} />)}
    </div>
  );
}

function ValuationTimelineItem({ tl }: { tl: ValuationCardTimeline }) {
  const [showTable, setShowTable] = useState(false);
  const gainLoss = tl.currentUnrealisedGainLoss ?? 0;
  const isGain = gainLoss >= 0;

  return (
    <div className="rounded-xl border border-base-border bg-base-elevated overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-base-border bg-base-surface">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-200 text-sm font-medium">{tl.company}</span>
          <span className="text-slate-600 text-xs">{tl.round}</span>
          {tl.isWrittenOff && <span className="badge-written-off">Written Off</span>}
          {tl.isExited && <span className="badge-exited">Exited</span>}
          {tl.hasDownRound && (
            <span className="badge flex items-center gap-1 bg-red-950/60 text-red-400 border-red-900/40">
              <TrendingDown className="w-2.5 h-2.5" /> Down round
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-600 tabular-nums flex-none">
          {tl.markCount} marks · {Math.round(tl.spanDays / 365 * 10) / 10}yr
        </span>
      </div>

      {tl.marks.length >= 2 && (
        <div className="px-4 pt-4 pb-1">
          <ValuationSparkline marks={tl.marks} dealCurrency={tl.dealCurrency} entrySharePrice={tl.entrySharePrice} />
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-base-border border-t border-base-border">
        {[
          { label: "Entry price", value: `${tl.dealCurrency} ${tl.entrySharePrice}`, sub: tl.effectiveSharePrice !== tl.entrySharePrice ? `Your price: ${tl.dealCurrency} ${tl.effectiveSharePrice}` : null },
          { label: "Latest mark", value: tl.latestSharePriceDisplay ?? "—" },
          { label: "Your MOIC", value: tl.latestMoicDisplay, color: tl.latestMoic === null ? "text-slate-600" : tl.latestMoic >= 2 ? "text-emerald-400" : tl.latestMoic >= 1 ? "text-slate-200" : "text-red-400" },
          { label: "Unrealised G/L", value: tl.currentUnrealisedGainLossDisplay ?? "—", color: isGain ? "text-emerald-400" : "text-red-400" },
        ].map((cell, i) => (
          <div key={i} className="px-4 py-3">
            <div className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">{cell.label}</div>
            <div className={clsx("text-xs tabular-nums font-medium", (cell as { color?: string }).color ?? "text-slate-300")}>
              {cell.value}
            </div>
            {(cell as { sub?: string | null }).sub && (
              <div className="text-[10px] text-slate-600 mt-0.5">{(cell as { sub?: string | null }).sub}</div>
            )}
          </div>
        ))}
      </div>

      {(tl.isSparse || tl.hasDownRound || tl.isWrittenOff) && (
        <div className="px-4 py-3 border-t border-base-border space-y-1.5">
          {tl.isSparse && (
            <div className="flex items-start gap-1.5 text-[11px] text-amber-500/70">
              <Info className="w-3 h-3 flex-none mt-px" />
              <span>Infrequent cadence — longest gap: {Math.round(tl.maxGapDays / 30)} months. Value between marks is unobservable.</span>
            </div>
          )}
          {tl.hasDownRound && tl.downRounds.map((dr) => (
            <div key={dr.date} className="flex items-start gap-1.5 text-[11px] text-red-400/70">
              <TrendingDown className="w-3 h-3 flex-none mt-px" />
              <span>Down round {dr.date}: {tl.dealCurrency} {dr.fromPrice} → {dr.toPrice} (−{dr.pctDrop.toFixed(1)}%)</span>
            </div>
          ))}
          {tl.isWrittenOff && (
            <div className="flex items-start gap-1.5 text-[11px] text-red-400/70">
              <AlertTriangle className="w-3 h-3 flex-none mt-px" />
              <span>Position written off — current value is zero.</span>
            </div>
          )}
        </div>
      )}

      {tl.peakMoic !== null && tl.peakMoic !== tl.latestMoic && (
        <div className="px-4 pb-3 -mt-1">
          <span className="text-[10px] text-slate-700">Peak MOIC: {tl.peakMoicDisplay} ({tl.peakMoicDate?.slice(0, 7)})</span>
        </div>
      )}

      <div className="border-t border-base-border">
        <button onClick={() => setShowTable((s) => !s)} className="disclosure-trigger">
          <span>Valuation marks ({tl.markCount})</span>
          <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform duration-150", showTable && "rotate-180")} />
        </button>
        {showTable && (
          <div className="overflow-x-auto border-t border-base-border">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {["Date", "Source", "Price", "vs Entry", "Chg %", "Your value", "MOIC"].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-[10px] text-slate-600 font-medium uppercase tracking-wider border-b border-base-border whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tl.marks.map((m) => (
                  <tr key={m.valuationId} className={clsx("border-b border-base-border/40 last:border-0 hover:bg-base-surface/50 transition-colors", m.isDownRound && "bg-red-950/10")}>
                    <td className="py-2 px-3 text-slate-500 tabular-nums whitespace-nowrap">{m.date}</td>
                    <td className="py-2 px-3">
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: MARK_COLORS[m.markSource] ?? "#64748b", background: (MARK_COLORS[m.markSource] ?? "#64748b") + "1a" }}>
                        {m.markSource}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-300 whitespace-nowrap">{m.sharePriceDisplay}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-500">{m.multipleVsEntry}×</td>
                    <td className={clsx("py-2 px-3 text-right tabular-nums", m.priceChangePct === null ? "text-slate-700" : m.isDownRound ? "text-red-400" : m.priceChangePct > 0 ? "text-emerald-400" : "text-slate-500")}>
                      {m.priceChangePct === null ? "—" : `${m.priceChangePct >= 0 ? "+" : ""}${m.priceChangePct.toFixed(1)}%`}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-300 whitespace-nowrap">{m.investorValueDisplay}</td>
                    <td className={clsx("py-2 px-3 text-right tabular-nums font-medium whitespace-nowrap", m.moicAtMark === null ? "text-slate-700" : m.moicAtMark >= 2 ? "text-emerald-400" : m.moicAtMark >= 1 ? "text-slate-300" : "text-red-400")}>
                      {m.moicDisplay}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
