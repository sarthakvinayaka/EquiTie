# AI Workflow

## Which AI tools and models were used, and for what?

**Claude Code (claude-sonnet-4-6) — primary development tool**

Used throughout the build as an interactive coding assistant in the terminal. Specific uses:

- Initial project scaffolding: Next.js App Router setup, TypeScript config, folder structure
- Generating the data layer: CSV parser with per-row provenance tracking, index builder, FK validation
- Drafting all engine functions (`getInvestorPortfolioOverview`, `getInvestorFeeBreakdown`, etc.) — reviewed and corrected before committing
- UI scaffolding: three-panel layout, chat interface, evidence panel, statement ledger
- Test file structure and boilerplate: test runner config, shared fixtures, describe/it skeleton
- Writing documentation: README, ARCHITECTURE.md, this file

**GPT-4o — the model the prototype calls at query time**

Used only for narrative phrasing. Receives a pre-computed JSON payload from the finance engine and returns natural-language prose. Does not touch financial calculations. Called once per turn, ~300–600 tokens per completion.

**No other AI tools were used.** The intent classifier, finance engine, policy guards, and FX logic are all deterministic TypeScript.

---

## Roughly what percentage of the code was AI-generated?

~80% of the initial file content. The overall codebase is approximately 14,700 lines of TypeScript/TSX across 9 test suites and ~40 source files.

The 80% is misleading without context. AI generated most of the *shape* of every file — the function signatures, the TypeScript interfaces, the structural skeleton. The remaining 20% is where the meaningful judgment calls live:

- Financial math corrections (see below)
- Policy guard ordering and the evidence integrity check
- The `EngineResult<T>` envelope pattern, enforced consistently across all 9 engine functions after the first version used inconsistent return shapes
- Multi-currency FX bridge logic (USD pivot)
- Evidence provenance design: every engine function had to be manually reviewed to confirm it was attaching the right source rows to the right evidence items
- Test assertions: the golden test suite was written from scratch by computing expected values by hand from the CSV data, then encoding them as toleranced assertions

The critical invariants — investor scoping before computation, no cross-investor evidence leakage, LLM receiving only pre-computed scalars — required close review at every layer. AI got the structure right but not always the ordering.

---

## What was rejected or materially changed from AI suggestions, and why?

**1. Rejected: LLM-based intent routing**

An early architecture sketch routed the user message to GPT-4o to classify intent before any computation. Rejected because: it adds ~300–500ms latency per turn, the intent space is small and well-defined (10 intents), and LLMs can be steered into wrong intents via adversarial phrasing — which is a real concern in a finance context where "tell me about Forgecraft" from investor A should not resolve to investor B's Forgecraft position. A deterministic regex-plus-keyword classifier is faster, cheaper, and fully auditable. The router now classifies in <1ms and its behavior is covered by 30 dedicated test cases.

**2. Rejected: LLM computing or re-deriving financial numbers**

An early composer prompt asked GPT-4o to "calculate the MOIC based on the allocation data below" and passed raw CSV fields. This is a significant reliability risk — the model approximates, rounds inconsistently, and can silently produce wrong values on edge cases like partial secondaries or multi-round aggregation. Replaced with a strict contract: the finance engine computes every number in TypeScript, the LLM receives formatted scalars and is explicitly instructed in the system prompt to use them verbatim. All numbers in the final answer are now deterministic and match the engine output exactly.

**3. Rejected: Overly abstract `InvestorScopedDb` pattern**

The AI proposed wrapping the entire database in a per-investor proxy object (`InvestorScopedDb`) that would throw on any access outside the investor's scope. Architecturally clean, but overkill at this stage — it would have required rewriting all engine functions to use the proxy API rather than the direct `db.*` maps, adding significant complexity for a prototype. Replaced with a simpler and equally effective pattern: policy guards run before any engine function is called, each engine function starts from `db.allocationsByInvestor.get(investorId)`, and G6 post-computation evidence integrity check catches any leakage. Belt-and-suspenders without the indirection cost.

**4. Materially changed: MOIC formula for partial exits**

