"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  ChevronDown,
  X,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  ShieldAlert,
  LayoutGrid,
  FileText,
  BookOpen,
  Loader2,
  Sparkles,
  Tag,
  CheckCircle2,
  Info,
} from "lucide-react";
import clsx from "clsx";
import type { ChatMessage, EvidenceItem, QueryIntent } from "@/lib/domain/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Investor {
  id: string;
  name: string;
  type: string;
  reportingCurrency: string;
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
  };
  starterPrompts: string[];
}

// ─── Fee card types (mirrors the shape built in chat route's buildFeeCard) ────

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
  routerDebug?: RouterDebugData;
  answerObject?: AnswerObjectData;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  if (moic === null) return <span className="text-slate-500 text-xs">N/A</span>;
  const isUp = moic >= 1;
  const isDown = moic < 1;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
        isUp ? "text-emerald-400" : isDown ? "text-red-400" : "text-slate-400"
      )}
    >
      {isUp ? (
        <TrendingUp className="w-3 h-3" />
      ) : isDown ? (
        <TrendingDown className="w-3 h-3" />
      ) : (
        <Minus className="w-3 h-3" />
      )}
      {moic.toFixed(2)}×
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = clsx("badge-active", {
    "badge-active": status === "Active" || status === "Verified",
    "badge-exited": status === "Exited",
    "badge-written-off": status === "Written Off",
    "badge-pending": status === "Pending",
  });
  return <span className={cls}>{status}</span>;
}

