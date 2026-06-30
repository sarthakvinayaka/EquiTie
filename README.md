# EquiTie Investor Assistant

A personalised AI assistant for EquiTie investors — answers questions about portfolio value, positions, fees, obligations, distributions, and account history using only the provided CSV dataset.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set your Anthropic API key (optional — app works without it in demo mode)
cp .env.local.example .env.local
# Edit .env.local and add: ANTHROPIC_API_KEY=sk-ant-...

# 3. Run locally
npm run dev
# Open http://localhost:3000
```

The default investor is **Idris Olawale (INV001)**. Use the investor selector in the top bar to switch between all 112 investors in the dataset.

## Architecture

```
CSV files (data/*.csv)
  ↓ [src/lib/data/loader.ts]
  In-memory indexed database (module singleton, parsed once on first request)
  
  ↓ [src/lib/policy/access.ts]
  Investor isolation: validates investorId, every data access is gated here
  
  ↓ [src/lib/query/router.ts]
  Deterministic intent classifier: keyword + entity matching, no LLM
  
  ↓ [src/lib/domain/*.ts]
  Finance engine: deterministic computation, all FX conversions, portfolio math
  
  ↓ [src/lib/prompt/formatter.ts]
  System prompt builder: personalization rules injected based on profile
  
  ↓ [Anthropic API — claude-sonnet-4-6]
  Natural language phrasing only — never does the math
  
  ↓ [src/app/api/chat/route.ts]
  Returns: { answer, intent, evidence[] }
  
  ↓ [src/components/InvestorPortal.tsx]
  Three-panel UI: sidebar snapshot | chat | evidence panel
```

### Key design decisions

**Math is deterministic code, not LLM reasoning.** Every portfolio number — MOIC, current value, FX conversions, fee discounts — is computed in TypeScript before the model is called. The LLM receives pre-computed JSON and its sole job is phrasing.

**Investor isolation is enforced at the data layer.** Every domain function takes `investorId` as a parameter and is validated by `policy/access.ts`. The API route never hands one investor's data to another's request.

**Intent classification is keyword-based.** The router classifies message intent (portfolio overview, position detail, obligations, etc.) using pattern matching against the investor's actual company names and keyword patterns. Fast, deterministic, no extra API calls.

**Personalisation changes tone, not numbers.** The system prompt adapts based on `tech_savviness`, `age`, number of deals, and sector concentration. High-tech / experienced investors get concise, data-dense answers. Lower-tech / older investors get jargon explained, conclusions first.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v3 |
| CSV parsing | Papa Parse |
| AI model | OpenAI gpt-4o via openai SDK |
| Icons | Lucide React |
| Deployment | Vercel-ready (`outputFileTracingIncludes` bundles CSV files) |

## Model choice

`gpt-4o` — OpenAI's flagship multimodal model. Strong instruction-following for structured prompt + JSON data injection, good at adapting tone for personalisation. The prototype only uses the model for response phrasing (not data retrieval or computation), so ~300–600 token completions are sufficient for most answers.

## Fallback mode

If `ANTHROPIC_API_KEY` is not set, the app runs in **Demo Mode**: answers are formatted from structured templates (markdown tables and bullet lists). All numbers remain correct — only the natural language phrasing is absent. A banner in the top bar indicates demo mode is active.

## Assumptions

1. The investor is already authenticated — `investorId` is trusted as the logged-in user. In production this would come from a JWT/session cookie.
2. FX rates are static as of 2026-06-25 (`fx_rates.csv`). No live FX data is fetched.
3. Pending allocations (contributed = 0) are excluded from MOIC calculations and portfolio value, but shown in the holdings list.
4. For positions in exited or written-off deals, unrealised value is 0. Distributions capture the actual proceeds.
5. The admin fee is always treated as USD (matching the dataset schema), even for non-USD deals.

## Verification

All financial computations are **deterministic** — no LLM, no network, no randomness. The eval harness has 9 test suites covering 378 assertions, runnable in under 1 second:

```bash
npm test          # all suites, no output noise
npm run verify    # all suites, verbose (per-test names)
```

### Test suites

| Suite | File | What it proves | Type |
|---|---|---|---|
| Math / formulas | `engine/__tests__/calculations.test.ts` | MOIC, FX, HHI, weighted avg | [D] |
| Engine integration | `engine/__tests__/engine.test.ts` | all 9 engine functions end-to-end | [D] |
| Fee scenarios | `engine/__tests__/fees.test.ts` | 5 scenarios incl. negotiated discount | [D] |
| Valuation history | `engine/__tests__/valuations.test.ts` | down-rounds, peak MOIC | [D] |
| **Golden (pinned values)** | `engine/__tests__/golden.test.ts` | INV001 and INV009 expected totals | [D] |
| Investor isolation | `policy/__tests__/isolation.test.ts` | cross-investor scoping | [D] |
| Red-team / attacks | `policy/__tests__/red-team.test.ts` | injection, aggregation, ambiguity | [D] |
| Query routing | `query/__tests__/router.test.ts` | 30 routing cases across all intents | [D] |
| **Fallback mode** | `composer/__tests__/fallback.test.ts` | LLM-unavailable deterministic output | [D] |

**[D] Deterministic** — exact or tolerance-bounded values from `data/*.csv`. Breaks immediately if computation changes.
**[N] Narrative-quality** — structural checks on text output; exact wording may vary with LLM phrasing. A subset of the fallback suite.

### Key invariants under test

| Invariant | Suite |
|---|---|
| Investor A cannot see Investor B's data | `isolation.test.ts`, `golden.test.ts` § E |
| Prompt injection cannot leak cross-investor data | `red-team.test.ts` |
| Negotiated fee discounts applied at correct rates | `fees.test.ts`, `golden.test.ts` § D |
| Portfolio contributed = statement contributions (within 1 GBP) | `golden.test.ts` § B |
| Multi-round positions aggregate correctly, warnings emitted | `golden.test.ts` § C |
| Net cash flow = distributions − contributions − fees | `golden.test.ts` § A |
| Fallback answers are valid and idempotent without an API key | `fallback.test.ts` |
| All engine results carry `{result, evidence, assumptions, warnings}` | every suite |

### Pinned golden values (INV001, report date 2026-06-25)

| Metric | Source | Expected |
|---|---|---|
| Statement line count | `statement_lines.csv` | 6 |
| Total contributed | 227,600 USD ÷ 1.35 | ≈ 168,592 GBP |
| Total structuring fees paid | 3,000 USD ÷ 1.35 | ≈ 2,222 GBP |
| Total distributions | none in dataset | 0 GBP |
| Net cash flow | formula | < 0 (negative, net deployer) |
| Portfolio MOIC | latest marks, no distrib. | 2.4× – 3.0× |
| Forgecraft contributed (3 rounds) | 90,600 USD ÷ 1.35 | ≈ 67,111 GBP |
| Forgecraft company MOIC | aggregate latest marks | > 3.0× |

## Known limitations

- **No authentication**: the investor selector is a demo feature. Production would gate on session identity.
- **Single-turn streaming**: responses are returned as complete JSON, not streamed. Adding Vercel AI SDK streaming would improve perceived latency.
- **No persistent history**: chat history is held in client state and lost on refresh.
- **Partial intent recognition**: the keyword router may misclassify very short or ambiguous queries. Multi-turn clarification is minimal.
- **No search across companies**: asking "which of my companies is in biotech?" works via portfolio overview but isn't a dedicated intent.
- **Vercel cold starts**: the CSV parsing module singleton is warm after first request per worker; cold starts add ~200ms. Pre-warming with a cron ping solves this in production.

## File structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts          # Main chat endpoint
│   │   ├── snapshot/[id]/route.ts # Sidebar snapshot
│   │   └── investors/route.ts     # Investor list
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── InvestorPortal.tsx         # Full client UI
└── lib/
    ├── data/
    │   ├── types.ts               # Raw CSV row interfaces
    │   └── loader.ts              # CSV parsing + indexed in-memory DB
    ├── domain/
    │   ├── types.ts               # Answer shapes + evidence types
    │   ├── fx.ts                  # FX conversion + number formatting
    │   ├── portfolio.ts           # Portfolio overview calculation
    │   ├── positions.ts           # Single / multi-round position detail
    │   ├── obligations.ts         # Upcoming fees + capital calls
    │   ├── distributions.ts       # Distributions + exit proceeds
    │   ├── fees.ts                # Fee schedule + discount analysis
    │   ├── valuations.ts          # Valuation mark history + per-mark MOIC
    │   └── statement.ts           # Account statement summary
    ├── policy/
    │   └── access.ts              # Investor isolation enforcement
    ├── prompt/
    │   └── formatter.ts           # Personalised system prompt builder
    └── query/
        └── router.ts              # Intent classification + starter prompts
```
