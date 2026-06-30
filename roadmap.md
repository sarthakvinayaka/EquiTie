# EquiTie Relationship Manager Bot — 6-Month Roadmap

**Scope:** Production-grade iOS assistant for private equity investors. Covers proactive servicing, portfolio Q&A, document workflows, onboarding, and investor communications — embedded in the EquiTie iOS app, backed by live fund data.

This is not a chatbot bolted onto a portfolio dashboard. The goal is to remove routine RM contact from investor ops without removing the investor's sense of being serviced. The bot handles everything that doesn't require human judgment, discretion, or regulatory sign-off. Everything that does gets escalated cleanly.

---

## 1. Scope and capabilities

### What the bot owns

| Capability | Description |
|---|---|
| **Portfolio Q&A** | Position detail, MOIC, fees, obligations, distributions, valuation history — deterministic engine, not LLM arithmetic |
| **Proactive capital-call reminders** | Push + in-app at T−14, T−7, T−1 with amount, bank details, and one-tap confirmation |
| **Fee reminders** | Scheduled nudges for management, admin, and structuring fees; overdue escalation to human RM at T+3 |
| **KYC/KYB support** | Document request flows, status updates, re-verification nudges on expiry — integrated with a regulated KYC vendor |
| **Document collection and e-sign** | Subscription agreements, side letters, transfer requests — bot initiates, DocuSign closes, ops confirms |
| **Account statement generation** | PDF or in-app statement on demand, or quarterly automated delivery |
| **Portfolio update summaries** | Auto-drafted personalised LP updates for RM review before send — not sent autonomously |
| **Investor onboarding** | Guided flow from KYC submission through bank verification to first commitment |
| **Escalation to human RM** | Detected triggers (advice requests, complaints, sensitive language, low confidence) route to a named contact with full context |

### What stays human-owned — permanently

- Investment recommendations, suitability assessments, and anything that could be construed as regulated advice
- New deal access decisions and allocation sizing
- Fee discount negotiations and side letter amendments
- Investor complaints and formal disputes
- Any message containing distress signals or vulnerability indicators
- Final approval on all AI-drafted external communications before they leave EquiTie

The escalation boundary is hard-coded in the policy layer, not subject to prompt engineering.

---

## 2. Architecture

### Component map

```
┌──────────────────────────────────────────────────────────────────────────┐
│  iOS App (Swift/SwiftUI)                                                 │
│  Chat UI · Portfolio snapshot · Document inbox · Notification centre     │
└──────────────────────┬────────────────────────────┬──────────────────────┘
                       │ HTTPS/WebSocket            │ APNs
┌──────────────────────▼──────────────────────────────────────────────────┐
│  API Gateway  (AWS API GW or Cloudflare)                                │
│  Auth middleware: JWT validation, investor_id binding, rate limiting    │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
          ┌────────────┴───────────────────────────────┐
          ▼                                            ▼
┌─────────────────────────┐              ┌─────────────────────────────┐
│  Chat Service           │              │  Event Scheduler            │
│  (Node.js / TypeScript) │              │  (Temporal.io)              │
│                         │              │                             │
│  Policy layer (G1–G6)   │              │  Capital-call reminders     │
│  Intent router          │              │  Fee due-date alerts        │
│  Finance engine         │              │  KYC expiry nudges          │
│  Composer (LLM)         │              │  Quarterly report triggers  │
│  Escalation detector    │              │                             │
└──────────┬──────────────┘              └────────────┬────────────────┘
           │                                          │
           ▼                                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Internal services                                                   │
│  ┌───────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ Finance Engine    │  │ Document Service │  │ Notification Hub │  │
│  │ (deterministic)   │  │ (S3 + DocuSign)  │  │ (APNs + email)   │  │
│  └───────────────────┘  └──────────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Data layer                                                          │
│  Portfolio DB (Postgres, primary source of truth)                   │
│  Read replica → finance engine (no write path from AI service)      │
│  Redis → conversation context (last N turns, resolved entities)     │
│  pgvector → document embeddings (deal memos, LP updates, FAQ)       │
│  S3 → investor documents, generated PDFs                            │
└──────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  External integrations                                               │
│  Fund admin (Carta / Assure) · KYC vendor (Persona) · DocuSign      │
│  CRM (HubSpot) · Model gateway (Anthropic API) · Observability      │
└──────────────────────────────────────────────────────────────────────┘
```

