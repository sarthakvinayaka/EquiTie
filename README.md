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
