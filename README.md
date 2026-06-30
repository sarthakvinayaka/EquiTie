# EquiTie Investor Assistant

A personalised AI assistant for private equity investors. Answers questions about portfolio performance, position detail, fee schedules, obligations, distributions, and account history — grounded entirely in the investor's own CSV dataset, with deterministic financial calculations and investor-scoped data access enforced at every layer.

Built as a 2–3 hour senior engineering case study.

---

## What it does

An investor logs in and can ask natural-language questions:

- *"What's my portfolio worth and what's my MOIC?"*
- *"Walk me through my Forgecraft position across all three rounds."*
- *"Do I have any overdue fees or upcoming capital calls?"*
- *"What's my net cash flow since inception?"*
- *"Has Inferna AI had any down-rounds?"*
- *"What fees have I paid and do I have a negotiated discount?"*

The assistant classifies the intent, computes the answer entirely in TypeScript from the CSV dataset, then passes pre-computed JSON to the LLM for phrasing only. Every answer includes a source evidence panel showing the exact rows used. The app works fully without an API key — all numbers remain correct, only the prose is template-driven.

---

## Why this approach for a 2–3 hour build

The fastest path to a *credible* finance assistant is to invert the usual prototype instinct: **keep the LLM out of the math entirely.**

LLMs hallucinate numbers. A user trusting an incorrect MOIC or fee total is a worse outcome than a correctly-computed answer with plain templated phrasing. So the design decision was:

1. Write deterministic TypeScript for every financial calculation
2. Use the LLM solely to phrase a pre-computed JSON object into readable prose
3. Make the fallback (no API key) produce identical numbers with less elegant phrasing

This makes the prototype verifiable, auditable, and safe to demo without an OpenAI key — which matters for a case study where the reviewer may not have access to the right environment.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  10. UI / Presentation                                                      │
│  src/components/InvestorPortal.tsx                                          │
│  Chat panel · Portfolio snapshot · Evidence panel · Statement ledger        │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ fetch (JSON)
┌──────────────────────────────────▼──────────────────────────────────────────┐
│  9. HTTP / Orchestrator                                                     │
│  src/app/api/chat/route.ts        (main chat endpoint)                      │
│  src/app/api/snapshot/[id]/route  (sidebar snapshot)                        │
│  Enforces the layer order below. No business logic lives here.              │
└───┬─────────────┬─────────────────────────────────────────────────────────── ┘
    │             │
    ▼             ▼
┌────────┐  ┌──────────────────────────────────────────────────────────────┐
│ L3     │  │  8. Query Router                                             │
│ Access │  │  src/lib/query/router.ts                                     │
│ Bound- │  │  Regex + keyword classifier — no ML, no LLM.                │
│ ary    │  │  Returns: intent + entities (company, round) + confidence    │
└───┬────┘  └──────────────────────────────────────────┬───────────────────┘
    │                                                  │
    └──────────────────────┬───────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  7. Policy / Guardrail Layer                                                │
