/**
 * Developer diagnostics page — dev-only, not linked from the main app.
 * Visit /admin/diagnostics to inspect dataset health.
 *
 * Blocked in production (returns 403-equivalent static page).
 */

import { buildDiagnostics } from "@/lib/data/diagnostics";
import type { DiagnosticsSummary, TableStats } from "@/lib/data/diagnostics";
import type { JoinCheck, Anomaly } from "@/lib/data/validate";
import type { ParseIssue } from "@/lib/data/parser";

export const dynamic = "force-dynamic"; // always fresh, no caching

// ─── Sub-components (all pure functions — no interactivity needed) ─────────────

function Badge({
  n,
  warn,
  err,
}: {
  n: number;
  warn?: boolean;
  err?: boolean;
}) {
  const cls = n === 0
    ? "bg-emerald-900/50 text-emerald-300"
    : err
    ? "bg-red-900/50 text-red-300"
    : warn
    ? "bg-amber-900/50 text-amber-300"
    : "bg-zinc-700 text-zinc-300";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono ${cls}`}>
      {n}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-zinc-100 mb-4 pb-2 border-b border-zinc-700">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TableStatsSection({ stats }: { stats: TableStats[] }) {
  return (
    <Section title="CSV Row Counts">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-400 border-b border-zinc-700">
              <th className="py-2 pr-4">File</th>
              <th className="py-2 pr-4 text-right">Rows</th>
              <th className="py-2 pr-4 text-right">Columns</th>
              <th className="py-2 pr-4 text-right">Parse Errors</th>
              <th className="py-2 text-right">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.file} className="border-b border-zinc-800 hover:bg-zinc-800/40">
                <td className="py-2 pr-4 font-mono text-zinc-200">{s.file}</td>
                <td className="py-2 pr-4 text-right font-mono text-zinc-300">{s.rowCount}</td>
                <td className="py-2 pr-4 text-right text-zinc-400">{s.columnCount}</td>
                <td className="py-2 pr-4 text-right">
                  <Badge n={s.parseErrors} err={s.parseErrors > 0} />
                </td>
                <td className="py-2 text-right">
                  <Badge n={s.parseWarnings} warn={s.parseWarnings > 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function JoinChecksSection({ checks }: { checks: JoinCheck[] }) {
  return (
    <Section title="FK Join Coverage">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-400 border-b border-zinc-700">
              <th className="py-2 pr-4">Relationship</th>
              <th className="py-2 pr-4 text-right">Total</th>
              <th className="py-2 pr-4 text-right">Matched</th>
              <th className="py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c, i) => {
              const ok = c.dangling.length === 0;
              return (
                <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/40">
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-300">{c.label}</td>
                  <td className="py-2 pr-4 text-right font-mono text-zinc-400">{c.total}</td>
                  <td className="py-2 pr-4 text-right font-mono text-zinc-300">{c.matched}</td>
                  <td className="py-2 text-right">
                    {ok ? (
                      <span className="text-emerald-400 text-xs font-semibold">PASS</span>
                    ) : (
                      <span className="text-red-400 text-xs font-semibold">
                        FAIL ({c.dangling.length} dangling)
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function AnomaliesSection({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) {
    return (
      <Section title="Data Anomalies">
        <p className="text-emerald-400 text-sm">No anomalies detected.</p>
      </Section>
    );
  }

  return (
    <Section title={`Data Anomalies (${anomalies.length})`}>
      <div className="space-y-3">
        {anomalies.map((a, i) => (
          <div key={i} className="rounded-lg border border-amber-800/40 bg-amber-900/10 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-amber-400">&#9651;</span>
              <div>
                <p className="text-sm text-zinc-200 font-medium">{a.description}</p>
                <p className="text-xs text-zinc-500 mt-1 font-mono">{a.type}</p>
                {a.ids.length > 0 && (
                  <p className="text-xs text-zinc-400 mt-2 font-mono break-all">
                    {a.ids.slice(0, 10).join(", ")}
                    {a.ids.length > 10 && ` … +${a.ids.length - 10} more`}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ParseIssuesSection({ issues }: { issues: ParseIssue[] }) {
  if (issues.length === 0) {
    return (
      <Section title="Parse Issues">
        <p className="text-emerald-400 text-sm">No parse issues — all CSVs loaded cleanly.</p>
      </Section>
    );
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warns  = issues.filter((i) => i.severity === "warn");

  return (
    <Section title={`Parse Issues (${errors.length} errors, ${warns.length} warnings)`}>
      <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
        {issues.map((issue, i) => (
          <div
            key={i}
            className={`rounded px-3 py-2 text-xs font-mono ${
              issue.severity === "error"
                ? "bg-red-900/20 border border-red-800/40 text-red-300"
                : "bg-amber-900/10 border border-amber-800/30 text-amber-300"
            }`}
          >
            <span className="text-zinc-500">{issue.file}:{issue.rowIndex}</span>
            {" "}
            <span className="text-zinc-300">[{issue.field}]</span>
            {" "}
            {issue.message}
            {issue.value && (
              <span className="text-zinc-500"> (value: &quot;{issue.value}&quot;)</span>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
  if (process.env.NODE_ENV === "production") {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-400">Not available in production.</p>
      </div>
    );
  }

  let summary: DiagnosticsSummary;
  try {
    summary = buildDiagnostics();
  } catch (err) {
    return (
      <div className="min-h-screen bg-zinc-950 p-8">
        <h1 className="text-red-400 text-xl font-bold mb-4">Diagnostics failed to load</h1>
        <pre className="text-red-300 text-xs font-mono">
          {err instanceof Error ? err.stack ?? err.message : String(err)}
        </pre>
      </div>
    );
  }

  const { tableStats, parseIssues, validationReport, fxCoverage, multiRoundCompanies, investorCoverage } = summary;

  const totalErrors   = parseIssues.filter((i) => i.severity === "error").length;
  const totalWarnings = parseIssues.filter((i) => i.severity === "warn").length;
  const failedJoins   = validationReport.joinChecks.filter((j) => j.dangling.length > 0).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300">
      {/* Header */}
      <div className="border-b border-zinc-800 px-8 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">EquiTie Data Diagnostics</h1>
            <p className="text-xs text-zinc-500 mt-0.5">Dev only — not visible in production</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500">Generated</p>
            <p className="text-xs font-mono text-zinc-400">{summary.generatedAt}</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Total Investors", value: investorCoverage.totalInvestors },
            { label: "Parse Errors",    value: totalErrors,   warn: totalErrors > 0 },
            { label: "Parse Warnings",  value: totalWarnings, warn: totalWarnings > 0 },
            { label: "FK Failures",     value: failedJoins,   err:  failedJoins > 0 },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-500 mb-1">{card.label}</p>
              <p className={`text-2xl font-bold ${
                card.err && card.value > 0 ? "text-red-400" :
                card.warn && card.value > 0 ? "text-amber-400" :
                "text-zinc-100"
              }`}>
                {card.value}
              </p>
            </div>
          ))}
        </div>

        {/* Table stats */}
        <TableStatsSection stats={tableStats} />

        {/* FK checks */}
        <JoinChecksSection checks={validationReport.joinChecks} />

        {/* Anomalies */}
        <AnomaliesSection anomalies={validationReport.anomalies} />

        {/* Parse issues */}
        <ParseIssuesSection issues={parseIssues} />

        {/* FX coverage */}
        <Section title="FX Rate Coverage">
          <div className="flex flex-wrap gap-3">
            {fxCoverage.map((fx) => (
              <div key={fx.currency} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm">
                <p className="font-mono font-bold text-zinc-100">{fx.currency}</p>
                <p className="text-zinc-400 text-xs mt-0.5">1 {fx.currency} = {fx.toUsd.toFixed(4)} USD</p>
                <p className="text-zinc-600 text-xs">as of {fx.asOf}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Multi-round companies */}
        <Section title={`Multi-Round Companies (${multiRoundCompanies.length})`}>
          {multiRoundCompanies.length === 0 ? (
            <p className="text-zinc-500 text-sm">None</p>
          ) : (
            <div className="space-y-2">
              {multiRoundCompanies.map((c) => (
                <div key={c.companyId} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-zinc-100">{c.companyName}</span>
                    <span className="text-xs text-zinc-500 font-mono">{c.companyId}</span>
                    <span className="ml-auto text-xs text-zinc-400">{c.dealCount} rounds</span>
                  </div>
                  <p className="text-xs font-mono text-zinc-500 mt-1">{c.dealIds.join(", ")}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Investor coverage */}
        <Section title="Investor Coverage">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-500">With Allocations</p>
              <p className="text-xl font-bold text-zinc-100 mt-1">{investorCoverage.withAllocations}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-500">No Allocations</p>
              <p className={`text-xl font-bold mt-1 ${investorCoverage.withoutAllocations > 0 ? "text-amber-400" : "text-zinc-100"}`}>
                {investorCoverage.withoutAllocations}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-500 mb-2">By Tech Savviness</p>
              {Object.entries(investorCoverage.byTechSavviness).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-zinc-400">{k}</span>
                  <span className="font-mono text-zinc-200">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <p className="text-xs text-zinc-700 mt-6 text-center">
          EquiTie Investor Assistant — dev diagnostics — not for client distribution
        </p>
      </div>
    </div>
  );
}
