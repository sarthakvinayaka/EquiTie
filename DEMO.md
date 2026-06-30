# EquiTie — Demo & Submission Guide

## Recommended demo investor: Selina Voss (INV002)

Selina is the richest demo scenario in the dataset:

| Signal | Value | Why it matters |
|---|---|---|
| Reporting currency | GBP | Multi-currency FX conversion on display |
| Tech savviness | High | Experienced tier — concise, no jargon defined |
| Forgecraft Robotics | 3 rounds (Seed · Series A · Series B) | Multi-round aggregation |
| Forgecraft Seed | 10% price discount (2.25 vs 2.50 entry) | Negotiated terms surfaced correctly |
| Forgecraft Series B | Fee discount on management fee | Per-deal discount tracking |
| Helianthe Energy | Exited — EUR 126,000 gross, 25% carry | Distribution with carry deduction |
| Mendwell + Inferna AI | Active positions, different rounds | Breadth of portfolio |
| Total positions | 6 | Meaningful portfolio, not a trivial case |

For the **personalization contrast**, switch to **Daniel Cohen (INV012)** — Low tech savviness, USD, Emerging tier. The same portfolio overview question produces noticeably different phrasing.

---

## Walkthrough script (4–5 minutes)

### 0. Setup (15s)

Open the app. The investor selector in the top-right shows the current investor and their ID. Switch to **Selina Voss (INV002)** via the Evaluator panel.

> *"The evaluator panel lets you switch between all 112 investors. Each switch fully re-scopes the data — no investor can see another's portfolio."*

---

### 1. Access control — policy layer in action (30s)

While on INV001 (or before switching), type:

> **"What does Selina Voss's portfolio look like?"**

**What it shows:** The policy layer catches the cross-investor reference before any finance computation runs. The response explains why the question was blocked and what the investor can ask about.

**What to say:** *"G2 — the cross-investor guard — fires before the finance engine is called. No data for Selina was queried, accessed, or included in the prompt. The block is in the code, not the system prompt."*

Now switch to **Selina Voss (INV002)**.

---

### 2. Portfolio overview (45s)

> **"Give me a portfolio overview"**

**What it shows:**
- 6 positions with MOIC, current value, contributed capital — all in GBP
- The evidence panel opens automatically, showing the exact allocation and valuation rows used
- The sidebar snapshot matches the chat answer (same deterministic engine, called independently)

**What to say:** *"Every number here is computed in TypeScript before the LLM is called. The model receives pre-computed scalars and phrases them — it never does the maths. Click any evidence row to see the exact source record."*

**Point out:** The `Experienced Investor` tier badge on the response — Selina's High tech savviness drives a concise, data-dense answer style.

---

### 3. Multi-round position (60s)

> **"Walk me through my Forgecraft Robotics positions — I'm invested across 3 rounds"**

**What it shows:**
- Seed (2022): effective entry price **$2.25** — the 10% negotiated discount from the $2.50 standard entry, sourced from the allocation row
- Series A (2023): entry at $7.80
- Series B (2025): partially called — $15,600 contributed of $26,000 committed, 60% capital deployed
- Aggregate company MOIC across all three rounds
- Warning note: multi-round aggregation is flagged so the investor understands the blended figure

**What to say:** *"The engine finds all allocations for Forgecraft, computes per-round MOIC and a weighted aggregate, and flags the price discount and partial call as part of the EngineResult warnings. None of this requires LLM reasoning."*

---

### 4. Fees and negotiated discounts (45s)

> **"Do I have any fee discounts on Forgecraft, and how much am I saving vs the standard rates?"**

**What it shows:**
- Series B (ALC0065) carries a fee discount flag — management fee rate is below the deal standard
- The schedule shows effective rate vs standard rate, with the saving in GBP
- Other Forgecraft rounds show full standard fees for comparison

**What to say:** *"Discounts are tracked at the allocation level in the dataset — `fee_discount = Yes` on ALC0065. The engine reads the allocation's `mgmt_fee_pct` against the deal's `std_mgmt_fee_pct` and computes the saving. No hard-coding."*

---

### 5. Upcoming obligations (30s)

> **"What capital calls do I still owe, and when are they due?"**

**What it shows:**
- Outstanding capital calls with amounts, due dates, and deal references
- Overdue items flagged differently from upcoming items
- Total obligations in GBP (multi-currency amounts converted via FX bridge)

---

### 6. Distributions after carry (45s)

> **"What have I actually received in cash — distributions and exit proceeds?"**

**What it shows:**
- Helianthe Energy (Exited): **€126,000 gross → €10,500 carry (25%) → €115,500 net**
- Net amount converted to GBP for the reporting currency total
- Distribution evidence row shows `performance_fee_pct`, `gross_amount`, and `net_amount` from the source record

**What to say:** *"Carry is deducted at the distribution record level — the `net_amount` field is what the investor receives. The engine doesn't compute carry; it reads the pre-calculated net from the fund administrator's record and surfaces the gross, carry, and net separately."*

---

### 7. Valuation history (45s)

> **"How has Forgecraft Robotics been valued since my initial entry?"**

**What it shows:**
- 4 marks from $2.50 (Entry) → $7.80 (Markup Round) → $12.00 (Internal) → $15.40 (Markup Round)
- Each mark shows the source (Internal / Markup Round), the date, and Selina's MOIC at that point
- All up-rounds — no down-round warning for Forgecraft

**What to say:** *"Mark source is preserved — Internal valuations vs external Markup Rounds are labelled differently. The valuation timeline is fully deterministic from the valuations.csv rows."*

---

### 8. Account statement (30s)

