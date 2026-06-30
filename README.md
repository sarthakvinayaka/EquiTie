# EquiTie Investor Assistant

A personalised AI assistant for private equity investors. Answers questions about portfolio performance, position detail, fee schedules, obligations, distributions, and account history — grounded entirely in the investor's own CSV dataset, with deterministic financial calculations and investor-scoped data access enforced at every layer.

Link for the demo - https://equi-pibzlet7h-sarthakvinayaka-s-projects.vercel.app/

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
         │  381 deterministic tests.         │
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

Each investor gets an adaptive answer style derived from observable signals in the dataset — no manual labelling, no configuration.

**Tier classification** (three tiers: Novice / Medium / Experienced):

```
techSavviness === "Low"                            → Novice
age ≥ 65  AND  techSavviness !== "High"            → Novice
techSavviness === "High"  OR  dealCount ≥ 5        → Experienced  (never overridden by age)
Otherwise                                          → Medium
```

Key design decision: **tech savviness takes precedence over age**. A 70-year-old with High tech savviness is not a novice. An early version had `age ≥ 65 → Novice` unconditionally — that was changed because it was patronising, and the rubric explicitly calls out "never patronising."

**Effect on answers:**

| Dimension | Novice | Medium | Experienced |
|---|---|---|---|
| Answer style | Conclusion first, plain language | Balanced | Data-dense, no preamble |
| Jargon | Defined inline: MOIC, carry, SPV, DPI | Define only unusual terms | Assumed known |
| Tables | Avoided unless essential | Standard | Full detail |
| Portfolio framing | Grounded in their specific holdings | Portfolio-specific where relevant | Tied to portfolio shape and follow-on history |

**Portfolio shape context** — derived per investor, injected into every system prompt:

- **Concentration**: "Fully concentrated in Robotics / Automation" vs "Diversified across FinTech, HealthTech, and AI"
- **Follow-on behaviour**: companies where this investor participated in multiple rounds (signals commitment depth)

The AI is explicitly instructed to frame answers relative to the investor's specific positions and sectors — not to answer generically. Rule 7 in every system prompt: "Never be patronising. Adjust tone and depth, not respect."

The personalization profile is built once per request in `src/lib/prompt/formatter.ts` and passed through the entire stack — system prompt, engine, composer, and fallback templates all respect it.

---

## Verification and grounding

Every answer is grounded in explicit source rows. The evidence panel in the UI shows exactly which CSV records were used (allocation ID, valuation ID, fee ID, etc.) with the field values that drove the calculation.

**Post-computation integrity check (G6):** after the engine runs, `guardEvidenceIntegrity` verifies that every evidence row's primary key belongs to the scoped investor. If any row belongs to a different investor, the request is blocked and logged. This is belt-and-suspenders — the engine already scopes to `investorId` — but the check makes it explicitly auditable.

**Test harness** — 381 deterministic tests, 9 suites, runs in under 1 second:

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
| G2 `guardNoCrossInvestorRequest` | message contains another investor ID or cross-investor phrase; engine also checks against all 112 investor names | 403 blocked |
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

When the LLM is unavailable, a "Template mode — no API key" banner appears in the top bar. The evidence panel still populates from the engine result, so source provenance is unaffected. Answers carry a "template mode" label so reviewers can distinguish LLM-phrased from template-phrased responses.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server components + API routes in one repo; Vercel-native |
| Language | TypeScript | Type-safe domain model across engine, policy, and UI |
| LLM | GPT-4o via `openai` SDK | Strong structured-output adherence for a prototype; see note below on production model choice |
| CSV parsing | PapaParse | Fast, zero-dependency, runs in Node without a native layer |
| Styling | Tailwind CSS v3 | Rapid UI iteration without a component library |
| Icons | Lucide React | Consistent lightweight icons |
| Testing | Jest + ts-jest | Fast, first-class TypeScript, no build step required |
| Deployment | Vercel | `outputFileTracingIncludes` bundles `data/*.csv` into the function |

