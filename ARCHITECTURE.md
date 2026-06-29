# EquiTie — System Architecture

This document describes the deliberate layer structure of the EquiTie investor portal.
Every chat request and snapshot load follows this exact path — no shortcuts.

---

## Layer Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 10 · UI / Presentation                                               │
│  src/components/InvestorPortal.tsx                                          │
│  Renders chat, portfolio cards, statement ledger, valuation timeline.       │
│  No business logic — only display and user interaction.                     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTP (fetch)
┌───────────────────────────────▼─────────────────────────────────────────────┐
│  Layer 9 · HTTP Transport                                                   │
│  src/app/api/chat/route.ts          (main orchestrator)                     │
│  src/app/api/snapshot/[id]/route.ts (dashboard snapshot)                    │
│  src/app/api/investors/route.ts     (investor list)                         │
│  src/app/api/policy-log/route.ts    (dev audit log)                         │
│  src/app/api/diagnostics/route.ts   (data quality)                         │
│  Enforces layer order. Returns serialised JSON only.                        │
└──┬──────────┬──────────┬────────────────────────────────────────────────────┘
   │          │          │
   ▼          ▼          ▼
┌──────┐  ┌──────┐  ┌──────────────────────────────────────────────────────┐
│ L3   │  │ L4   │  │ Layer 8 · Query Router (Intent Classifier)           │
│Access│  │Policy│  │ src/lib/query/router.ts                              │
│Bound-│  │Guard │  │ Deterministic regex — no ML, no LLM.                │
│ary   │  │Layer │  │ Returns: intent + entities + confidence score.       │
└──┬───┘  └──┬───┘  └─────────────────────────────────┬────────────────────┘
   │          │                                        │
   └────┬─────┘                                        │
        ▼                                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 7 · Policy / Guardrail Layer                                         │
