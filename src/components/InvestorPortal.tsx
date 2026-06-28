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

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: QueryIntent;
  evidence?: EvidenceItem[];
  fallbackMode?: boolean;
  error?: boolean;
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasFallbackMode = messages.some((m) => m.fallbackMode);

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
        content: data.answer,
        intent: data.intent,
        evidence: data.evidence ?? [],
        fallbackMode: data.fallbackMode ?? false,
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
                onViewSources={(evidence) => {
                  setActiveEvidence(evidence);
                  setEvidencePanelOpen(true);
                }}
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
  onViewSources,
}: {
  message: AssistantMessage;
  onViewSources: (ev: EvidenceItem[]) => void;
}) {
  const isUser = message.role === "user";
  const hasEvidence = !isUser && (message.evidence?.length ?? 0) > 0;

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
          <div
            className={clsx(
              "prose-dark text-sm leading-relaxed",
              message.error && "text-red-400"
            )}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />

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
        </div>
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