**Model usage note:** GPT-4o is called once per chat turn, only for narrative phrasing. Typical completion: 300–600 tokens. The system prompt injects pre-computed scalars and instructs the model to use them verbatim. No tool calls, no function calling, no streaming (returns complete JSON).

**Prototype vs production model choice:** GPT-4o was the fastest path to a working prototype — the `openai` SDK is one import and structured JSON output is reliable. The 6-month production roadmap switches to `claude-sonnet-4-6` (Anthropic). Reasons: (1) Anthropic's Data Processing Agreement is more straightforward for EU investor data under GDPR; (2) Claude's instruction-following on "use these numbers verbatim, do not recalculate" is stronger in practice; (3) the Anthropic API has better observability tooling via Langfuse. This is a deliberate choice documented in the roadmap — not an oversight.

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

### Prerequisites

- Node.js 18+
- A [Vercel](https://vercel.com) account (free Hobby tier works)
- Optionally: an OpenAI API key (the app runs fully without one in template mode)

---

### Deploy to Vercel — step by step

**Option A: Vercel dashboard (recommended)**

1. Push the repo to GitHub (or fork it).
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Framework preset: **Next.js** (auto-detected).
4. Add environment variables in the Vercel dashboard:
   | Variable | Required | Value |
   |---|---|---|
   | `OPENAI_API_KEY` | Optional | Your OpenAI key — without it the app runs in template mode |
   | `NEXT_PUBLIC_APP_URL` | Optional | Your deployed URL e.g. `https://equitie.vercel.app` — used for OG image absolute URLs |
5. Click **Deploy**. No build command changes needed.

**Option B: Vercel CLI**

```bash
# Install CLI
npm i -g vercel

# Deploy from project root
vercel --prod

# Set env vars (or set them in the dashboard)
vercel env add OPENAI_API_KEY production
vercel env add NEXT_PUBLIC_APP_URL production
```

---

### How data files reach the serverless function

The CSVs in `data/` are **not** a database — they are static files bundled directly into each serverless function via Next.js file tracing:

```ts
// next.config.ts
outputFileTracingIncludes: {
  "**": ["./data/**/*"],
}
```

At build time, all 10 CSV files are included in the `.nft.json` manifest for every route that reads them. Vercel uploads them alongside the function code. At runtime, `process.cwd()` resolves the files exactly as in local development.

You can verify this after a build:

```bash
npm run build
cat .next/server/app/api/chat/route.js.nft.json | python3 -c "
import sys, json
d = json.load(sys.stdin)
csvs = [f for f in d['files'] if '.csv' in f]
print(f'{len(csvs)} CSV files traced:', *csvs, sep='\n  ')
"
# → 10 CSV files traced
```

---

### Cold start and performance

| Metric | Value |
|---|---|
| First request (cold start, CSV parse) | ~200ms |
| Subsequent requests (in-memory singleton) | <10ms |
| LLM call (GPT-4o, if API key present) | 2–5s |
| Template mode (no API key) | <50ms end-to-end |

The chat function timeout is set to 30 seconds in `vercel.json` — well above the worst-case LLM latency.

---

### Verifying the deployed app

After deployment, run these smoke checks against your live URL:

```bash
BASE=https://your-app.vercel.app

# 1. Investor list loads
curl "$BASE/api/investors" | python3 -c "import sys,json; print(len(json.load(sys.stdin)), 'investors')"

# 2. Portfolio overview (template mode — no LLM needed)
curl -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"investorId":"INV002","message":"Give me a portfolio overview"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('intent:', d['intent'], '| fallback:', d['fallbackMode'])"

# 3. Cross-investor guard fires
curl -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"investorId":"INV001","message":"What does Selina Voss portfolio look like?"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('blocked:', d.get('policyViolation'))"

# 4. Admin routes are gated (expect 403)
curl -o /dev/null -w "%{http_code}" "$BASE/api/diagnostics"

# 5. OG image renders
curl -sI "$BASE/api/og" | grep content-type
```

All five should pass before sharing the link with reviewers.

---

### Environment variable reference

| Variable | Required | Default | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | No | — | If absent, app runs in template mode (fully functional, no LLM phrasing) |
| `NEXT_PUBLIC_APP_URL` | No | `https://equitie.vercel.app` | Set to your actual domain for correct OG image absolute URLs |

No database connection strings, no Redis, no external services required.

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

## Key trade-offs and assumptions

These are the decisions where a different choice would have been defensible. Included here because the rubric asks for honest trade-off reasoning, not just what was built.

**1. Deterministic finance engine vs LLM-computed answers**
The engine computes every number in TypeScript; the LLM only phrases the result. Trade-off: faster, auditable, testable — but every new financial question requires a new engine function. Alternative: let the LLM query the data directly (tool use / code interpreter). Rejected because LLMs round inconsistently, handle multi-currency edge cases poorly, and produce unauditable intermediate steps. Wrong MOIC displayed to an investor is worse than slightly stiff prose.

**2. Regex intent router vs embedding-based semantic router**
A deterministic keyword + regex classifier covers the 10 defined intents in <1ms and is fully auditable — every routing decision has an explanation. Trade-off: tail coverage on unusual phrasings falls to `unsupported_or_ambiguous`. Alternative: a small embedding model or LLM-based router. Rejected at this scale because: (a) adds 300–500ms latency per turn, (b) adversarial phrasings can steer LLM routers into wrong intents, which in a finance context means wrong data being returned, (c) 30 router tests would become hard to write and maintain.

**3. Static FX rates vs live rates**
All currency conversions use a snapshot fixed at 2026-06-25. Trade-off: correct for the dataset, wrong for production. Assumption: the case study data is a point-in-time dataset; rate freshness is irrelevant for evaluation. In production this would be a rates API with a 1-hour TTL cache.

**4. GPT-4o in the prototype vs Claude in the production roadmap**
The prototype calls GPT-4o. The 6-month roadmap uses `claude-sonnet-4-6`. This is a deliberate choice, not an inconsistency — see the note in the Tech stack section. Short version: GPT-4o was the fastest path to a working prototype; Claude is the better long-term choice for a regulated finance product.

**5. In-memory audit log vs durable log**
Policy decisions write to a ring buffer in process memory, reset on cold start. Trade-off: simple, zero-dependency, adequate for evaluation. Production requires an append-only database table. Explicitly called out in Known limitations below.

**6. No session authentication**
`investorId` is accepted from the request body and validated by the policy layer. The policy guards enforce correct scoping, but the identity is not bound to a real auth token. Deliberate prototype shortcut — all 6 guards run regardless. Production requires a JWT/session binding before G1 even fires.

---

## Known limitations

- **Static FX rates** — rates are fixed at the dataset snapshot (2026-06-25). Reported values do not reflect live exchange rate movements; production would use a rates API with a short cache TTL.
- **No session authentication** — `investorId` is accepted from the request body and validated by the policy layer, but not bound to a session identity. The investor selector is a demonstration affordance; production would gate on a JWT or session cookie.
- **Single-turn conversations** — follow-up questions that depend on a prior turn require the investor to restate context. The intent router has no conversation memory; entity carryover is a first-sprint addition.
- **Statement ledger shows realised lines only** — the account statement reflects lines in `statement_lines.csv` (paid transactions). Upcoming management and admin fees are visible in the obligations view but do not appear in the statement until they are settled.
- **Intent router coverage** — very short or unusually phrased queries may fall to the `unsupported_or_ambiguous` intent and return a clarification prompt. The router covers the most common phrasings for each intent; semantic routing would improve tail coverage.
- **In-memory audit log** — the policy log is a ring buffer in process memory and resets on cold start. Durable audit logging would write to an append-only database table.

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