function SourceTypePill({ type }: { type: EvidenceItem["sourceType"] }) {
  const labels: Record<EvidenceItem["sourceType"], string> = {
    allocation: "Allocation",
    valuation: "Valuation",
    capital_call: "Capital Call",
    fee: "Fee",
    distribution: "Distribution",
    statement_line: "Statement",
    deal: "Deal",
  };
  const colors: Record<EvidenceItem["sourceType"], string> = {
    allocation: "bg-teal-950 text-teal-400 border-teal-900",
    valuation: "bg-blue-950 text-blue-400 border-blue-900",
    capital_call: "bg-amber-950 text-amber-400 border-amber-900",
    fee: "bg-orange-950 text-orange-400 border-orange-900",
    distribution: "bg-emerald-950 text-emerald-400 border-emerald-900",
    statement_line: "bg-purple-950 text-purple-400 border-purple-900",
    deal: "bg-slate-800 text-slate-400 border-slate-700",
  };
  return (
    <span className={clsx("text-xs px-1.5 py-0.5 rounded border", colors[type])}>
      {labels[type]}
    </span>
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
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasFallbackMode = messages.some((m) => m.fallbackMode);
  const isDev = process.env.NODE_ENV === "development";

  // Load snapshot whenever investor changes
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

  // Auto-scroll chat
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
      const history: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          investorId: selectedInvestorId,
          history,
        }),
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
          content:
            err instanceof Error
              ? `Sorry, something went wrong: ${err.message}`
              : "An unexpected error occurred.",
          error: true,
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentInvestor = investors.find((i) => i.id === selectedInvestorId);

  return (
    <div className="flex flex-col h-screen bg-[#09090f]">
      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <header className="flex-none flex items-center justify-between px-6 py-3 border-b border-base-border bg-base-surface">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <span className="text-slate-950 font-bold text-sm">E</span>
            </div>
            <div>
              <div className="text-slate-100 font-semibold text-sm leading-none">EquiTie</div>
              <div className="text-slate-500 text-xs leading-none mt-0.5">Investor Portal</div>
            </div>
          </div>

          <div className="w-px h-8 bg-base-border mx-2" />

          {/* Investor selector */}
          <div className="relative">
            <button
              onClick={() => setSelectorOpen((o) => !o)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-base-border hover:border-accent/40 hover:bg-base-elevated transition-all text-sm"
            >
              <div className="w-6 h-6 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center">
                <span className="text-accent text-xs font-semibold">
                  {currentInvestor?.name.charAt(0) ?? "?"}
                </span>
              </div>
              <span className="text-slate-200 font-medium">{currentInvestor?.name ?? "Select investor"}</span>
              <span className="text-slate-500 text-xs">{currentInvestor?.reportingCurrency}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            </button>

            {selectorOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 card border-base-border-strong shadow-xl z-50 max-h-64 overflow-y-auto">
                <div className="p-2">
                  <div className="text-xs text-slate-500 px-2 py-1 mb-1">Switch investor (demo)</div>
                  {investors.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => {
                        setSelectedInvestorId(inv.id);
                        setSelectorOpen(false);
                      }}
                      className={clsx(
                        "w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm transition-colors",
                        inv.id === selectedInvestorId
                          ? "bg-accent/10 text-accent"
                          : "text-slate-300 hover:bg-base-elevated"
                      )}
                    >
                      <span className="font-medium truncate">{inv.name}</span>
                      <span className="text-slate-500 text-xs ml-auto flex-none">{inv.reportingCurrency}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {hasFallbackMode && (
            <div className="flex items-center gap-1.5 text-amber-400 text-xs bg-amber-950/50 border border-amber-900/50 px-2.5 py-1 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5" />
              Demo mode — connect API key for AI phrasing
            </div>
          )}
          {isDev && (
            <button
              onClick={() => setShowDebug((d) => !d)}
              title="Toggle router debug panel"
              className={clsx(
                "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border transition-colors",
                showDebug
                  ? "bg-violet-950 border-violet-700 text-violet-300"
                  : "border-base-border text-slate-600 hover:border-violet-800 hover:text-violet-400"
              )}
            >
              <span>{"</>"}</span>
              <span>debug</span>
            </button>
          )}
          <div className="text-xs text-slate-600">Report date: 25 Jun 2026</div>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Sidebar ────────────────────────────────────────────────────────── */}
        <aside className="flex-none w-64 border-r border-base-border flex flex-col overflow-hidden bg-base-surface">
          {snapshotLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
            </div>
          ) : !snapshot ? (
            <div className="flex-1 flex items-center justify-center p-4">
              <p className="text-slate-600 text-sm text-center">Failed to load investor data</p>
            </div>
          ) : (
            <>
              {/* Investor identity */}
              <div className="p-4 border-b border-base-border">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-full bg-accent/15 border border-accent/25 flex items-center justify-center">
                    <span className="text-accent font-semibold">
                      {snapshot.investor.name.charAt(0)}
                    </span>
                  </div>
                  {snapshot.investor.kycStatus === "Verified" ? (
                    <Shield className="w-4 h-4 text-emerald-400 mt-1" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-amber-400 mt-1" />
                  )}
                </div>
                <div className="text-slate-100 font-semibold text-sm leading-tight">
                  {snapshot.investor.name}
                </div>
                <div className="text-slate-500 text-xs mt-0.5">
                  {snapshot.investor.type} · {snapshot.investor.country}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <StatusBadge status={snapshot.investor.kycStatus} />
                  <span className="text-slate-600 text-xs">{snapshot.investor.reportingCurrency}</span>
                </div>
              </div>

              {/* Portfolio stats */}
              <div className="p-4 border-b border-base-border space-y-3">
                <div className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Portfolio</div>

                <div>
                  <div className="text-xs text-slate-500 mb-0.5">Total Value</div>
                  <div className="text-slate-100 font-semibold tabular-nums">
                    {snapshot.snapshot.totalValue}
                  </div>
                </div>

                <div className="flex gap-4">
                  <div>
                    <div className="text-xs text-slate-500 mb-0.5">Contributed</div>
                    <div className="text-slate-300 text-sm tabular-nums">
                      {snapshot.snapshot.totalContributed}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-0.5">MOIC</div>
                    <MoicBadge moic={snapshot.snapshot.portfolioMoicRaw} />
                  </div>
                </div>

                <div className="flex gap-4">
                  <div>
                    <div className="text-xs text-slate-500 mb-0.5">Active</div>
                    <div className="text-slate-300 text-sm">{snapshot.snapshot.activePositions}</div>
                  </div>
                  {snapshot.snapshot.pendingPositions > 0 && (
                    <div>
                      <div className="text-xs text-slate-500 mb-0.5">Pending</div>
                      <div className="text-amber-400 text-sm">{snapshot.snapshot.pendingPositions}</div>
                    </div>
                  )}
                </div>

                {snapshot.snapshot.topSectors.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Top sectors</div>
                    <div className="flex flex-wrap gap-1">
                      {snapshot.snapshot.topSectors.map((s) => (
                        <span
                          key={s}
                          className="text-xs px-1.5 py-0.5 rounded bg-base-elevated text-slate-400 border border-base-border"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {snapshot.snapshot.hasOverdueObligations && (
                  <div className="flex items-center gap-1.5 text-red-400 text-xs bg-red-950/30 border border-red-900/40 rounded-lg px-2.5 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-none" />
                    Overdue obligations
                  </div>
                )}
              </div>

              {/* Holdings list */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Holdings</div>
                <div className="space-y-2">
                  {snapshot.snapshot.holdings.map((h) => (
                    <button
                      key={h.allocationId}
                      onClick={() => handleSend(`Tell me about my position in ${h.company}`)}
                      className="w-full text-left group"
                    >
                      <div className="p-2.5 rounded-lg border border-transparent hover:border-base-border hover:bg-base-elevated transition-all">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-slate-200 text-xs font-medium truncate group-hover:text-accent transition-colors">
                              {h.company}
                            </div>
                            <div className="text-slate-600 text-xs">{h.round}</div>
                          </div>
                          <MoicBadge moic={h.moic} />
                        </div>
                        <div className="flex items-center gap-1 mt-1.5">
                          <StatusBadge status={h.dealStatus} />
                          {h.allocationStatus === "Pending" && (
                            <StatusBadge status="Pending" />
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>

        {/* ── Chat ──────────────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            {messages.length === 0 && !snapshotLoading && snapshot && (
              <EmptyState
                investorName={snapshot.investor.name}
                starterPrompts={snapshot.starterPrompts}
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

          {/* Input */}
          <div className="flex-none border-t border-base-border bg-base-surface p-4">
            <div className="flex items-end gap-3 max-w-3xl mx-auto">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your portfolio, a specific position, fees, obligations…"
                  rows={1}
                  className="w-full bg-base-elevated border border-base-border rounded-xl px-4 py-3 text-slate-200 text-sm placeholder-slate-600 resize-none focus:outline-none focus:border-accent/50 focus:bg-base-elevated/80 transition-all pr-12"
                  style={{ minHeight: "48px", maxHeight: "120px" }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = "auto";
                    target.style.height = Math.min(target.scrollHeight, 120) + "px";
                  }}
                  disabled={isThinking}
                />
              </div>
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isThinking}
                className="flex-none w-10 h-10 rounded-xl bg-accent disabled:bg-accent/30 flex items-center justify-center transition-all hover:bg-accent-dim"
              >
                {isThinking ? (
                  <Loader2 className="w-4 h-4 text-slate-950 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 text-slate-950" />
                )}
              </button>
            </div>
            <div className="text-center mt-2 text-xs text-slate-700">
              EquiTie AI · Data as of 25 Jun 2026 · Not investment advice
            </div>
          </div>
        </main>

        {/* ── Evidence panel ─────────────────────────────────────────────────── */}
        {evidencePanelOpen && (
          <aside className="flex-none w-72 border-l border-base-border flex flex-col overflow-hidden bg-base-surface animate-fade-in">
            <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-base-border">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-accent" />
                <span className="text-sm font-medium text-slate-200">Sources</span>
                <span className="text-xs text-slate-600 bg-base-elevated px-1.5 py-0.5 rounded">
                  {activeEvidence.length}
                </span>
              </div>
              <button
                onClick={() => setEvidencePanelOpen(false)}
                className="btn-ghost p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {activeEvidence.map((ev, idx) => (
                <div
                  key={`${ev.id}-${idx}`}
                  className="p-3 rounded-lg border border-base-border bg-base-elevated hover:border-base-border-strong transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <SourceTypePill type={ev.sourceType} />
                    <span className="text-slate-600 text-xs font-mono">{ev.id}</span>
                  </div>
                  <div className="text-slate-300 text-xs font-medium mb-1">{ev.label}</div>
                  <div className="text-slate-500 text-xs leading-relaxed">{ev.detail}</div>
                  {ev.amount !== undefined && ev.currency && (
                    <div className="mt-1.5 text-accent text-xs font-semibold tabular-nums">
                      {ev.currency} {ev.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                  )}
                  {ev.date && (
                    <div className="text-slate-600 text-xs mt-0.5">{ev.date}</div>
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({
  investorName,
  starterPrompts,
  onPrompt,
}: {
  investorName: string;
  starterPrompts: string[];
  onPrompt: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-accent/15 border border-accent/25 flex items-center justify-center mb-5">
        <Sparkles className="w-7 h-7 text-accent" />
      </div>
      <h2 className="text-slate-100 text-xl font-semibold mb-2">
        Hello, {investorName.split(" ")[0]}
      </h2>
      <p className="text-slate-500 text-sm max-w-sm mb-8 leading-relaxed">
        Ask me anything about your portfolio — current value, fees, upcoming obligations, distributions, or the story behind any position.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
        {starterPrompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPrompt(prompt)}
            className="text-left px-4 py-3 rounded-xl border border-base-border bg-base-surface hover:border-accent/30 hover:bg-base-elevated transition-all group"
          >
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center flex-none mt-0.5">
                <PromptIcon prompt={prompt} />
              </div>
              <span className="text-slate-300 text-sm group-hover:text-slate-100 transition-colors leading-snug">
                {prompt}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PromptIcon({ prompt }: { prompt: string }) {
  const lower = prompt.toLowerCase();
  if (/overview|portfolio/.test(lower)) return <LayoutGrid className="w-3 h-3 text-accent" />;
  if (/statement|account/.test(lower)) return <FileText className="w-3 h-3 text-accent" />;
  if (/obligation|fee|call/.test(lower)) return <AlertTriangle className="w-3 h-3 text-amber-400" />;
  if (/distribut|exit/.test(lower)) return <TrendingUp className="w-3 h-3 text-emerald-400" />;
  return <Sparkles className="w-3 h-3 text-accent" />;
}

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
      <div className="flex justify-end">
        <div className="max-w-[70%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-accent/20 border border-accent/25 text-slate-200 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 max-w-3xl animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="flex-none w-7 h-7 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center mt-0.5">
          <span className="text-accent font-bold text-xs">E</span>
        </div>
        <div className="flex-1 min-w-0">

          {/* Title */}
          {ao?.title && (
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{ao.title}</p>
          )}

          {/* Concise answer highlight */}
          {ao?.conciseAnswer && (
            <div className="mb-3 px-3 py-2 rounded-lg border border-accent/20 bg-accent/5 text-sm text-slate-200 font-medium">
              {ao.conciseAnswer}
            </div>
          )}

          {/* Key metrics chips */}
          {ao && ao.keyMetrics.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {ao.keyMetrics.map((m, i) => (
                <div
                  key={i}
                  className={clsx(
                    "flex flex-col px-3 py-1.5 rounded-lg border text-xs",
                    m.sentiment === "positive" && "border-emerald-800 bg-emerald-950/60 text-emerald-300",
                    m.sentiment === "negative" && "border-red-800 bg-red-950/60 text-red-300",
                    m.sentiment === "warning" && "border-amber-800 bg-amber-950/60 text-amber-300",
                    (!m.sentiment || m.sentiment === "neutral") && "border-slate-700 bg-slate-800/60 text-slate-300"
                  )}
                >
                  <span className="font-semibold tabular-nums">{m.value}</span>
                  <span className="text-[10px] opacity-70 mt-0.5">{m.label}{m.subtext ? ` · ${m.subtext}` : ""}</span>
                </div>
              ))}
            </div>
          )}

          {/* Detailed narrative (prose) */}
          <div
            className={clsx(
              "prose-dark text-sm leading-relaxed",
              message.error && "text-red-400"
            )}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />

          {message.feeCard && (
            <FeeBreakdownCard feeCard={message.feeCard} />
          )}

          {message.valuationCard && (
            <ValuationTimelineCard card={message.valuationCard} />
          )}

          {/* Glossary terms */}
          {ao && ao.glossaryTerms.length > 0 && (
            <AnswerGlossary terms={ao.glossaryTerms} />
          )}

          {/* Caveats */}
          {ao && ao.caveats.length > 0 && (
            <AnswerCaveats caveats={ao.caveats} />
          )}

          {/* Calculation note */}
          {ao?.calculationNote && (
            <AnswerCalculationNote note={ao.calculationNote} />
          )}

          {showDebug && message.routerDebug && (
            <QueryDebugPanel debug={message.routerDebug} />
          )}

          {hasEvidence && (
            <button
              onClick={() => onViewSources(message.evidence!)}
              className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-accent transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              {message.evidence!.length} source{message.evidence!.length !== 1 ? "s" : ""}
              {message.fallbackMode && (
                <span className="ml-2 text-amber-500/70">(demo mode)</span>
              )}
            </button>
          )}

          {/* Follow-up questions */}
          {ao && ao.followUpQuestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ao.followUpQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onSend(q)}
                  className="text-xs px-2.5 py-1 rounded-full border border-slate-700 bg-slate-800/50 text-slate-400 hover:border-accent/50 hover:text-accent transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Answer object sub-components ─────────────────────────────────────────────

function AnswerGlossary({ terms }: { terms: GlossaryEntryData[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-400 hover:text-slate-300 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5" />
          Glossary ({terms.length} term{terms.length !== 1 ? "s" : ""})
        </span>
        <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-800">
          {terms.map((t, i) => (
            <div key={i} className="pt-2">
              <p className="text-xs font-semibold text-slate-300">
                {t.term}{t.abbreviation && <span className="text-slate-500 font-normal ml-1">({t.abbreviation})</span>}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{t.shortDef}</p>
              {t.formula && <p className="text-xs text-slate-500 mt-0.5 font-mono">{t.formula}</p>}
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
    <div className="mt-2 rounded-lg border border-amber-900/50 bg-amber-950/20 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-amber-500/70 hover:text-amber-400 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {caveats.length} caveat{caveats.length !== 1 ? "s" : ""}
        </span>
        <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-1 border-t border-amber-900/30">
          {caveats.map((c, i) => (
            <li key={i} className="pt-1.5 text-xs text-amber-400/80 flex gap-1.5">
              <span className="text-amber-600 mt-0.5">•</span>
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
    <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/30 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-500 hover:text-slate-400 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          How this was calculated
        </span>
        <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <p className="px-3 pb-3 pt-2 text-xs text-slate-500 border-t border-slate-800 leading-relaxed">
          {note}
        </p>
      )}
    </div>
  );
}

// ─── Fee Breakdown Card ────────────────────────────────────────────────────────

function FeeBreakdownCard({ feeCard }: { feeCard: FeeCard }) {
  if (feeCard.deals.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {/* Summary strip */}
      {(feeCard.totalPaid !== "0" || feeCard.totalUpcoming !== "0") && (
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>
            <span className="text-slate-500">Paid:</span>{" "}
            <span className="text-slate-200 font-medium tabular-nums">{feeCard.totalPaid}</span>
          </span>
          <span className="text-slate-700">·</span>
          <span>
            <span className="text-slate-500">Upcoming:</span>{" "}
            <span className="text-slate-200 font-medium tabular-nums">{feeCard.totalUpcoming}</span>
          </span>
          {feeCard.hasAnyDiscount && (
            <>
              <span className="text-slate-700">·</span>
              <span className="flex items-center gap-1 text-emerald-400">
                <Tag className="w-3 h-3" />
                Negotiated discount applied
              </span>
            </>
          )}
        </div>
      )}

      {feeCard.deals.map((deal) => (
        <FeeCard key={`${deal.company}-${deal.round}`} deal={deal} reportingCurrency={feeCard.reportingCurrency} />
      ))}
    </div>
  );
}

function FeeCard({ deal, reportingCurrency }: { deal: FeeCardDeal; reportingCurrency: string }) {
  const [expanded, setExpanded] = useState(false);

  const statusCls = (s: string) =>
    clsx("text-xs px-1.5 py-0.5 rounded font-medium", {
      "bg-emerald-950 text-emerald-400 border border-emerald-900": s === "Paid",
      "bg-amber-950 text-amber-400 border border-amber-900": s === "Upcoming",
      "bg-red-950 text-red-400 border border-red-900": s === "Overdue",
    });

  return (
    <div className="rounded-xl border border-base-border bg-base-elevated overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-base-border">
        <div className="flex items-center gap-2">
          <Tag className="w-3.5 h-3.5 text-orange-400 flex-none" />
          <span className="text-slate-200 text-sm font-medium">{deal.company}</span>
          <span className="text-slate-500 text-xs">{deal.round}</span>
          {deal.hasDiscount && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-900/50">
              Discounted
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="text-slate-500">
            Paid <span className="text-slate-300">{deal.totalPaid}</span>
          </span>
          {deal.totalOverdue && (
            <span className="text-red-400 font-medium">Overdue {deal.totalOverdue}</span>
          )}
        </div>
      </div>

      {/* Plain summary */}
      <div className="px-4 py-3 border-b border-base-border">
        <p className="text-slate-400 text-xs leading-relaxed">{deal.plainSummary}</p>
      </div>

      {deal.noFeesYet ? (
        <div className="px-4 py-3 flex items-center gap-2 text-slate-500 text-xs">
          <Info className="w-3.5 h-3.5 flex-none text-slate-600" />
          No fee history yet. Fees will appear here once capital is deployed.
        </div>
      ) : (
        <>
          {/* Fee schedule: standard vs effective */}
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wide">Fee schedule</div>
            <div className="space-y-1.5">
              {deal.schedule.map((line) => (
                <FeeScheduleRow key={line.feeType} line={line} reportingCurrency={reportingCurrency} />
              ))}
            </div>
          </div>

          {/* Performance fee note */}
          <div className="px-4 pb-3">
            <div className="flex items-start gap-2 text-xs text-slate-500 bg-base-surface rounded-lg px-3 py-2">
              <Info className="w-3 h-3 flex-none mt-0.5 text-slate-600" />
              <span className="leading-relaxed">{deal.performanceFeeNote}</span>
            </div>
          </div>

          {/* Toggle for historical fee lines */}
          {deal.feeLines.length > 0 && (
            <div className="border-t border-base-border">
              <button
                onClick={() => setExpanded((e) => !e)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-base-surface/50 transition-colors"
              >
                <span>{deal.feeLines.length} fee line{deal.feeLines.length !== 1 ? "s" : ""}</span>
                <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
              </button>

              {expanded && (
                <div className="px-4 pb-3 space-y-1">
                  {deal.feeLines.map((fl) => (
                    <div
                      key={fl.feeId}
                      className="flex items-center justify-between text-xs py-1.5 border-b border-base-border last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-400 truncate">{fl.feeType}</span>
                        <span className="text-slate-600">{fl.period}</span>
                        {fl.hasDiscount && (
                          <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-none" />
                        )}
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
  const color =
    pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
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
    <div className="mt-3 rounded-lg border border-violet-900/50 bg-violet-950/20 overflow-hidden font-mono">
      {/* Header row — always visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-left hover:bg-violet-950/30 transition-colors"
      >
        <span className="text-violet-400">{"</>"}</span>
        <span className="text-violet-300 font-semibold">Router Debug</span>
        <span className={clsx("px-1.5 py-0.5 rounded border text-[10px]", intentColor)}>
          {debug.intent}
        </span>
        <span className="text-slate-500 ml-1">
          {Math.round(debug.confidence * 100)}% conf ·{" "}
          {debug.evidenceCount} evidence
        </span>
        <ChevronDown
          className={clsx("w-3 h-3 text-violet-500 ml-auto transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-violet-900/40 px-3 py-2.5 space-y-2.5 text-[11px]">
          {/* Confidence */}
          <div>
            <div className="text-slate-500 mb-1">Confidence</div>
            <ConfidenceBar value={debug.confidence} />
          </div>

          {/* Backend function */}
          <div>
            <div className="text-slate-500 mb-0.5">Backend function</div>
            <div className="text-violet-300">{debug.backendFunction}</div>
          </div>

          {/* Matched keywords */}
          {debug.matchedKeywords.length > 0 && (
            <div>
              <div className="text-slate-500 mb-1">Matched keywords</div>
              <div className="flex flex-wrap gap-1">
                {debug.matchedKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Entities */}
          <div>
            <div className="text-slate-500 mb-1">Entities</div>
            <div className="space-y-0.5 pl-2 border-l border-slate-700">
              {Object.entries(debug.entities).map(([k, v]) => {
                if (v === null || (Array.isArray(v) && v.length === 0)) return null;
                return (
                  <div key={k} className="flex gap-2">
                    <span className="text-slate-600 w-28 flex-none">{k}</span>
                    <span className="text-slate-300">
                      {Array.isArray(v)
                        ? v.join(", ")
                        : typeof v === "object"
                        ? JSON.stringify(v)
                        : String(v)}
                    </span>
                  </div>
                );
              })}
              {Object.values(debug.entities).every((v) => v === null) && (
                <span className="text-slate-600 italic">no entities extracted</span>
              )}
            </div>
          </div>

          {/* Clarification prompt */}
          {debug.clarificationPrompt && (
            <div>
              <div className="text-slate-500 mb-0.5">Clarification prompt</div>
              <div className="text-amber-400 italic">"{debug.clarificationPrompt}"</div>
            </div>
          )}

          {/* Reasoning */}
          <div>
            <div className="text-slate-500 mb-0.5">Reasoning</div>
            <div className="text-slate-400 leading-relaxed">{debug.reasoning}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Valuation Timeline Card ──────────────────────────────────────────────────

const MARK_COLORS: Record<string, string> = {
  "Entry": "#64748b",         // slate
  "Internal": "#3b82f6",      // blue
  "Markup Round": "#10b981",  // emerald
  "Exit": "#6366f1",          // indigo
  "Write Off": "#ef4444",     // red
};

function ValuationSparkline({ marks, dealCurrency, entrySharePrice }: {
  marks: ValuationMark[];
  dealCurrency: string;
  entrySharePrice: number;
}) {
  if (marks.length < 2) return null;

  const W = 440;
  const H = 90;
  const PAD = { top: 10, right: 12, bottom: 20, left: 8 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const prices = marks.map((m) => m.sharePrice);
  const minPrice = Math.min(...prices, entrySharePrice * 0.85);
  const maxPrice = Math.max(...prices) * 1.05;
  const priceRange = maxPrice - minPrice || 1;

  const firstDate = new Date(marks[0].date).getTime();
  const lastDate = new Date(marks[marks.length - 1].date).getTime();
  const dateRange = lastDate - firstDate || 1;

  const toX = (date: string) =>
    PAD.left + ((new Date(date).getTime() - firstDate) / dateRange) * chartW;
  const toY = (price: number) =>
    PAD.top + chartH - ((price - minPrice) / priceRange) * chartH;

  const entryY = toY(entrySharePrice);

  const points = marks.map((m) => ({ x: toX(m.date), y: toY(m.sharePrice), m }));
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      {/* Entry price reference line */}
      <line
        x1={PAD.left} y1={entryY} x2={W - PAD.right} y2={entryY}
        stroke="#334155" strokeWidth="1" strokeDasharray="3 3"
      />
      <text x={W - PAD.right + 2} y={entryY + 3} fontSize="8" fill="#475569">entry</text>

      {/* Line connecting marks */}
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" />

      {/* Down-round shading */}
      {points.map((p, i) => {
        if (i === 0 || !p.m.isDownRound) return null;
        const prev = points[i - 1];
        return (
          <rect
            key={p.m.valuationId + "-shade"}
            x={prev.x} y={PAD.top}
            width={p.x - prev.x} height={chartH}
            fill="#ef4444" fillOpacity="0.06"
          />
        );
      })}

      {/* Mark dots */}
      {points.map((p) => (
        <circle
          key={p.m.valuationId}
          cx={p.x} cy={p.y} r={4}
          fill={p.m.isDownRound ? "#ef4444" : (MARK_COLORS[p.m.markSource] ?? "#64748b")}
          stroke="#09090f" strokeWidth="1.5"
        />
      ))}

      {/* Date labels: first and last */}
      <text x={points[0].x} y={H - 2} fontSize="8" fill="#475569" textAnchor="middle">
        {marks[0].date.slice(0, 7)}
      </text>
      <text x={points[points.length - 1].x} y={H - 2} fontSize="8" fill="#475569" textAnchor="middle">
        {marks[marks.length - 1].date.slice(0, 7)}
      </text>

      {/* Price label at peak dot */}
      {(() => {
        const peak = [...points].sort((a, b) => b.m.sharePrice - a.m.sharePrice)[0];
        return (
          <text
            x={peak.x} y={peak.y - 7}
            fontSize="8" fill="#e2e8f0" textAnchor="middle"
            fontWeight="600"
          >
            {peak.m.sharePriceDisplay}
          </text>
        );
      })()}
    </svg>
  );
}

function ValuationTimelineCard({ card }: { card: ValuationCard }) {
  if (card.timelines.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {card.timelines.map((tl) => (
        <ValuationTimelineItem key={`${tl.company}-${tl.round}`} tl={tl} />
      ))}
    </div>
  );
}

function ValuationTimelineItem({ tl }: { tl: ValuationCardTimeline }) {
  const [showTable, setShowTable] = useState(false);
  const gainLoss = tl.currentUnrealisedGainLoss ?? 0;
  const isGain = gainLoss >= 0;

  return (
    <div className="rounded-xl border border-base-border bg-base-elevated overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-base-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-blue-400 flex-none" />
          <span className="text-slate-200 text-sm font-medium">{tl.company}</span>
          <span className="text-slate-500 text-xs">{tl.round}</span>
          {tl.isWrittenOff && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-950 text-red-400 border border-red-900/50">Written Off</span>
          )}
          {tl.isExited && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-900/50">Exited</span>
          )}
          {tl.hasDownRound && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-950/60 text-red-400 border border-red-900/40 flex items-center gap-1">
              <TrendingDown className="w-3 h-3" /> Down round
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs tabular-nums">
          <span className="text-slate-500">{tl.markCount} marks · {Math.round(tl.spanDays / 365 * 10) / 10}yr</span>
        </div>
      </div>

      {/* Sparkline */}
      {tl.marks.length >= 2 && (
        <div className="px-4 pt-3 pb-1">
          <ValuationSparkline
            marks={tl.marks}
            dealCurrency={tl.dealCurrency}
            entrySharePrice={tl.entrySharePrice}
          />
        </div>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-base-border border-t border-base-border">
        <div className="px-3 py-2.5">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Entry price</div>
          <div className="text-slate-300 text-xs tabular-nums font-medium">
            {tl.dealCurrency} {tl.entrySharePrice}
          </div>
          {tl.effectiveSharePrice !== tl.entrySharePrice && (
            <div className="text-slate-500 text-[10px]">
              Your price: {tl.dealCurrency} {tl.effectiveSharePrice}
            </div>
          )}
        </div>
        <div className="px-3 py-2.5">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Latest mark</div>
          <div className="text-slate-300 text-xs tabular-nums font-medium">
            {tl.latestSharePriceDisplay ?? "—"}
          </div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Your MOIC</div>
          <div className={clsx(
            "text-xs tabular-nums font-semibold",
            tl.latestMoic === null ? "text-slate-500"
              : tl.latestMoic >= 2 ? "text-emerald-400"
              : tl.latestMoic >= 1 ? "text-slate-200"
              : "text-red-400"
          )}>
            {tl.latestMoicDisplay}
          </div>
          {tl.peakMoic !== null && tl.peakMoic !== tl.latestMoic && (
            <div className="text-slate-600 text-[10px]">Peak: {tl.peakMoicDisplay} ({tl.peakMoicDate?.slice(0,7)})</div>
          )}
        </div>
        <div className="px-3 py-2.5">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Gain / loss</div>
          <div className={clsx(
            "text-xs tabular-nums font-medium",
            isGain ? "text-emerald-400" : "text-red-400"
          )}>
            {tl.currentUnrealisedGainLossDisplay ?? "—"}
          </div>
        </div>
      </div>

      {/* Flags */}
      {(tl.isSparse || tl.hasDownRound || tl.isWrittenOff) && (
        <div className="px-4 py-2.5 border-t border-base-border space-y-1.5">
          {tl.isSparse && (
            <div className="flex items-start gap-1.5 text-[11px] text-amber-400/80">
              <Info className="w-3 h-3 flex-none mt-0.5" />
              <span>Infrequent valuation cadence — longest gap: {Math.round(tl.maxGapDays / 30)} months. Value between marks is unobservable.</span>
            </div>
          )}
          {tl.hasDownRound && tl.downRounds.map((dr) => (
            <div key={dr.date} className="flex items-start gap-1.5 text-[11px] text-red-400/80">
              <TrendingDown className="w-3 h-3 flex-none mt-0.5" />
              <span>Down round on {dr.date}: {tl.dealCurrency} {dr.fromPrice} → {dr.toPrice} (−{dr.pctDrop.toFixed(1)}%)</span>
            </div>
          ))}
          {tl.isWrittenOff && (
            <div className="flex items-start gap-1.5 text-[11px] text-red-400/80">
              <AlertTriangle className="w-3 h-3 flex-none mt-0.5" />
              <span>Position written off — current value is zero.</span>
            </div>
          )}
        </div>
      )}

      {/* Toggle mark table */}
      <div className="border-t border-base-border">
        <button
          onClick={() => setShowTable((s) => !s)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-base-surface/50 transition-colors"
        >
          <span>Valuation marks ({tl.markCount})</span>
          <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform", showTable && "rotate-180")} />
        </button>

        {showTable && (
          <div className="px-4 pb-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-600 border-b border-base-border">
                  <th className="text-left py-1.5 pr-3 font-normal">Date</th>
                  <th className="text-left py-1.5 pr-3 font-normal">Source</th>
                  <th className="text-right py-1.5 pr-3 font-normal">Share price</th>
                  <th className="text-right py-1.5 pr-3 font-normal">vs entry</th>
                  <th className="text-right py-1.5 pr-3 font-normal">Chg</th>
                  <th className="text-right py-1.5 pr-3 font-normal">Your value</th>
                  <th className="text-right py-1.5 font-normal">MOIC</th>
                </tr>
              </thead>
              <tbody>
                {tl.marks.map((m) => (
                  <tr
                    key={m.valuationId}
                    className={clsx(
                      "border-b border-base-border/50 last:border-0",
                      m.isDownRound && "bg-red-950/10"
                    )}
                  >
                    <td className="py-1.5 pr-3 text-slate-400 tabular-nums">{m.date}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className="text-[10px] px-1 py-0.5 rounded"
                        style={{
                          color: MARK_COLORS[m.markSource] ?? "#64748b",
                          background: (MARK_COLORS[m.markSource] ?? "#64748b") + "1a",
                        }}
                      >
                        {m.markSource}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-300">{m.sharePriceDisplay}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">{m.multipleVsEntry}×</td>
                    <td className={clsx(
                      "py-1.5 pr-3 text-right tabular-nums",
                      m.priceChangePct === null ? "text-slate-600"
                        : m.isDownRound ? "text-red-400"
                        : m.priceChangePct > 0 ? "text-emerald-400"
                        : "text-slate-400"
                    )}>
                      {m.priceChangePct === null
                        ? "—"
                        : `${m.priceChangePct >= 0 ? "+" : ""}${m.priceChangePct.toFixed(1)}%`}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-300">{m.investorValueDisplay}</td>
                    <td className={clsx(
                      "py-1.5 text-right tabular-nums font-medium",
                      m.moicAtMark === null ? "text-slate-600"
                        : m.moicAtMark >= 2 ? "text-emerald-400"
                        : m.moicAtMark >= 1 ? "text-slate-300"
                        : "text-red-400"
                    )}>
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

// ─── Fee Schedule Row ─────────────────────────────────────────────────────────

function FeeScheduleRow({ line, reportingCurrency }: { line: FeeCardScheduleLine; reportingCurrency: string }) {
  const hasChange = line.discounted || (line.standardDisplay !== line.effectiveDisplay);

  return (
    <div className={clsx(
      "grid grid-cols-[1fr_auto_auto] gap-2 items-center text-xs py-1.5 px-2 rounded-lg",
      line.discounted ? "bg-emerald-950/20" : "bg-transparent"
    )}>
      {/* Fee type + basis */}
      <div>
        <span className={clsx("font-medium", line.discounted ? "text-slate-200" : "text-slate-400")}>
          {line.feeType}
        </span>
        <span className="text-slate-600 ml-1.5">{line.basis}</span>
      </div>

      {/* Standard → Effective */}
      <div className="flex items-center gap-1.5 tabular-nums">
        {hasChange ? (
          <>
            <span className="text-slate-600 line-through">{line.standardDisplay}</span>
            <span className="text-slate-400">→</span>
            <span className={line.discounted ? "text-emerald-400 font-medium" : "text-slate-300"}>
              {line.effectiveDisplay}
            </span>
          </>
        ) : (
          <span className="text-slate-400">{line.effectiveDisplay}</span>
        )}
      </div>

      {/* Saving or undeterminable tag */}
      <div className="text-right min-w-[80px]">
        {line.undeterminable ? (
          <span className="text-slate-600 italic">at exit</span>
        ) : line.savingDisplay ? (
          <div>
            <span className="text-emerald-400 font-medium">{line.savingDisplay}</span>
            {line.savingRptDisplay && (
              <div className="text-emerald-600 text-[10px]">≈ {line.savingRptDisplay} / period</div>
            )}
          </div>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-none w-7 h-7 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center">
        <span className="text-accent font-bold text-xs">E</span>
      </div>
      <div className="flex items-center gap-1 pt-2">
        <div className="w-1.5 h-1.5 rounded-full bg-accent loading-dot" />
        <div className="w-1.5 h-1.5 rounded-full bg-accent loading-dot" />
        <div className="w-1.5 h-1.5 rounded-full bg-accent loading-dot" />
      </div>
    </div>
  );
}