The first engine draft computed `currentValue = units × latestSharePrice` without accounting for the fraction already realised via distributions. This overstates unrealised value for any position where proceeds have been returned. Fixed to `units × latestSharePrice × (1 − realisedFraction)`, where `realisedFraction` sums `fraction_of_units` across all distributions on the allocation. This correctly handles Helianthe Energy (fully exited, unrealised = 0) and Tallybook (partially exited).

**5. Materially changed: Admin fee currency handling**

The initial domain logic used `alloc.deal_currency` for all fee amounts, including admin fees. The dataset schema specifies admin fees are always denominated in USD regardless of deal currency. An investor in a GBP deal was getting their admin fee doubled through a redundant currency conversion. Fixed by using `fee.currency` (which is always `USD` for admin fee lines) rather than the deal currency. Without this correction, multi-currency investors would see wrong obligation totals.

**6. Rejected: Generic SaaS dashboard UI**

The AI's initial UI scaffold defaulted to a generic light-mode card grid — correct structure but wrong aesthetic for a private wealth context. The EquiTie brand read as premium and editorial (close to a Julius Bär or Hamilton Lane tone). Replaced the UI entirely with a dark editorial layout: deep navy backgrounds, muted gold accents, serif-adjacent typography, high-contrast evidence panel. AI helped iterate fast but the initial direction was wrong for the audience.

**7. Rejected: Streaming as first priority**

The AI flagged streaming responses as an early must-have. Deprioritised: the pre-computation step (CSV lookup + domain math) takes <50ms, and the total latency from request to LLM response is acceptable for a prototype demonstration. Adding the Vercel AI SDK would have introduced a new dependency and required rethinking the evidence/card rendering pipeline that depends on the complete JSON response. Kept as a "next sprint" item.

---

## How were answers verified as correct?

**Automated test harness — primary mechanism**

381 deterministic tests across 9 suites, all running against the real parsed dataset with no mocks. Key suites:

- `golden.test.ts` — pinned values computed by hand from the CSVs. INV001 statement total (227,600 USD ÷ 1.35 GBP/USD = 168,592 GBP), Forgecraft 3-round contributed (90,600 USD → 67,111 GBP), INV001 portfolio MOIC range bounded to 2.4–3.0×, INV009 performance fee effective rate confirmed at 10% vs 20% standard
- `isolation.test.ts` — scoped DB integrity, cross-investor evidence checks, INV001/INV002 disjoint allocation ID assertions
- `red-team.test.ts` — injection attacks, cross-investor reference attempts, external data requests, aggregation attacks
- `fees.test.ts` — five scenarios covering discounted, undiscounted, pending, and undeterminable (pre-exit performance fee) cases
- `fallback.test.ts` — deterministic mode: all 10 intents return valid output with null data, idempotent, error narrative echoes verbatim

**Manual spot-checks against raw CSV**

For each intent, expected values were computed by hand from terminal `grep`/`awk` queries and compared to API output:

- *INV001 portfolio overview:* summed `contributed_amount` across INV001 allocations in `allocations.csv`, applied FX from `fx_rates.csv` (GBP reporting), compared to API `totalContributedRpt`. Matched within floating-point tolerance.
- *Forgecraft multi-round (INV001):* confirmed 3 allocation rows (ALC0001 Seed, ALC0024 Series A, ALC0052 Series B), verified Seed effective share price = 2.25 (10% discount from 2.50 entry), verified Series B contributed = 15,600 not 26,000 (partial call with 10,400 outstanding).
- *INV009 fee discount:* confirmed ALC0004 has `performance_fee_pct = 10` vs deal standard 20%, and `admin_fee_usd = 0` vs standard 450. API response matched both.
- *Helianthe Energy (exited):* confirmed `deal.status = Exited`, `currentValueDealCcy = 0`, distributions non-zero. Investors with Helianthe showed correct exit proceeds in distributions panel.
- *Yappio (written-off):* confirmed `deal.status = Written Off`, expected MOIC = 0 for all Yappio investors, no distribution events.
- *Multi-currency obligations:* investor with a EUR deal (AED reporting) — confirmed obligation amounts used correct `fee.currency` rather than deal currency, FX bridge applied correctly via USD pivot.