### Key architectural choices

**Read replica for AI queries.** The finance engine reads from a Postgres read replica. The AI service has no write path to the portfolio database. If something goes wrong in the AI layer, investor data is not modified.

**Temporal.io for proactive workflows.** Capital-call reminders are not cron jobs — they are durable, resumable workflows with retry logic, backoff, and a clear audit trail of what was sent, when, and whether it was acknowledged. Temporal handles the scheduler reliability problem so the application layer doesn't have to.

**Event-driven data contracts.** Fund admin data arrives via nightly batch sync, but critical events (new capital call issued, KYC status changed, distribution processed) trigger webhooks that update the portfolio DB immediately. The event schema is versioned and published to the engineering team — downstream consumers (chat service, scheduler) subscribe to events, not to tables. This avoids polling and makes the system observable.

**Redis for conversational context.** Session state (last resolved intent, company name, round) lives in Redis with a 24-hour TTL. The finance engine stays stateless; context is injected at the router layer. This makes multi-turn conversations work ("and what about Series A?") without a database round-trip per turn.

---

## 3. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| iOS client | Swift / SwiftUI | Native performance, APNs, Face ID for auth |
| Web (admin + fallback) | Next.js 15 (App Router) | Same codebase as prototype; Vercel-native |
| Chat service | Node.js / TypeScript | Same language as finance engine — no FFI boundary |
| Workflow scheduler | Temporal.io | Durable execution, retry semantics, audit trail |
| Primary database | PostgreSQL (RDS) | Relational integrity for financial data, pgvector extension for RAG |
| Cache / session | Redis (ElastiCache) | Sub-millisecond context lookups |
| Document storage | S3 + CloudFront | Pre-signed URLs for investor document access |
| LLM (primary) | claude-sonnet-4-6 | Best quality/latency tradeoff for conversational finance |
| LLM (lightweight) | claude-haiku-4-5 | Intent classification, notification copy, short acks |
| Embeddings | Voyage AI or Anthropic | For RAG over deal memos and LP documents |
| Vector store | pgvector (Postgres extension) | Avoids a separate Pinecone dependency at this scale |
| Observability | Langfuse | Prompt/response tracing, latency, token cost per turn |
| KYC/AML | Persona | Regulated vendor, bank-grade compliance, webhook integration |
| E-signature | DocuSign | Market standard, legally binding, investor familiarity |
| Push notifications | APNs (iOS) + FCM (web) | Direct, no intermediary |
| Auth | Existing EquiTie auth (OAuth2 / JWT) | investor_id bound to session server-side |

---

## 4. Data and integrations

### Data contracts

Every external data source has a defined contract:

- **Portfolio ledger** — canonical source of truth. Finance engine reads from read replica only. Schema changes go through a migration review with AI team sign-off because column renames or type changes will silently break engine queries.
- **Fund admin (Carta/Assure)** — nightly batch sync for marks and fee schedules; real-time webhooks for capital call events. The sync job validates record counts and amount checksums before committing. Failures alert, not silently drop.
- **KYC vendor (Persona)** — webhook on status change (Approved / Rejected / Expired). The chat service subscribes; if KYC expires for an active investor, the scheduler enqueues a re-verification workflow within 24 hours.
- **DocuSign** — webhook on document completion. Investor ops is notified; the bot sends a confirmation message. Failures (timeout, declined) trigger human RM escalation, not retry.
- **CRM (HubSpot)** — bidirectional. Inbound: investor contact details, relationship notes. Outbound: every bot-generated communication logged as an activity against the investor record. This keeps the human RM's view of the relationship current.

### What does not flow to the model

Raw database rows, email addresses, bank account details, and phone numbers never appear in a model prompt. The composer receives pre-computed scalars and typed domain objects. PII handling is a data-layer concern, not a prompt-engineering concern.

---

## 5. AI approach and safety