> **"Show me my account statement — all cash contributions, fees, and distributions"**

**What it shows:**
- Grouped ledger: Capital Contributions, Fees Paid, Distributions Received
- Net cash flow = distributions − contributions − fees
- Click "Print / Save as PDF" to open a clean printable statement

**What to say:** *"The statement is generated from statement_lines.csv — every line traceable to a source record. The PDF export uses the same data, no re-computation."*

---

### 9. Personalization contrast (45s)

Switch to **Daniel Cohen (INV012)** — Low tech savviness, USD reporting, Emerging tier.

Ask the same question:

> **"Give me a portfolio overview"**

**What to point out:**
- Response carries the `Emerging Investor` tier badge
- MOIC is defined inline: *"MOIC — your return multiple — is the total portfolio value divided by what you've invested"*
- Conclusions are stated first; detail follows
- Tone is noticeably more explanatory than Selina's concise answer

**What to say:** *"Sophistication is derived from `tech_savviness` and deal count in the dataset — no manual labelling. The same engine result, two different phrasings."*

---

## What each question demonstrates

| Question | Capability demonstrated |
|---|---|
| "What does Selina Voss's portfolio look like?" (as INV001) | G2 cross-investor policy guard, pre-computation blocking |
| Portfolio overview | Deterministic engine, evidence panel, FX conversion, Experienced tier |
| Forgecraft 3 rounds | Multi-round aggregation, price discount, partial capital call |
| Fee discounts | Per-allocation discount tracking, saving vs standard rate |
| Upcoming obligations | Capital call schedule, multi-currency totals, overdue flagging |
| Distributions | Carry deduction, gross/net/fee breakdown, exited position handling |
| Valuation history | Mark timeline, source attribution, per-mark MOIC |
| Account statement | Cash-flow ledger, net cash flow formula, PDF export |
| Same question, INV012 | Emerging-tier phrasing, jargon explanation, personalization contrast |

---

## Why this wins

**The bet was that trust requires verifiability, not fluency.**

Most AI finance demos look impressive until someone asks how a number was calculated. In this build, every number is traceable: the evidence panel shows the exact source records, the engine is pure TypeScript with a 378-test harness, and the system works correctly with no API key at all. The LLM handles phrasing. The code handles correctness.

Specific things worth calling out to a reviewer:

**1. Deterministic financial engine.** MOIC, FX conversion, fee totals, net cash flow, and multi-round aggregation are computed in TypeScript before any model is called. The LLM receives pre-computed JSON and is explicitly instructed never to recalculate. This is the design decision that makes every other quality claim credible.

**2. Policy layer with evidence integrity.** Six guards run in a fixed order on every request. G6 — the post-computation evidence integrity check — verifies that every evidence row used in the answer belongs to the scoped investor. The checks are in code, not in the system prompt.

**3. Investor isolation at multiple layers.** The data layer indexes by investor. The policy layer blocks cross-investor references before computation. The evidence check confirms it post-computation. Three independent enforcement points.

**4. Works without an API key.** All financial calculations remain correct in fallback/template mode. The UI flags this clearly. A reviewer can verify every number against the source CSVs without an LLM in the loop.

**5. Architecture that scales.** The 10-layer design maps directly to a production engineering team. Each layer has a defined responsibility and a clear interface. The path from prototype to a production iOS RM bot is described in `roadmap.md` — and the prototype's architecture is already consistent with that path.

**6. Credible evaluation harness.** 378 tests across 9 suites, covering golden pinned values, investor isolation, red-team attacks, fallback behaviour, and routing. Runs in under one second. The golden tests were computed from the source CSVs by hand, not generated from the engine output.

---

## Deliberate tradeoffs for the 2–3 hour timebox

These were conscious choices, not omissions:

| Tradeoff | What was chosen | What was deferred |
|---|---|---|
| Single-turn conversations | Simpler, fully correct responses | Multi-turn context (entity carryover across turns) |
| Static FX rates | Snapshot rates baked into fx_rates.csv | Live rates API with cache |
| No session authentication | Investor selector for demo; `investor_id` trusted from body | JWT-bound identity, session middleware |
| No streaming | Complete JSON response; enables clean evidence/card rendering | Incremental token display |
| CSV files, not database | Zero infrastructure setup; runnable anywhere | Postgres with live fund admin sync |
| Keyword intent router | Deterministic, auditable, fast | Embedding-based semantic routing for unusual phrasings |
| In-memory audit log | Simple, no dependencies | Durable append-only log to Postgres |
| One LLM call per turn | Simple pipeline, easy to trace | Haiku for classification + Sonnet for phrasing (cost optimisation) |

---

## Known limitations

**Answered correctly but not fully surfaced:**
- Upcoming management and admin fees appear in the obligations view but not in the account statement ledger, which shows only realised (paid) lines from statement_lines.csv. This matches the dataset structure and is documented in the statement summary.

**Query handling:**
- Follow-up questions that depend on a prior turn require the investor to restate context ("my Forgecraft Series A" rather than "the Series A"). The intent router has no conversation memory.
- Unusually phrased queries may fall to the `unsupported_or_ambiguous` intent and return a clarification prompt rather than an answer. The router covers the most common phrasings for each intent.

**Data scope:**
- FX rates are fixed at the dataset snapshot date (25 June 2026). Reported values do not reflect live exchange rate movements.
- The dataset is self-contained — questions about market comparables, industry benchmarks, or external companies are correctly declined by the G3 guard.

**Infrastructure:**
- First request after a cold start parses all CSV files (~200ms). Subsequent requests return in under 50ms (in-memory singleton).
- Chat history is held in client state and does not persist across page refreshes.
