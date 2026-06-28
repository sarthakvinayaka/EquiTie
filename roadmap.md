# EquiTie Relationship Manager Bot — 6-Month Build Roadmap

**Context:** Six months, effectively unlimited budget. Build a full relationship-manager bot inside the EquiTie iOS investor app — not just Q&A, but proactive nudges, capital-call and fee reminders, document and KYC requests, onboarding, reporting, and drafting investor comms.

---

## Scope and capabilities

### What the bot owns

| Capability | Description |
|---|---|
| **Q&A** | Portfolio overview, position detail, fees, obligations, distributions — same as prototype but with live data |
| **Proactive nudges** | Push notifications for upcoming capital calls (T-14, T-7, T-1), overdue fees, KYC expiry, new valuation marks |
| **Onboarding** | Guide new investors through KYC/AML submission, bank account setup, and first investment commitment |
| **Document requests** | Request signatures on subscription agreements, side letters, transfer documents via e-signature integration |
| **Fee reminders** | Scheduled messages for management and admin fee due dates, with one-click payment link |
| **Reporting** | Generate personalised quarterly investor letters, portfolio performance summaries, tax pack notifications |
| **Investor comms drafting** | Help the EquiTie team draft personalised update emails to LP cohorts (internal tool, not investor-facing) |

### What stays with a human

- Investment recommendations and suitability assessments (regulatory)
- New deal access decisions and allocation sizing
- Negotiated fee discounts and side letter amendments
- Any situation requiring legal or compliance sign-off
- Escalated investor complaints

---

## Architecture and tech stack

### Client
- **iOS**: Swift/SwiftUI, with a WebView fallback for fast iteration on chat UI
- **Web**: Next.js (same codebase as prototype, extended)
- Push notifications: APNs (iOS) + Firebase Cloud Messaging (web)

### Backend
- **API gateway**: Vercel or AWS API Gateway
- **Chat service**: Node.js / TypeScript, deployed as serverless functions
- **Proactive scheduler**: Temporal.io or AWS EventBridge for time-based triggers (capital call reminders, fee due dates)
- **Auth**: existing EquiTie auth (assume OAuth2 / JWT), session binding at API level
- **Audit log**: append-only Postgres table for every AI interaction (required for compliance)

### Data layer
- **Portfolio ledger**: PostgreSQL (primary source of truth, replacing CSV files)
- **Read replica**: used exclusively by the AI service to avoid write contention
- **Cache**: Redis for session context (current investor state, last 10 conversation turns)
- **Document storage**: S3 + pre-signed URLs for investor documents

### AI / LLM layer

**Models:**
- `claude-sonnet-4-6` for Q&A and comms drafting — best balance of quality and latency at conversational lengths
- `claude-haiku-4-5` for lightweight tasks: intent classification, notification copy, short acknowledgements — fast, cheap
- Potential upgrade to Opus for complex multi-step reasoning (e.g. synthesising across 20+ positions)

**Grounding and retrieval:**
- Deterministic query engine (as in prototype) for all structured financial data — model never does portfolio math
- RAG layer (pgvector or Pinecone) for unstructured content: deal memos, LP updates, FAQ documents
- Tool use: Claude receives typed function results from the finance engine, not raw data

**Orchestration:** LangGraph or custom state machine for multi-turn flows (e.g. KYC onboarding is a 6-step flow with conditional branches depending on investor type)

**Evaluation:**
- Automated test suite: 150+ golden Q&A pairs per intent, assertions on exact figures
- LLM-as-judge: weekly runs where claude-opus-4-8 grades a random sample of production answers for accuracy, tone, and compliance
- Human review queue: low-confidence answers flagged for spot-check by investor ops

**Observability:**
- Langfuse or Helicone for prompt/response tracing
- Alert on: answer latency >3s, model refusals, low-confidence intent classifications, any PII in logs