### Finance is deterministic code

The same principle from the prototype holds at full scale:

- **MOIC, current value, fee totals, net cash flow, FX conversion** — TypeScript engine, no model involvement
- **Portfolio math for proactive messages** — computed before the notification prompt is constructed
- **RAG retrieval** — returns document excerpts; the model synthesises language, not numbers

The model receives a typed JSON payload. It is explicitly instructed to use pre-computed values verbatim. The system prompt includes a hard constraint: "Do not recalculate, estimate, or infer financial figures. Use only the values provided in the data payload."

### Policy layer (extended from prototype)

| Guard | Scope |
|---|---|
| G1 Investor exists | All requests |
| G2 No cross-investor reference | All requests |
| G3 No external market data | All requests |
| G4 Ambiguous entity | Post-intent |
| G5 Company in portfolio | Post-intent |
| G6 Evidence integrity | Post-computation |
| **G7 No investment advice** | **All model outputs** |
| **G8 Escalation trigger** | **Detected sentiment, advice request, vulnerability** |
| **G9 Comms approval gate** | **Outbound investor communications** |

G7 is enforced by an output classifier that runs on every model response before it reaches the investor. G8 detects patterns (explicit advice requests, distress language, unusual urgency) and routes to the human RM with a summary. G9 holds any outbound communication in a draft queue for RM review before delivery.

### Escalation model

Escalation is not a failure state — it is a first-class feature. When the bot escalates:

1. The conversation is summarised in 2–3 sentences
2. The human RM receives the summary, the investor's current portfolio state, and the full conversation thread
3. The investor sees: "I've flagged this for your relationship manager, [Name], who will follow up within [SLA]"
4. The RM response is logged against the investor record in CRM

The SLA commitment and the RM's name are configured per-investor, not hardcoded. High-value investors get a shorter SLA and a named senior RM.

---

## 6. Evaluation and observability

### Automated evaluation harness

The prototype's 378-test suite is the starting point. At production scale:

- **Golden dataset** — 300+ investor Q&A pairs with pinned expected outputs, covering all 10 intents across 15 investor profiles. Every deploy runs this suite. A regression in financial accuracy blocks the deploy.
- **Red-team suite** — 100+ adversarial inputs: injection attacks, cross-investor references, advice-seeking phrasings ("should I invest more?"), ambiguous company names, partial sentences, non-English queries. All must return safe, correct responses.
- **Intent boundary tests** — inputs that sit on the edge between two intents (fee_detail vs obligations, valuation_history vs position_detail). Router confidence must exceed a threshold or the system asks for clarification.
- **Fallback coverage** — every intent tested with no API key, null data, and malformed data. No test should throw; all should return valid, appropriately hedged responses.

### LLM-as-judge (weekly)

A random sample of 50 production conversations is reviewed weekly by claude-opus-4-8 using a structured rubric: factual accuracy (does the narrative match the pre-computed data?), tone appropriateness for investor profile, compliance safety (no advice given), and completeness (were all parts of the question addressed?). Results are reported to the product team. Sustained quality regression triggers a prompt review sprint.

### Observability

- **Langfuse** — every model call traced with input token count, output token count, latency, model version, intent, investor sophistication tier. Cost per intent is tracked to identify optimisation targets.
- **Alerts** — P99 response latency >3s, model refusal rate >2% in a 1-hour window, PII detected in any log, G6 evidence integrity failure (any occurrence)
- **Audit log** — append-only Postgres table: `investor_id`, `session_id`, `intent`, `model_version`, `prompt_hash`, `response_hash`, `guard_results`, `timestamp`. Replayable: given a session ID, the exact prompt can be reconstructed for any point in time.
- **Investor ops dashboard** — human review queue showing flagged conversations, escalated sessions, and low-confidence responses. Reviewer marks each as approved, corrected, or escalated-to-compliance.

---

## 7. Security and compliance

### Data handling