│  src/lib/policy/engine.ts   — orchestrates guards G1–G7                     │
│  src/lib/policy/guards.ts   — 6 pure guard functions (no side effects)      │
│  src/lib/policy/context.ts  — builds immutable InvestorContext              │
│  src/lib/policy/logger.ts   — in-memory audit ring buffer                   │
│                                                                             │
│  Guard chain (runs in this order):                                          │
│    G1  investor exists?          (pre-computation)                          │
│    G2  no cross-investor ref?    (pre-computation)                          │
│    G3  no external data request? (pre-computation)                          │
│    G4  ambiguous entity?         (post-intent)                              │
│    G5  company in portfolio?     (post-intent)                              │
│    G6  evidence integrity?       (post-computation, belt-and-suspenders)    │
│                                                                             │
│  InvestorContext is built after G1 and is immutable for all downstream use. │
│  Rule: no engine function runs until G1–G3 have passed.                    │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ investor-scoped only
┌───────────────────────────────▼─────────────────────────────────────────────┐
│  Layer 6 · Finance Engine                                                   │
│  src/lib/engine/*.ts                                                        │
│                                                                             │
│  All functions return EngineResult<T>:                                      │
│    { result: T, evidence: EvidenceItem[], assumptions: string[],            │
│      warnings: string[] }                                                   │
│                                                                             │
│  getInvestorPortfolioOverview()   — positions, totals, MOIC                │
│  getInvestorPositionByCompany()   — single-company detail                   │
│  getInvestorUpcomingObligations() — capital calls + fees                    │
│  getInvestorDistributions()       — exit proceeds, carry                    │
│  getInvestorFeeBreakdown()        — per-deal fee schedule, discounts        │
│  getInvestorValuationTimeline()   — mark history, down-rounds               │
│  getInvestorStatementSummary()    — account statement                       │
│  getInvestorSectorConcentration() — HHI, sector buckets                     │
│  getInvestorProfile()             — sophistication, personalization         │
│                                                                             │
│  All maths: 100% TypeScript, deterministic, no LLM.                        │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ typed domain shapes
┌───────────────────────────────▼─────────────────────────────────────────────┐
│  Layer 5 · Domain Model / Business Rules                                    │
│  src/lib/domain/portfolio.ts   — core portfolio computation                 │
│  src/lib/domain/positions.ts   — multi-round company aggregation            │
│  src/lib/domain/obligations.ts — overdue / upcoming flags                   │
│  src/lib/domain/distributions.ts                                            │
│  src/lib/domain/statement.ts   — cash-flow ledger                           │
│  src/lib/domain/valuations.ts  — mark analysis                              │
│  src/lib/domain/fx.ts          — FX bridge (USD pivot), format helpers      │
│  src/lib/domain/types.ts       — canonical shape definitions                │
│  src/lib/engine/math.ts        — pure arithmetic (MOIC, FX, HHI)           │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ raw indexed Maps
┌───────────────────────────────▼─────────────────────────────────────────────┐
│  Layer 4 · Data Access                                                      │
│  src/lib/data/loader.ts   — getDatabase() singleton; builds all indexes     │
│  src/lib/data/parser.ts   — CSV → typed rows + per-row provenance           │
│  src/lib/data/validate.ts — FK checks, anomaly detection                    │
│  src/lib/data/schema.ts   — column definitions, enum constraints            │
│  src/lib/data/types.ts    — raw CSV row shapes                              │
│                                                                             │
│  Database ships rowRefs + rawRows maps for any PK → source CSV row.        │
│  Evidence integrity (G6) uses these to verify computation provenance.       │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ file I/O (Node.js, startup only)
┌───────────────────────────────▼─────────────────────────────────────────────┐
│  Layer 3 · Ingestion / Storage                                              │
│  data/*.csv   (10 CSV files, read once at process start)                    │
│  FX rates, investors, deals, allocations, valuations, capital_calls,        │
│  fees, distributions, statement_lines, portfolio_companies                  │
└─────────────────────────────────────────────────────────────────────────────┘

                      ┌──────────────────────────────┐
                      │  Layer 2 · Answer Composer    │
                      │  src/lib/composer/index.ts    │
                      │  src/lib/composer/cards.ts    │
                      │  src/lib/composer/scaffold.ts │
                      │  src/lib/composer/prompt.ts   │
                      │  src/lib/composer/fallback.ts │
                      │  src/lib/composer/evidence.ts │
                      │  src/lib/composer/glossary.ts │
                      │                              │
                      │  LLM call (GPT-4o) for       │
                      │  narrative phrasing ONLY.    │
                      │  All numbers arrive pre-      │
                      │  computed from Layer 6.       │
                      │  Falls back to deterministic  │
                      │  templates if no API key.     │
                      └──────────────────────────────┘

                      ┌──────────────────────────────┐
                      │  Layer 1 · Evaluation /       │
                      │  Verification                 │
                      │  src/lib/policy/guards.ts     │
                      │    guardEvidenceIntegrity()   │
                      │  src/lib/policy/scoped.ts     │
                      │    assertScopedDbIntegrity()  │
                      │  src/lib/engine/__tests__/    │
                      │  src/lib/policy/__tests__/    │
                      │  src/lib/query/__tests__/     │
                      │                              │
                      │  Post-computation checks      │
                      │  confirm every evidence row   │
                      │  belongs to the scoped        │
                      │  investor before response.    │
                      └──────────────────────────────┘
```

---

## Key Invariants

| Invariant | Where enforced |
|-----------|---------------|
| Investor scoping before any finance computation | `policy/engine.ts` G1–G3 run first in `chat/route.ts` |
| No cross-investor data in engine results | `engine/*.ts` start from `db.allocationsByInvestor.get(investorId)` |
| LLM sees only pre-computed summaries, never raw rows | `composer/index.ts` receives only formatted scalars |
| Deterministic answers if LLM is unavailable | `composer/fallback.ts` — template per intent |
| Evidence provenance tracked for every PK | `data/loader.ts` — `rawRows` Map |
| All engine results carry `{result, evidence, assumptions, warnings}` | `engine/types.ts` `EngineResult<T>` |

---

## Data Flow (chat request)

```
User message
  → route.ts: parse body
  → policy/engine.ts: G1 investor exists, G2 no cross-investor, G3 no external data
  → query/router.ts: classify intent + extract entities
  → policy/engine.ts: G4 ambiguous entity, G5 company in portfolio
  → engine/*.ts: deterministic computation → EngineResult<T>
  → policy/engine.ts: G6 evidence integrity check
  → composer/index.ts: LLM narrative phrasing (or fallback)
  → composer/cards.ts: structured UI card (fee / valuation / statement)
  → route.ts: serialize → NextResponse.json
  → InvestorPortal.tsx: render
```