### Security
- PII in prompts: investor name only, never email/phone/bank details in model context
- Role-based data scoping enforced at DB query level, not just API layer
- API key rotation: monthly, automated via secrets manager
- GDPR compliance: right-to-erasure removes investor data from Redis cache and logs within 72h

---

## Data and integrations

| System | Integration type | Data flowing in |
|---|---|---|
| Portfolio ledger (internal) | Read-only SQL | Allocations, capital calls, fees, distributions, valuations |
| Fund admin (Carta, Assure, or custom) | API sync (nightly) | NAV marks, quarterly reports, capital call schedules |
| CRM (HubSpot or Salesforce) | Bidirectional | Investor contact, relationship notes, comms history |
| KYC/AML (Persona, Jumio) | Webhook | KYC status updates, document approvals |
| E-signature (DocuSign or Dropbox Sign) | Webhook | Document completion events |
| Email/comms (SendGrid or Postmark) | Outbound | Fee reminders, capital call notices, AI-drafted updates |
| iOS push (APNs) | Outbound | Proactive nudges, due-date alerts |
| Valuation data | Internal mark engine | Latest share prices, MOIC updates |

**Data flow for proactive nudges:**
1. Temporal scheduler scans the DB for events in the next 14 days (capital calls, fee due dates, KYC expiry)
2. For each event, generates a personalised notification using haiku-4-5 with the investor profile
3. Sends via APNs (if mobile) or email (if not opted in to push)
4. Logs to audit trail

---

## AI approach and safety

**Deterministic vs model:**
- All financial numbers: deterministic code only
- Intent classification: keyword rules + lightweight model for ambiguous cases
- Response phrasing, notification copy, comms drafting: model
- Multi-step flows (KYC, onboarding): state machine, model only for language

**Guardrails:**
- Hard system-prompt rule: "Do not give investment advice, predictions, or recommendations. If asked, redirect to the investor's relationship manager."
- Input/output filtering: scan for PII exfiltration attempts, prompt injection patterns
- Confidence scoring: if the finance engine returns no data for a query, the model says "I don't have that information" rather than guessing
- No hallucination of positions: if a company is not in the investor's allocation, the model cannot discuss it as if it is

**Compliance:**
- Audit trail: every AI-generated message stored with full prompt context, model version, timestamp, and investor ID
- No financial advice: explicit prohibition in system prompt and enforced by output classifier
- GDPR: investor data never leaves the EU region when serving EU investors

---

## Team and hiring

| Role | When | Why |
|---|---|---|
| Senior Full-Stack (iOS + Next.js) | Day 1 | Own the iOS integration and portfolio UI |
| Senior AI/ML Engineer | Day 1 | Own the prompt pipeline, evaluation harness, and model selection |
| Backend Engineer (TypeScript) | Month 1 | Finance engine hardening, database layer, integrations |
| Product Designer | Month 1 | Conversation UX, notification design, investor trust signals |
| QA / AI Evaluation Specialist | Month 2 | Build and run the golden dataset evals, human review queue |
| Compliance Analyst (part-time contractor) | Month 2 | Review bot responses for regulatory risk, approve comms templates |
| DevOps / Platform Engineer | Month 3 | Production infrastructure, observability, secrets management |

Total: 6 FTE + 1 part-time contractor. Senior-heavy because AI product quality is determined almost entirely by the judgment of the people building the prompts and evals.

---

## Timeline

### Month 1 — Foundation
- Production database (Postgres) replacing CSV files
- Auth and investor isolation at DB query level
- Extend prototype: streaming, persistent chat history, mobile-responsive web
- Fund admin integration (read-only sync for live marks and capital calls)
- CI: next build + golden dataset eval suite (50 test cases)

**Ships:** Closed beta on web for 5–10 pilot investors

### Month 2 — Proactive layer
- Capital call and fee reminder push notifications (iOS + email)
- KYC status nudges and document request flow (e-signature integration)
- Multi-turn conversation state (clarification, follow-up questions)
- Evaluation harness expanded to 150 test cases; LLM-as-judge weekly runs
- CRM integration (investor contact sync)