│  src/lib/policy/engine.ts · guards.ts · context.ts · logger.ts             │
│                                                                             │
│  G1  investor exists?            pre-computation, blocks everything else   │
│  G2  no cross-investor ref?      pre-computation                           │
│  G3  no external data request?   pre-computation                           │
│  G4  ambiguous entity?           post-intent (needs entity extraction)     │
│  G5  company in portfolio?       post-intent                               │
│  G6  evidence integrity?         post-computation (belt-and-suspenders)    │
│                                                                             │
│  InvestorContext is frozen after G1. Immutable for all downstream use.     │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ investor-scoped only
┌────────────────────────────────────▼────────────────────────────────────────┐
│  6. Finance Engine                                                          │
│  src/lib/engine/*.ts                                                        │
│                                                                             │
│  getInvestorPortfolioOverview()    positions, totals, MOIC                 │
│  getInvestorPositionByCompany()    single or multi-round company detail     │
│  getInvestorUpcomingObligations()  capital calls + overdue fees             │
│  getInvestorDistributions()        exit proceeds, net of carry              │
│  getInvestorFeeBreakdown()         per-deal schedule, discounts             │
│  getInvestorValuationTimeline()    mark history, down-round detection       │
│  getInvestorStatementSummary()     cash-flow ledger, grouped timeline       │
│  getInvestorSectorConcentration()  HHI, sector buckets                      │
│  getInvestorProfile()              sophistication, personalization          │
│                                                                             │
│  All functions return EngineResult<T>:                                      │
│    { result: T, evidence: EvidenceItem[], assumptions: string[],           │
│      warnings: string[] }                                                   │
│                                                                             │
│  100% TypeScript arithmetic. Zero LLM involvement.                         │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ typed domain objects
┌────────────────────────────────────▼────────────────────────────────────────┐
│  5. Domain Model / Business Rules                                           │
│  src/lib/domain/*.ts · src/lib/engine/math.ts                              │
│  Portfolio math, FX bridge (USD pivot), MOIC formula, HHI, obligations    │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ raw indexed Maps
┌────────────────────────────────────▼────────────────────────────────────────┐
│  4. Data Access                                                             │
│  src/lib/data/loader.ts   getDatabase() singleton + index builder          │
│  src/lib/data/parser.ts   CSV → typed rows + per-row provenance (RowRef)   │
│  src/lib/data/validate.ts FK checks, anomaly detection                     │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ file I/O (startup only)
┌────────────────────────────────────▼────────────────────────────────────────┐
│  3. Ingestion / Storage  ·  data/*.csv  (10 files, read once at startup)   │
└─────────────────────────────────────────────────────────────────────────────┘

         ┌───────────────────────────────────┐
         │  2. Answer Composer               │
         │  src/lib/composer/index.ts        │
         │  src/lib/composer/fallback.ts     │
         │  src/lib/composer/cards.ts        │
         │                                   │
         │  Calls GPT-4o with pre-computed   │
         │  JSON. LLM phrases the answer —   │
         │  never computes it.               │
         │  Falls back to deterministic      │
         │  templates if no API key.         │
         └───────────────────────────────────┘

         ┌───────────────────────────────────┐
         │  1. Evaluation / Verification     │
         │  src/lib/engine/__tests__/        │
         │  src/lib/policy/__tests__/        │
         │  src/lib/query/__tests__/         │
         │  src/lib/composer/__tests__/      │
         │                                   │
         │  378 deterministic tests.         │
         │  Evidence integrity check         │
         │  (G6) runs at request time.       │
         └───────────────────────────────────┘
```

---

## Data flow (chat request)

```
1  User message arrives at POST /api/chat
2  Policy G1: investor exists in DB?                    → 404 if not
3  Policy G2: message references another investor?      → blocked
4  Policy G3: message requests external market data?    → blocked
5  Router: classify intent + extract company/round
6  Policy G4: extracted company is ambiguous?           → ask for clarification
7  Policy G5: company is in this investor's portfolio?  → 404 if not
8  Finance engine: deterministic computation → EngineResult<T>
9  Policy G6: evidence rows all belong to this investor? → assert
10 Composer: GPT-4o receives pre-computed JSON, returns narrative prose
   (or fallback templates if no API key)
11 Card builder: structured UI objects from engine result
12 Response: { answer, intent, evidence[], card?, warnings[] }
13 UI: renders chat bubble + evidence panel + optional card
```

Every policy check writes a structured entry to an in-memory audit ring buffer (`/api/policy-log`).

---

## Why the code owns the financial calculations

**LLMs are not calculators.** They approximate. A model that confidently returns `2.6×` when the real MOIC is `2.84×` is worse than a template that shows the exact number.

The contract in this system:

| Responsibility | Owner |
|---|---|
| MOIC, FX conversion, fee totals, net cash flow | TypeScript engine |
| Multi-round aggregation, weighted average price | TypeScript engine |
| Down-round detection, HHI, sector concentration | TypeScript engine |
| Natural language phrasing, tone adaptation | GPT-4o (phrasing only) |
| Jargon explanation, glossary definitions | GPT-4o |
| Fallback when no API key | Deterministic templates |

The LLM receives a JSON payload containing pre-computed scalars (e.g., `"portfolioMoic": 2.6009`, `"totalContributedRpt": 168592.59`). It is instructed via system prompt to use those values verbatim and never re-derive them. All numbers in the response are therefore deterministic and auditable.

---

## Data model

10 CSV files, parsed once at startup into an indexed in-memory database:

| File | Records | Notes |
|---|---|---|
| `investors.csv` | 112 | reporting currency, KYC, tech savviness |
| `portfolio_companies.csv` | 16 | sector, HQ country, status |
| `deals.csv` | 21 | round, instrument, standard fee schedule |
| `allocations.csv` | 550 | per-investor commitment, price discount, units |
| `valuations.csv` | 55 | mark history per deal, mark source |
| `capital_calls.csv` | 655 | call schedule, status |
| `fees.csv` | 1,401 | fee lines with status (Paid / Upcoming / Overdue) |
| `distributions.csv` | 34 | gross/net/carry per exit event |
| `statement_lines.csv` | 1,390 | full cash-flow ledger per investor |
| `fx_rates.csv` | 4 | static snapshot 2026-06-25 (USD, GBP, EUR, AED) |

FX conversions use USD as a bridge: `amount × fromToUsd / toToUsd`. This keeps conversion consistent even between two non-USD currencies.

---

## Personalization

Each investor gets an adaptive answer style derived from observable signals in the dataset — no manual labelling.

**Sophistication level** (`Emerging` / `Established` / `Experienced`):

```
High tech_savviness OR dealCount ≥ 5    → Experienced
Low tech_savviness OR dealCount ≤ 1
  OR age ≥ 65                           → Emerging
Otherwise                               → Established
```

**Effect on answers:**

| Dimension | Emerging | Established | Experienced |
|---|---|---|---|
| Answer style | Explanatory, conclusion first | Balanced | Concise, data-dense |
| Jargon | Defined inline (MOIC, carry, HHI) | Brief definition | Assumed known |
| Tables | Simplified | Standard | Full detail |
| Warnings | Plain language | Standard | Technical |

The personalization profile (`PersonalizationProfile`) is built once per request and passed through the entire stack — engine, composer, and fallback templates all respect it.

---

## Verification and grounding

Every answer is grounded in explicit source rows. The evidence panel in the UI shows exactly which CSV records were used (allocation ID, valuation ID, fee ID, etc.) with the field values that drove the calculation.

**Post-computation integrity check (G6):** after the engine runs, `guardEvidenceIntegrity` verifies that every evidence row's primary key belongs to the scoped investor. If any row belongs to a different investor, the request is blocked and logged. This is belt-and-suspenders — the engine already scopes to `investorId` — but the check makes it explicitly auditable.

**Test harness** — 378 deterministic tests, 9 suites, runs in under 1 second:

| Suite | What it proves |
|---|---|
| `calculations.test.ts` | Pure arithmetic: MOIC, FX, HHI, weighted avg price |
| `engine.test.ts` | All 9 engine functions with real DB (no mocks) |
| `fees.test.ts` | 5 fee scenarios: discount, no discount, pending, perf fee |
| `valuations.test.ts` | Down-round detection, peak MOIC, mark source tracking |
| `golden.test.ts` | Pinned values from CSV: INV001 totals, Forgecraft MOIC range, INV009 fee discount rates |
| `isolation.test.ts` | Scoped DB integrity, cross-investor evidence checks |
| `red-team.test.ts` | Injection attacks, aggregation attacks, external data requests |
| `router.test.ts` | 30 routing cases across all 10 intents |
| `fallback.test.ts` | Fallback mode: all intents produce valid output with null data, idempotency, error narrative |

```bash
npm test          # all suites
npm run verify    # all suites, verbose (per-test names)
```

---

## Guardrails and policy enforcement

Six guards run in a fixed order on every request. Each returns `{ allowed: boolean, reason?: string }`.

| Guard | Trigger condition | Response |
|---|---|---|
| G1 `guardInvestorExists` | `investorId` not in DB | 403 |
| G2 `guardNoCrossInvestorRequest` | message contains another investor name or "other investors" | 403 blocked |
| G3 `guardNoExternalDataRequest` | message asks for live prices, Bloomberg, market data | 400 clarification |
| G4 `guardAmbiguousEntity` | extracted company matches 0 or 2+ names | 200 clarification |
| G5 `guardCompanyInPortfolio` | extracted company not in this investor's allocations | 404 |
| G6 `guardEvidenceIntegrity` | any evidence row's FK belongs to a different investor | 500 (assertion fail) |

All policy decisions are written to an in-memory ring buffer (`PolicyLogEntry`) and exposed at `/api/policy-log` for audit. Messages passing through the logger are redacted — personal names and amounts are replaced with `[REDACTED]` before logging.

The router also classifies `unsupported_or_ambiguous` intent, which triggers a structured clarification response rather than a blank error.

---

## Security and investor isolation

Investor isolation is enforced at three independent levels:

1. **Data layer** — `getDatabase()` builds per-investor index maps (`allocationsByInvestor`, `feesByInvestor`, etc.). Every engine function starts from `db.allocationsByInvestor.get(investorId)` and never accesses the full allocations map directly.

2. **Policy layer** — G1–G3 block cross-investor references before any computation runs. G6 checks post-computation evidence.

3. **Evidence layer** — every `EvidenceItem` carries the source primary key. G6 joins those PKs back to the investor's allocation set. A scoped-DB integrity assertion (`assertScopedDbIntegrity`) is available in tests.

No investor's data is ever included in another investor's API response, prompt, or evidence panel. The LLM prompt is constructed from pre-computed data for the authenticated investor only — raw CSV rows are never passed to the model.

---

## Failure modes and UI handling

| Failure | Behaviour |
|---|---|
| No API key | Demo Mode banner shown; all answers use deterministic fallback templates; numbers are correct |
| LLM call fails / timeout | `composer/index.ts` catches the error, logs it, falls back to templates transparently |
| LLM returns malformed JSON | Fallback triggered; no error surfaced to user |
| Policy blocked (G1–G5) | Structured error message returned; clarification suggested where applicable |
| G6 evidence integrity failure | 500 error logged with full audit trail; no partial data returned |
| Unknown intent | `unsupported_or_ambiguous` → clarification prompt with suggested rephrasings |
| Company not in portfolio | 404 with plain-language explanation ("I don't see Acme in your portfolio") |
| Ambiguous company name | Clarification response listing the candidates |

Fallback mode is visible: a banner in the top bar reads "Demo Mode — LLM unavailable, answers are template-driven". The evidence panel still populates from the engine result, so source provenance is unaffected.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server components + API routes in one repo; Vercel-native |
| Language | TypeScript | Type-safe domain model across engine, policy, and UI |
| LLM | GPT-4o via `openai` SDK | Strong structured-output adherence; handles long JSON payloads well |
| CSV parsing | PapaParse | Fast, zero-dependency, runs in Node without a native layer |
| Styling | Tailwind CSS v3 | Rapid UI iteration without a component library |
| Icons | Lucide React | Consistent lightweight icons |
| Testing | Jest + ts-jest | Fast, first-class TypeScript, no build step required |
| Deployment | Vercel | `outputFileTracingIncludes` bundles `data/*.csv` into the function |

**Model usage note:** GPT-4o is called once per chat turn, only for narrative phrasing. Typical completion: 300–600 tokens. The system prompt injects pre-computed scalars and instructs the model to use them verbatim. No tool calls, no function calling, no streaming (returns complete JSON).

---

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.local.example .env.local
# Add your key: OPENAI_API_KEY=sk-...
# The app runs fully without a key (Demo Mode)

# 3. Start dev server
npm run dev
# → http://localhost:3000

# 4. Run the test suite
npm test
```

The default investor on load is **Idris Olawale (INV001, GBP)**. Use the investor selector in the top bar to switch between all 112 investors.

---

## Deployment

The project is Vercel-ready. No external database, no environment setup beyond the optional API key.

```bash
# Deploy via Vercel CLI
npx vercel --prod

# Or connect the GitHub repo in the Vercel dashboard and set:
#   OPENAI_API_KEY  (optional)
```

`next.config.ts` includes:

```ts
outputFileTracingIncludes: {
  "**": ["./data/**/*"],
}
```

This bundles all 10 CSV files into the serverless function so `getDatabase()` can read them at runtime without a separate data store.

Cold start latency: ~200ms for CSV parsing on first request per worker. Subsequent requests hit the in-memory singleton instantly.

---

## Example supported questions

**Portfolio overview**
- "What's my portfolio worth?"
- "What's my MOIC across all investments?"
- "How many active positions do I have?"

**Position detail**
- "Tell me about my Forgecraft Robotics position"
- "What's my return on Inferna AI?"
- "How many rounds of Forgecraft have I participated in?"

**Fees and discounts**
- "What fees have I paid?"
- "Do I have a negotiated fee discount?"
- "What's my structuring fee on the Mendwell deal?"

**Obligations**
- "Do I have any overdue fees?"
- "What capital calls are coming up?"

**Distributions**
- "Have I received any distributions?"
- "What's the net carry on my Forgecraft exit?"

**Account statement**
- "Show me my account statement"
- "What's my net cash flow since I started investing?"

**Valuation history**
- "Has Forgecraft had any down-rounds?"
- "What was the peak valuation mark on Inferna AI?"

**Glossary**
- "What is MOIC?"
- "Explain what a capital call is"

---

## Known limitations

- **Static FX rates** — rates are fixed at the dataset snapshot (2026-06-25). Live FX would require a rates API and cache layer.
- **No authentication** — `investorId` comes from the URL/body and is trusted. Production would gate on session identity (JWT or cookie).
- **Single-turn only** — no multi-turn memory. Follow-up questions that rely on prior context ("and what about Series B?") require the user to re-state the company.
- **No search across companies** — "which of my investments is in biotech?" works via portfolio overview, not a dedicated search intent.
- **Statement fees are realised only** — the statement ledger shows only lines in `statement_lines.csv`. Upcoming management fees visible in the fee schedule do not appear in the statement until paid.
- **Keyword router limits** — very short or unusually phrased queries may fall to `unsupported_or_ambiguous`. A semantic fallback (embedding similarity) would improve coverage.
- **In-memory audit log** — the policy log is a ring buffer in process memory. It resets on cold start and is not durable.

---

## What I would build next

**In the next sprint:**

1. **Multi-turn context** — carry extracted entities (`companyName`, `round`, `intent`) across turns so follow-up questions work naturally.
2. **Live FX integration** — swap the static rates for a rates API with a 1-hour cache. Amounts would update on every load.
3. **Session authentication** — replace the investor selector with a real auth layer (Clerk or NextAuth), mapping session identity to `investorId` server-side.
4. **Streaming responses** — replace the single JSON response with Vercel AI SDK streaming so the chat panel feels instant.

**Longer term:**

5. **Semantic intent routing** — supplement the keyword router with a small embedding model for better coverage on unusual phrasings without adding LLM latency.
6. **Audit log persistence** — write policy log entries to a database (PlanetScale or Supabase) for compliance-grade audit trails.
7. **PDF / XLSX export** — the account statement and portfolio snapshot already have all the data; adding a PDF renderer (React-PDF or Puppeteer) is straightforward.
8. **What-if modelling** — "what would my MOIC be if Forgecraft exits at £20?" The engine already has the units and FX logic; the UI just needs a slider.
9. **Push notifications** — trigger alerts on new capital calls, overdue fees, or valuation marks using a webhook from the data ingestion layer.
10. **Data ingestion pipeline** — replace static CSVs with a scheduled ingestion job that pulls from the fund administrator's API and refreshes the database.