- Investor PII (name, email, bank details) is resolved from the portfolio DB by the API layer and never included in model prompts. The model receives `investor_id` and pre-computed domain objects only.
- All model API calls go through the Anthropic API with a Data Processing Agreement in place. EU investor data is processed on EU-region endpoints.
- GDPR right-to-erasure: investor data is deleted from Redis within 1 hour of request, from audit logs within 72 hours per policy. Portfolio database deletion follows EquiTie's existing retention policy.
- API keys rotated on a 90-day schedule via AWS Secrets Manager. Key compromise triggers immediate rotation without deploy.

### Role-based access

| Role | Permissions |
|---|---|
| Investor | Own data only, read-only |
| Relationship Manager | Their book of investors, can view chat threads, approve/send comms |
| Investor Ops | All investors, read-only on AI interactions, human review queue |
| Compliance | Full audit log access, redacted transcripts |
| Engineering | Observability dashboards, no production investor data |

The bot's service account has read-only access to the portfolio read replica. It cannot write to the portfolio database, the CRM, or the document store. Writes flow through dedicated service APIs with their own auth and logging.

### Security testing

- Penetration test before public iOS launch (Month 3) covering auth bypass, cross-investor data access, and injection attacks
- Automated secret scanning in CI (Gitleaks)
- Dependency audit on every deploy (npm audit, Snyk)
- The red-team test suite runs on every deploy and must fully pass

---

## 8. Team and hiring

| Role | Start | Responsibility |
|---|---|---|
| Senior Full-Stack Engineer (iOS + Next.js) | Month 0 | iOS integration, chat UI, push notifications |
| Senior AI/ML Engineer | Month 0 | Prompt architecture, evaluation harness, model selection |
| Backend Engineer (TypeScript) | Month 1 | Finance engine hardening, event-driven data layer, integrations |
| Product Designer | Month 1 | Conversation UX, notification design, investor trust patterns |
| QA / Evaluation Engineer | Month 2 | Golden dataset, red-team suite, LLM-judge pipeline |
| Compliance Analyst (contractor) | Month 2 | Review all comms templates, ongoing output spot-check |
| Platform / DevOps Engineer | Month 3 | Production infrastructure, CI, secrets management, observability |

**Hiring note:** The AI engineer role is the highest-leverage hire. Prompt architecture, evaluation harness design, and model-selection decisions compound across the entire product. Hire someone who has built production LLM pipelines before, understands eval methodology, and has opinions on the deterministic-vs-model boundary. A generalist who "knows some ML" will produce a bot that works in demos and fails in production.

The compliance contractor should be retained throughout — not just for launch review. Regulatory language evolves and investor communications need ongoing scrutiny.

---

## 9. Six-month phased timeline

### Month 1 — Production foundation

- Migrate from CSV to Postgres; finance engine reads from read replica
- Event-driven data contracts: fund admin webhooks, KYC vendor integration
- Extend prototype: persistent chat history, streaming responses, mobile-responsive web
- Auth hardening: `investor_id` bound server-side, not accepted from request body
- CI pipeline: build + golden eval suite (100 test cases) gates every deploy

**Gate:** Finance engine produces correct results for all edge cases in the golden dataset. No deploy without green CI.

### Month 2 — Proactive layer

- Temporal.io scheduler: capital-call reminders (T−14, T−7, T−1), fee due-date alerts
- KYC expiry detection and re-verification nudge flow
- iOS TestFlight beta with APNs push notifications
- Escalation detector: routes advice requests and distress signals to human RM
- Evaluation harness expanded to 200 test cases including red-team suite

**Gate:** Pilot investors (5–10) actively using the app; at least 3 escalations handled end-to-end to validate the RM handoff flow.

### Month 3 — Document workflows and iOS launch

- DocuSign integration: subscription agreement and side letter request/completion flows
- Investor onboarding flow (KYC → bank verification → first commitment)
- Account statement PDF generation (on-demand and scheduled)
- Penetration test and security audit
- Compliance review of all comms templates and guard rules
- Langfuse observability fully wired; investor ops review queue live

**Gate:** Security audit passed. Compliance sign-off on all bot-generated communication types. App Store submission.

### Month 4 — Communications and comms-drafting tool