**Ships:** iOS beta on TestFlight for pilot investors

### Month 3 — Onboarding and comms
- Full investor onboarding flow (KYC → bank account → first commitment)
- Internal comms drafting tool (relationship manager use case)
- Quarterly investor letter generation
- Compliance review of all bot-generated communication templates
- Observability: Langfuse tracing, latency alerts, PII scanning

**Ships:** iOS v1.0 to App Store (invite-only)

### Month 4 — Scale and quality
- Expand to all investors (full rollout)
- RAG layer for deal memos and unstructured LP updates
- A/B test haiku vs sonnet for notification copy (cost optimisation)
- Human review queue in investor ops dashboard
- Automated weekly LLM-judge report to product team

**Ships:** General availability to all EquiTie investors

### Month 5 — Intelligence
- Proactive portfolio insights ("Your Forgecraft position is now 3× — here's what that means for your overall MOIC")
- Cross-portfolio sector analysis and concentration alerts
- Fee optimisation nudges ("You're paying full admin fee on 8 deals — your RM can discuss bulk discounts")
- Upgrade highest-frequency Q&A pathways to streaming responses

**Ships:** Insights feed in iOS app

### Month 6 — Hardening and roadmap
- Security audit and penetration test
- GDPR right-to-erasure implementation
- Cold start elimination (Redis warming, edge deployment)
- Document the production runbook
- Retrospective: which capabilities drove the most investor engagement and RM time-saving

**Ships:** Production v2.0, internal roadmap for next 6 months

---

## Risks and costs

### Key risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Model hallucination on financial data | Low (deterministic engine) | Golden evals, LLM-as-judge, hard constraints in system prompt |
| Investor trust: "I don't want a bot" | Medium | Transparent disclosure, always-available human escalation, opt-out |
| Regulatory: AI giving investment advice | Medium | Hard prohibition in prompt, output classifier, compliance review |
| Data breach / PII in logs | Low-Medium | PII filtering, EU region for EU data, audit trail |
| Fund admin API unreliability | Medium | Nightly sync with fallback to last-known-good mark |
| iOS App Store review | Low-Medium | Build compliance into UX from day 1, avoid anything that reads as "financial advice" |

### Build vs buy

| Decision | Choice | Reason |
|---|---|---|
| LLM | Build on Claude API | Best quality for long-form investor comms; compliance-friendly DPA available |
| KYC/AML | Buy (Persona) | Regulatory complexity too high to build; Persona has bank-grade compliance |
| E-signature | Buy (DocuSign) | Market standard, investor familiarity, legal enforceability |
| Fund admin | Integrate (Carta or similar) | Integration vs build is obvious; fund admin is a solved problem |
| Evaluation | Build | Custom eval harness is the key differentiator for quality; no off-the-shelf tool fits the financial Q&A domain |
| Push notifications | Build on APNs/FCM | Simple enough to own directly |
| Orchestration | Build lightweight state machine | LangGraph is powerful but overkill for 6 well-defined flows; simpler to own and debug |

### Rough cost shape (monthly at steady state)

| Item | ~Monthly cost |
|---|---|
| Anthropic API (claude-sonnet-4-6, ~5k queries/day) | $2,000–4,000 |
| Infrastructure (Vercel, RDS, Redis, S3) | $1,500–3,000 |
| Persona KYC | $1,000–2,000 (per-check pricing) |
| DocuSign | $500–1,000 |
| Observability (Langfuse, Datadog) | $500–1,000 |
| **Total** | **~$6,000–11,000/month** |

Team cost (6 senior engineers, London market): ~£800k–£1M/year fully loaded.

At 200 active investors using the assistant daily, infrastructure cost per investor per month is under £30. The RM time-saving (est. 2–3 hours/week per investor) more than pays for it.