**Evidence panel spot-check**

For each verified query, the evidence panel in the UI was checked to confirm: (a) all source rows cited were present in the CSV, (b) no rows from a different investor appeared, (c) valuation evidence showed the correct `valuation_date` and `mark_source` field.

---

## If you had an autonomous coding agent for another 8 hours, what would it work on?

Priority order, with reasoning:

**1. Multi-turn context (2 hours)**
The highest-impact product gap. Right now, "tell me more about Series A" after "what's my Forgecraft position?" gets a blank look — the router has no memory of the previous turn. Add a lightweight context object (`{ lastIntent, lastCompany, lastRound }`) passed through the chat API and used by the router as a prior. No database required, just session state on the client.

**2. Streaming responses (1 hour)**
Wire the Vercel AI SDK streaming endpoint. The evidence panel can render from the complete JSON before streaming begins (the engine is synchronous), so the card and evidence populate immediately while the narrative streams in. Significant perceived-latency improvement for the demo.

**3. Valuation history chart (1.5 hours)**
`getInvestorValuationTimeline()` already returns the full mark history with dates and share prices. A Recharts or plain SVG line chart wired to the `valuation_history` intent would make the "has Forgecraft had any down-rounds?" answer visually compelling. The data is there; it's purely a render problem.

**4. Session authentication (1.5 hours)**
Replace the investor selector dropdown with a real auth layer — Clerk or NextAuth is quick to wire with Next.js App Router. Map the session identity to `investorId` server-side so the policy layer can trust it rather than accepting it from the request body. The policy guard chain (G1–G6) already assumes `investorId` is trusted; this closes the gap between prototype and production.

**5. Durable audit log (1 hour)**
The policy log is currently an in-memory ring buffer that resets on cold start. Write `PolicyLogEntry` records to a Vercel KV store or a SQLite file so the audit trail survives restarts. The data model is already clean and typed.

**6. CI pipeline (1 hour)**
Add a GitHub Actions workflow that runs `npm test` and `next build` on every push. The CSV files are the source of truth — any schema drift would break the test suite immediately. The golden tests are specifically designed to catch this.

---

## Principles I used while working with AI on this case study

**1. AI owns structure, I own correctness.**
I let the AI scaffold every file and write first drafts of every function. I did not let it be the final word on anything that touched financial math, access control logic, or evidence provenance. Those were read line by line and tested against the source data.

**2. If the AI can't explain why a calculation is correct, it probably isn't.**
The first MOIC formula draft was missing the `realisedFraction` term. The AI was confident. It was wrong. Anything the model generates with financial arithmetic gets checked against the simplest possible test case — in this case, an investor with a single distribution that partially exited — before it touches the codebase.

**3. Reject suggestions that add complexity without adding reliability.**
The `InvestorScopedDb` proxy pattern, LLM-based routing, and the Vercel AI SDK streaming dependency were all technically coherent ideas that would have cost more hours than they were worth in a 2–3 hour build. The test for accepting a suggestion was: *does this make the system more correct, or does it just make it look more sophisticated?*

**4. Use AI for speed on the things where speed matters.**
Tailwind component iteration, TypeScript interface boilerplate, test file scaffolding, documentation first drafts — these are real time sinks where AI can do 80% of the work in seconds. That freed time for the 20% that required judgment.

**5. The evidence layer is not optional.**
Every answer should be traceable to a source row. I enforced this as a design constraint from the start — every engine function returns `evidence: EvidenceItem[]`, not just a number. This made verification fast (the source rows are right there in the UI) and made the G6 post-computation integrity check straightforward to add.

**6. Don't mistake fluency for accuracy.**
GPT-4o writes plausible financial prose. It also rounds numbers, adds invented context, and states things confidently that are wrong. The system prompt explicitly tells the model to use pre-computed values verbatim and to never calculate. But the test of whether that instruction works is the golden test suite, not trust.
