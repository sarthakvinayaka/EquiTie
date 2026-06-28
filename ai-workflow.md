# AI Workflow

## Which AI tools and models did you use, and for what?

**Claude Code (claude-sonnet-4-6)** — the coding assistant used throughout:
- Reading and reasoning about the dataset guide and case study PDF
- Proposing and reviewing architecture before writing any file
- Generating all TypeScript code: data loader, domain functions, API routes, UI
- Writing documentation (README, this file, roadmap)

**Anthropic claude-sonnet-4-6 (runtime)** — the model the prototype calls at query time:
- Converts pre-computed structured data into natural language answers
- Applies investor-specific tone and depth based on profile
- Never does portfolio math — that stays in deterministic TypeScript

No other AI tools were used. The intent classifier, finance engine, and access policy are all deterministic code.

## Roughly what percentage of the code was AI-generated?

~85%. Claude Code generated the initial scaffold of every file. The remaining 15% is:
- Manual fixes to TypeScript type errors caught during review
- Adjustments to financial math edge cases (partial secondary, admin-fee-in-USD treatment, MOIC exclusion for pending allocations)
- UI interaction wiring (textarea auto-resize, scroll behaviour, panel toggling)
- Iteration on the system prompt after testing with real data

## What did you reject or materially change from AI suggestions, and why?

1. **Rejected: LLM-based intent routing.** The initial architecture sketch included calling Claude to classify message intent. Replaced with deterministic keyword + entity matching because: (a) adds latency and cost per query, (b) can hallucinate wrong intents when given financial jargon, (c) overkill for a constrained intent space of 7 categories. The deterministic router is faster, cheaper, and fully auditable.

2. **Changed: MOIC calculation for partial secondaries.** The AI's first attempt computed `current_value = units × latest_share_price` without accounting for the fraction already realised. Fixed to `(1 - realised_fraction) × units × share_price`. This correctly handles Tallybook (30% secondary sold) and any future partial exits.

3. **Changed: Admin fee currency handling.** Early code used deal currency for all fees. The dataset spec says admin fees are always in USD even on non-USD deals. Corrected the fee and statement domain functions to use `fee.currency` (which is USD for admin fees) rather than `alloc.deal_currency`.

4. **Rejected: streaming via Vercel AI SDK.** The AI suggested adding the Vercel AI SDK for streaming responses. Rejected to keep dependencies minimal and because our pre-computation step (CSV lookup + domain calculation) runs in <50ms, making the total latency acceptable without streaming for a prototype.

5. **Changed: evidence deduplication.** The portfolio domain function initially added duplicate valuation evidence rows when a company appeared in multiple rounds. Deduplicated by evidence ID in the UI render loop.

## How did you verify the assistant's answers were correct?

**Spot-check methodology** — for each query intent, I manually computed the expected answer from the CSVs in a terminal and compared to the API response:

1. **Portfolio overview (INV001):** Summed ALC0001 + ALC0002 + other INV001 allocations from `allocations.csv`, applied FX rates from `fx_rates.csv` (GBP reporting currency), then compared total contributed and current value to the API output.

2. **Forgecraft Robotics position:** Cross-checked that the API returned all three rounds (Seed, Series A, Series B), that the effective share price on Seed reflected the 10% discount (2.25 USD vs 2.5 entry), and that Series B showed partial contribution (60% of commitment).

3. **Obligations:** Filtered `capital_calls.csv` and `fees.csv` for INV001 with status Upcoming/Overdue, checked due dates and amounts against API output.

4. **Admin fee in USD:** Queried an investor in a GBP deal, verified the admin fee amount came through in USD (converted to GBP for reporting) rather than GBP.

5. **Exit (Helianthe Energy):** Confirmed current unrealised value = 0 and that distributions showed the 1.5× return net of carry.

6. **Write-off (Yappio):** Confirmed MOIC = 0 for affected investors, current value = 0, no distributions.

7. **Down round (Qubrium Series B):** Verified MOIC < 1 for Series B position, confirmed the mark history showed decline from 10.0 entry to 6.2 current.

**Edge case checklist:**
- [x] Same company, multiple rounds (Forgecraft: 3 rounds) — aggregated correctly
- [x] Per-investor share-price discount (10% off for INV001 on Forgecraft Seed)
- [x] Multi-currency positions (USD/GBP/EUR/AED deals, GBP reporting)
- [x] Pending/unfunded allocation (contributed = 0, excluded from MOIC)
- [x] Zero-holding investors (Henrik Sorensen, Lara Greco — empty state)
- [x] Exit (Helianthe Energy — distributions, zero current value)
- [x] Write-off (Yappio — zero MOIC)
- [x] Down round (Qubrium Series B — MOIC < 1)
- [x] Partial secondary (Tallybook — 30% realised, 70% live)
- [x] Admin fee always in USD regardless of deal currency

## If you had an autonomous coding agent for another 8 hours, what would you point it at next?

**Priority order:**

1. **Streaming responses** — wire up the Anthropic streaming API and replace the fetch-then-render pattern with incremental token display. Reduces perceived latency and feels significantly more premium.

2. **Richer intent handling** — the current router falls back to `portfolio_overview` for unrecognised queries. Add a "clarification" path that surfaces the list of intents when the question is ambiguous, and a multi-turn flow that asks follow-up questions.

3. **Valuation chart** — add a lightweight SVG or Recharts line chart for valuation history. The data is already computed in `domain/valuations.ts`; the chart just needs to be wired to a prompt like "show me Forgecraft's valuation history".

4. **Persistent chat history** — connect to a lightweight store (Vercel KV or a single SQLite file) so conversation history survives page refresh per investor.

5. **Evaluation harness** — write a test suite that runs known questions against the deterministic engine and asserts exact numerical outputs (portfolio MOIC, fee amounts, obligation totals) using the edge-case investors from the dataset guide. This is the fastest way to catch regressions when the domain logic changes.

6. **Vercel deployment CI** — add a GitHub Action that runs `next build` and the eval harness on every push. Given that CSV files are the source of truth, any accidental schema change would immediately fail CI.