- Internal comms drafting tool for RMs (AI drafts → RM reviews → sends)
- Quarterly LP update generation with portfolio data embedded
- G9 comms approval gate in investor ops dashboard
- RAG layer for deal memos and fund documents (pgvector)
- LLM-as-judge weekly pipeline running in production

**Gate:** At least 20 AI-drafted investor communications reviewed and sent by RMs. Evaluate quality, RM time-saving, and investor response rate vs manual comms.

### Month 5 — Intelligence and personalisation

- Proactive portfolio insights: valuation milestone alerts, MOIC change summaries, concentration flags
- Multi-turn conversation with full entity resolution (follow-up questions work)
- Per-investor notification preferences (frequency, channel, topics)
- A/B test haiku vs sonnet for notification copy; move low-complexity paths to haiku
- Audit log replayability: any conversation reconstructible from session ID

**Gate:** 10% reduction in routine inbound investor ops queries (measurable via CRM ticket volume).

### Month 6 — Hardening and scale

- GDPR right-to-erasure implementation end-to-end
- Cold start elimination (Lambda provisioned concurrency or Vercel fluid compute)
- Full platform load test at 10× current investor count
- Production runbook documented and reviewed by team
- Retrospective: which capabilities drove engagement, which were low-value
- Internal roadmap for next 6 months (what to build, what to buy, what to deprecate)

**Gate:** P99 response latency <2s under load. Audit log reviewed by compliance and signed off.

---

## 10. Risks, build vs buy, and cost

### Key risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Model generates financial figures that differ from engine output | Low | Hard constraint in system prompt; golden evals catch any drift |
| Investor perceives bot as giving investment advice | Medium | G7 output classifier; compliance review of all templates |
| Fund admin API unreliable or slow | Medium | Nightly batch fallback with last-known-good mark; alert on sync failures |
| KYC vendor downtime during onboarding flow | Low-Medium | Async flow with retry; RM fallback path always available |
| App Store rejection for financial advice language | Medium | Legal review of app description and chatbot UI copy before submission |
| Investor trust: "I want to speak to a person" | Medium | Escalation to named RM is one tap, always visible, never hidden |
| Data breach — investor conversation logs | Low | PII not in logs, audit log encrypted, access control by role |

### Build vs buy

| Component | Decision | Reasoning |
|---|---|---|
| LLM inference | Build on Anthropic API | Quality, compliance-friendly DPA, structured output reliability |
| KYC/AML | Buy (Persona) | Regulatory complexity, accreditation, ongoing compliance maintenance |
| E-signature | Buy (DocuSign) | Legal enforceability, investor familiarity, integration ecosystem |
| Fund admin | Integrate (Carta/Assure) | Solved problem; build would take 6+ months for less reliability |
| Evaluation harness | Build | No off-the-shelf tool handles domain-specific financial Q&A eval; the harness is a competitive differentiator |
| Workflow scheduler | Buy (Temporal.io) | Durable execution semantics are hard to build correctly; Temporal is well-understood |
| Observability | Buy (Langfuse) | LLM-native tracing; cheaper and faster than building a custom prompt log |
| Vector store | Build on pgvector | At current document volume (<10k chunks), a separate Pinecone instance is unnecessary overhead |

### Cost shape (monthly, steady state, ~500 active investors)

| Item | Estimated monthly |
|---|---|
| Anthropic API — sonnet-4-6 (~8k queries/day @ $3/Mtok) | £3,000–5,000 |
| Anthropic API — haiku-4-5 (notifications, classification) | £400–800 |
| AWS (RDS, ElastiCache, S3, Lambda, API GW) | £2,000–4,000 |
| Temporal.io (cloud) | £500–1,000 |
| Persona KYC (per-check) | £800–1,500 |
| DocuSign | £400–800 |
| Langfuse + Datadog | £500–1,000 |
| **Total infrastructure + AI** | **£7,500–14,000/month** |

Team cost (6 FTE senior engineers, London): £900k–£1.1M/year fully loaded.

**Unit economics:** At 500 active investors, infrastructure cost is £15–28/investor/month. If the assistant saves each RM 3 hours/week of routine servicing, and RM time is valued at £80/hour, the break-even is fewer than 2 investors per RM. The leverage is significant.
