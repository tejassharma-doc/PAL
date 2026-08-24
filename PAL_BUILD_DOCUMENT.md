# PAL — Complete Build Document
**Personal AI Life · Health Record + Universal Health Search**
*As of 2026-06-23*

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Infrastructure & Environment](#4-infrastructure--environment)
5. [Database Schema](#5-database-schema)
6. [PHI Safety Layer](#6-phi-safety-layer)
7. [Backend API — Routers](#7-backend-api--routers)
8. [Backend Services](#8-backend-services)
9. [Universal Health Search Pipeline](#9-universal-health-search-pipeline)
10. [Hermes Voice Agent — Booking Call System](#10-hermes-voice-agent--booking-call-system)
11. [On-Device ML Workers](#11-on-device-ml-workers)
12. [Frontend](#12-frontend)
13. [Admin Dashboard](#13-admin-dashboard)
14. [Feature Flags](#14-feature-flags)
15. [Six Non-Negotiable Invariants](#15-six-non-negotiable-invariants)
16. [Deployment](#16-deployment)

---

## 1. Project Overview

PAL (Personal AI Life) is a patient-owned health record and AI search application. Patients store their health facts, query them with natural language, and book appointments — all through a single mobile-first interface.

**Key design choices:**

- **Patient-first ownership** — raw health records are immutable; AI never rewrites source documents
- **PHI by default-deny** — no cross-member data without an active consent grant
- **Human-in-the-loop** — the AI proposes actions (bookings, medication changes); the patient confirms with a one-time HMAC token
- **Dual deployment modes** — `self_hosted` (single patient, BYO API key) and `institutional` (operator key, multi-tenant, RBAC)
- **Graceful degradation** — every AI path has a deterministic fallback; every on-device worker has a cloud fallback

**Origin:** Formerly "OwnChart." Renamed PAL; institutional tenancy layer added. DocEHR (clinic EHR) and iNutriMon (nutrition platform) connect later via MCP.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Patient (Browser / PWA)                  │
│                    Next.js 15  · port 3003                   │
│  Web Workers: Whisper STT · SmolLM2 Classifier · EHR Summary│
└───────────────────┬─────────────────────────────────────────┘
                    │  /api/[...proxy] → FastAPI
┌───────────────────▼─────────────────────────────────────────┐
│                  FastAPI  · port 8000                         │
│  Routers: auth · records · search · calls · appointment ···  │
│  PHI Layer: phi_guard · consent_registry · egress_control    │
│  Hermes Orchestrator (Universal Health Search)               │
│  ├── Planner (deterministic)                                 │
│  ├── 5 Agents (Records · Medication · Evidence · Diet · Appt)│
│  ├── Synthesizer (Sonnet)                                    │
│  └── Hindsight / pgvector RAG                               │
│  Hermes Voice Agent (booking call)                           │
│  ├── DocEHR Agent (Haiku + MCP / REST / stub)               │
│  └── Speculative prefetch cache                              │
└──────┬──────────────────────┬───────────────────────────────┘
       │                      │
┌──────▼──────┐    ┌──────────▼──────────┐
│  Postgres   │    │    Redis             │
│  + pgvector │    │  Semantic cache 24h  │
│  + pg_trgm  │    │  (cosine ≥ 0.92)     │
└─────────────┘    └─────────────────────┘
       │
┌──────▼──────────────────────────────────┐
│  Vectorize.io Hindsight  (optional)      │
│  semantic + BM25 + graph + temporal RAG  │
│  fallback → pgvector ANN                 │
└──────────────────────────────────────────┘
```

**External AI calls:**

| Tier | Model | Used for |
|------|-------|---------|
| Fast / cheap | `claude-haiku-4-5-20251001` | Greeting turns, Haiku fast-path, DocEHR Agent (MCP mode), Diet Agent, on-device fallback |
| Clinical | `claude-sonnet-4-6` | Medication agent, synthesizer, Sonnet tool-use loop, second opinion |

---

## 3. Technology Stack

### Backend

| Layer | Technology |
|-------|-----------|
| Web framework | FastAPI 0.115.5 |
| ASGI server | Uvicorn |
| ORM | SQLAlchemy 2.0 async + asyncpg |
| Migrations | Alembic |
| Database | PostgreSQL 16 + pgvector + pg_trgm |
| Cache | Redis 7 |
| Task queue | Celery |
| AI SDK | Anthropic Python SDK 0.40 |
| Cloud AI fallback | Amazon Bedrock (boto3) |
| Vector store | pgvector (native), Vectorize.io Hindsight (optional) |
| Semantic cache | sentence-transformers + Redis |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| File storage | Local disk, content-addressed by SHA-256 |
| File type detection | python-magic + libmagic |
| HTTP client | httpx |

### Frontend

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.1.0 (App Router) |
| Language | TypeScript 5.7 |
| State | Zustand 5 |
| Data fetching | SWR 2 |
| UI components | Radix UI (Dialog, DropdownMenu, ScrollArea, Toast, Tooltip) |
| Styling | Tailwind CSS 3.4 + inline design tokens |
| PWA | next-pwa |
| Native shell | Capacitor 8 (Camera, Push Notifications) |
| On-device ML | @huggingface/transformers 4.2 (ONNX Runtime Web) |
| Icons | Lucide React |

### On-Device ML Models

| Model | Size | Purpose |
|-------|------|---------|
| whisper-small (ONNX) | ~244 MB | Speech-to-text, 99 languages |
| SmolLM2-360M-Instruct (ONNX) | ~360 MB | English intent classifier |
| multilingual-e5-small (ONNX) | ~117 MB | Multilingual intent + scope classifier |
| SmolLM2-1.7B-Instruct (ONNX q4f16) | ~1.7 GB | On-device EHR summarization |

---

## 4. Infrastructure & Environment

### Docker Compose Services

| Service | Image | Port | Role |
|---------|-------|------|------|
| `db` | pgvector/pgvector:pg16 | 5432 | Primary database with pgvector and pg_trgm |
| `redis` | redis:7-alpine | 6379 | Semantic cache and Celery broker |
| `api` | ./api (Dockerfile) | 8000 | FastAPI backend, hot-reload in dev |
| `worker` | ./api (Dockerfile) | — | Celery worker for async tasks |
| `web` | ./web (Dockerfile) | 3000 | Next.js frontend |

Volumes: `pgdata`, `redisdata`, `uploads`

### Environment Variables

```ini
# Database
POSTGRES_USER=pal
POSTGRES_PASSWORD=pal_secret
POSTGRES_DB=pal

# Redis
REDIS_URL=redis://localhost:6379/0

# Feature flags
DEPLOYMENT_MODE=self_hosted        # or institutional
AI_KEY_MODE=byo                    # or operator
MULTI_USER=false
FAMILY_RELATIONSHIPS=false
ADMIN_DASHBOARD=true
UNIVERSAL_SEARCH=true

# AI (BYO mode — patient provides their own key)
ANTHROPIC_API_KEY=

# AI (operator/institutional mode)
OPERATOR_ANTHROPIC_API_KEY=
OPERATOR_AI_PROVIDER=anthropic     # or bedrock
OPERATOR_BEDROCK_REGION=ap-south-1

# Security
SECRET_KEY=change_in_prod
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30

# Vectorize.io Hindsight (optional enhanced memory)
HINDSIGHT_ENABLED=false
HINDSIGHT_LLM_PROVIDER=anthropic
HINDSIGHT_LLM_MODEL=claude-haiku-4-5-20251001
HINDSIGHT_LLM_API_KEY=            # falls back to ANTHROPIC_API_KEY

# DocEHR integration (priority: MCP > REST > stub)
DOCEHR_ENABLED=false
DOCEHR_URL=                        # e.g. http://docehr.internal
DOCEHR_MCP_URL=                    # e.g. https://docehr.internal/mcp

# On-device ML (Next.js public)
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_DISABLE_WORKERS=false

# Semantic cache
SEMANTIC_CACHE_MODEL=all-MiniLM-L6-v2
```

### Database Migrations (Alembic)

| Revision | Description |
|----------|-------------|
| `0001_initial.py` | Core schema: tenants, users, memberships, consent, health records, conversations, audit |
| `0002_appointment_requests.py` | Appointment requests table with HMAC-gated status enum |
| `0003_add_user_preferred_language.py` | `preferred_language` column on users (BCP-47, nullable) |
| `0004_otp_auth.py` | Passwordless OTP: makes email/password optional, adds phone + otp_sessions |
| `0005_call_sessions.py` | Call sessions table for Hermes Voice Agent multi-turn calls |

---

## 5. Database Schema

### Core Tables

**`tenants`**
Deployment unit. Holds `deployment_mode`, `privacy_mode`, BAA flag, `operator_key_config` (JSONB), `daily_token_budget`, `age_of_majority_days` (default 6570 = 18 years).

**`users`**
Patient identity. Email/phone/password are all optional (OTP-first auth). Columns: `phone`, `phone_verified`, `byo_key_configured`, `standing_personalize_consent`, `preferred_language`. Partial unique index on `phone` (WHERE phone IS NOT NULL).

**`tenant_memberships`**
M:N join: user ↔ tenant with `TenantRole` (patient / family_member / clinician / nutritionist / operator_admin / operator_security / operator_staff).

**`otp_sessions`**
10-minute TTL, 6-digit code stored as SHA-256 hash, 3-attempt max, `used_at` timestamp.

**`member_relationships`**
Typed edges between members: SPOUSE / PARENT_OF / CHILD_OF.

**`consent_grants`**
Scoped consent: `basis` (standing / session), `dossier_types`, `scope`, `expiry`. Full history kept; every grant/revoke audited.

**`raw_sources`**
Immutable health documents. Content-addressed by SHA-256. Fields: `content_hash`, `mime_type`, `source_type`, `is_imaging`, `is_document`.

**`health_facts`**
Extracted facts from raw sources. `pgvector` embedding (1536-dim). Fields: `fact_type`, `value`, `unit`, `evidence_class`, `effective_date`.

**`conversations` + `conversation_turns`**
Thread storage for Universal Health Search. Turns have `role` (user/assistant), `contains_phi` flag, `embedding`, `citations` (JSONB).

**`appointment_requests`**
HMAC-gated actions. Fields: `action_type` (booking/messaging), `status` enum (pending/dispatched/confirmed/cancelled), `slot_id`, `confirm_token_hash`.

**`call_sessions`**
Multi-turn Hermes voice call state. Fields: `status` (ringing/active/ended/missed), `call_state` (greeting/scheduling/lab_check/confirming/ended), `transcript` (JSONB), `appointment_booked`, `started_at`, `ended_at`.

**`model_run_audits`**
Append-only. Every AI API call logged: `model`, `agent_name`, `input_token_count`, `output_token_count`, `latency_ms`. Never stores API keys or PHI content.

**`phi_audit_logs`**
Append-only. Every PHI access decision: `accessor_id`, `target_member_id`, `action`, `decision`, `basis`, `occurred_at`. Readable only by `operator_security` role.

---

## 6. PHI Safety Layer

The PHI layer (`api/phi/`) enforces data access rules independently of business logic. It sits between routers and the database.

### Components

**`phi/guard.py` — PHIAccessContext / phi_guard()**
Three-stage access resolution:
1. Self-access → allowed
2. Operator roles (admin, security, staff) → denied (operators never see patient data)
3. Check `ConsentRegistry` for a live grant

Raises `HTTP 403` with a structured error on denial.

**`phi/consent.py` — ConsentRegistry**
- `grant(member_id, target_id, scope, basis, dossier_types, expiry)` — creates ConsentGrant
- `revoke(grant_id)` — sets `revoked_at`; full history preserved
- `get_live_grants_for_member()` — filters by expiry and revocation
- `expire_session_grants()` — called at session end to revoke `session` basis grants

**`phi/egress.py` — EgressControl**
Checks whether a retrieved fact is permitted to leave the system. `strict` mode always denies; `session_consent` / `standing_consent` allow. Every decision written to PHI audit log.

**`phi/audit.py` — PHIAudit**
Raw SQL INSERT into `phi_audit_logs`. Never records secrets, prompt text, or PHI content — only metadata (who, what action, what decision, when).

**`phi/isolation.py` — TenantScope**
Structural query filters: `apply()`, `member_scope_filter()`, `tenant_and_member_filter()`. Ensures every DB query is scoped to the correct tenant + member.

---

## 7. Backend API — Routers

All routers are registered in `api/main.py`. The Next.js frontend proxies everything through `/api/[...proxy]` → FastAPI at port 8000.

### `POST /auth/register` · `POST /auth/token` · `GET /auth/me`
Email + password auth. Returns JWT. `GET /me` returns user profile.

### `POST /auth/request-otp` · `POST /auth/verify-otp`
Passwordless phone OTP flow.
- `request-otp`: generates 6-digit OTP, SHA-256 hashed, console-delivered in dev (returns `dev_otp` key), 10-minute TTL.
- `verify-otp`: up to 3 attempts; on success, upserts user by phone, returns `is_new_user` + `has_ehr` flags, issues JWT.

### `GET /records/facts`
Returns patient health facts filtered by `fact_type`. PHI-guarded (phi_guard enforces consent). Every access written to PHI audit log.

### `POST /records/upload`
Multipart form upload (max 20 MB). Classifies content:
- Imaging (DICOM, X-ray heuristics) → returns `imaging_declined` with explanation
- Document (PDF, text, etc.) → SHA-256 stored to disk, writes `RawSource` row, returns `document_accepted`

### `GET /conversations/{tenant_id}/{member_id}` · `GET .../turns` · `DELETE ...`
Conversation history CRUD. Delete also purges Hindsight thread.

### `POST /search`
Universal Health Search pipeline (requires `UNIVERSAL_SEARCH=true`). See Section 9.

### `POST /search/second-opinion`
Forces Sonnet model tier and wider PubMed search (8 results instead of 5). Returns answer with provenance badge "Second look."

### `POST /search/confirm-action`
HMAC token validation. Verifies `HMAC-SHA256(secret, "{session_id}|{action_type}|{canonical_json_payload}")` using `hmac.compare_digest`. On success, writes `AppointmentRequest` with status=dispatched.

### `POST /appointment/slots` · `POST /appointment/book` · `POST /appointment/message` · `POST /appointment/voice`
DocEHR appointment flow. Book and message require HMAC confirm tokens. Voice endpoint takes patient speech transcript, runs AppointmentAgent, returns proposed_actions + available_slots.

### `POST /calls/initiate` · `POST /calls/{id}/turn` · `GET /calls/{id}` · `POST /calls/{id}/end`
Hermes Voice Agent multi-turn call API. See Section 10.

### `GET /admin/*` (requires `ADMIN_DASHBOARD=true` + operator role)
- `/admin/stats` — tenant usage metrics
- `/admin/users` — user list + invite
- `/admin/audit` — paginated + filterable PHI audit log
- `/admin/audit/export` — CSV streaming export
- `/admin/model-runs` — ModelRunAudit log
- `/admin/settings` — tenant configuration

### `POST /follow-up/preflight` · `POST /follow-up/complete` · `POST /follow-up/dispatch`
Pre-visit interview flow. Preflight checks: existing bookings, mic availability, time-of-day routing (patients ≤60: before 10:00 or after 18:00 UTC; patients >60: before 12:00 UTC).

---

## 8. Backend Services

### Auth (`services/otp.py`)
6-digit OTP via `secrets.randbelow`, SHA-256 hashed before storage. Mock console delivery in development. 10-minute expiry. 3-attempt maximum enforced at OTPSession row level.

### Action Tokens (`services/action_token.py`)
Stateless HMAC-SHA256 confirm tokens. Format: `HMAC(secret_key, "{session_id}|{action_type}|{canonical_json_payload}")`. `generate_confirm_token()` and `validate_confirm_token()` use `hmac.compare_digest` to prevent timing attacks.

### AI Provider (`services/ai_provider.py`)
- `HAIKU = "claude-haiku-4-5-20251001"`, `SONNET = "claude-sonnet-4-6"`
- `model_for_agent()` — bumps to Sonnet on second-opinion requests
- `multilingual_suffix()` — appends language instruction for 14 Indian languages
- `get_ai_client()` — prioritises operator key over BYO key

### Semantic Cache (`services/cache/semantic_cache.py`)
- Embedding: `sentence-transformers/all-MiniLM-L6-v2` (lazy-loaded)
- Similarity threshold: cosine ≥ 0.92
- Storage: Redis hash, 24-hour TTL, 2000-entry limit per bucket
- Scope: diet agent, evidence agent, medication agent responses only

### Hindsight RAG (`services/hindsight/`)
Two implementations selected by `HINDSIGHT_ENABLED` flag:

**pgvector fallback (`hindsight.py`):** Always available.
- `retrieve_relevant_slice()` — pgvector ANN search on conversation embeddings; recency fallback when no embeddings
- `update_summary()` — rolling 2000-character conversation summary
- `purge_thread()` — nulls embeddings, cascade-deletes turns

**Vectorize.io (`vectorize_hindsight.py`):** Active when `HINDSIGHT_ENABLED=true`.
- FastAPI lifespan hook starts/stops HindsightServer
- Banks: `patient-{member_id}` (long-term) and `conversation-{conversation_id}` (thread)
- Capabilities: semantic + BM25 + graph + temporal RAG
- Falls back to pgvector if Vectorize.io unreachable

### DocEHR Client (`services/docehr/docehr_client.py`)
Stub by default (returns Dr. Rao at City Clinic OPD, 3 realistic slots). When `DOCEHR_ENABLED=true` + `DOCEHR_URL` set, makes real HTTP calls to the DocEHR REST API.

Methods: `get_available_slots()`, `book_appointment()`, `send_clinic_message()`, `get_patient_context()`.

---

## 9. Universal Health Search Pipeline

**Entry:** `POST /search` → `HermesOrchestrator.handle()`

The pipeline runs 6 deterministic stages before any LLM call touches the query.

### Stage 1 — Keyword Safety Triage
Hard-coded keyword list check. Emergency phrases (chest pain, suicidal, stroke) → immediate `EMERGENCY_REFERRAL` response with no AI calls, no PHI loaded.

### Stage 2 — Intent Classification
Priority order:
1. On-device SmolLM2 result (if `on_device_classification_json` passed from the classifier worker)
2. Multilingual-e5-small result (if passed)
3. Cloud Claude Haiku fallback

Output: `agent` name + `confidence` score + `scope` (general / personal).

### Stage 3 — Scope Gate
If `scope == "personal"`, PHI guard runs. Consent check → if no live grant, returns consent-request card (not an error). Patient can grant session consent inline.

### Stage 4 — Deterministic Planner
`planner.plan()` — no LLM call. Routes to one or many agents based on intent confidence:
- `HIGH_CONFIDENCE (≥ 0.75)` → single target agent
- Lower confidence → multi-agent fan-out
- Medication queries always add the evidence agent

### Stage 5 — Agent Context Assembly
For personal queries: Hindsight RAG slice loaded (conversation history + patient facts). Semantic cache checked. PHI egress control enforced.

### Stage 6 — Parallel Agent Fan-Out
All planned agents run concurrently via `asyncio.gather`. Each agent is a self-contained Claude call.

| Agent | Model | Purpose |
|-------|-------|---------|
| RecordsAgent | Haiku | Patient health facts via Hindsight / pgvector |
| MedicationAgent | Sonnet (always) | Drug safety, interactions, clinical analysis |
| EvidenceAgent | Haiku | PubMed E-utilities search (5 results; 8 on second opinion) |
| DietAgent | Haiku | Nutrition recommendations + iNutriMon integration |
| AppointmentAgent | Haiku | Template-engine booking (0 LLM calls for complete slots) |

### Stage 7 — Synthesis
`claude-sonnet-4-6` synthesizer. Enforces the evidence contract. Returns:
```json
{
  "answer_text": "...",
  "evidence_classes": ["source_backed", "inferred"],
  "citations": [...],
  "pending_actions": [...],
  "provenance_summary": "...",
  "clinical_disagreement": null
}
```

### Stage 8 — Hindsight Update
Writes user turn + assistant turn to Hindsight asynchronously. Failure to write does NOT fail the search response.

### Stage 9 — Second Opinion (optional)
`POST /search/second-opinion` re-runs the pipeline with:
- Model bumped to Sonnet for all agents
- EvidenceAgent fetches 8 PubMed results instead of 5
- Synthesizer adds provenance badge "Second look"
- Hindsight `reflect()` called if available

---

## 10. Hermes Voice Agent — Booking Call System

The voice booking system lets patients receive an in-app AI call to schedule appointments with their doctor. The system is a multi-turn state machine with speculative prefetching to minimise perceived latency.

### System Components

```
CallOrchestrator          (api/services/hermes/call_orchestrator.py)
├── HermesVoiceAgent      (api/services/agents/hermes_voice_agent.py)
│   └── _PREFETCH_CACHE   (module-level dict, no Redis dependency)
└── DocEHRAgent           (api/services/agents/docehr_agent.py)
    ├── MCP path          (Anthropic native MCP beta)
    ├── REST path         (DocEHRClient HTTP)
    └── Stub path         (default, realistic mock data)
```

### SOP State Machine

```
greeting → scheduling → lab_check → confirming → ended
```

| State | What Hermes does |
|-------|-----------------|
| `greeting` | Identifies the patient, confirms they can talk |
| `scheduling` | Presents available slots from DocEHR; negotiates time |
| `lab_check` | Explains lab requirements (fasting, test type) |
| `confirming` | Reads back booking details; confirms with patient |
| `ended` | Warm farewell; call closes |

### Latency Architecture — Speculative Prefetch + Haiku Fast-Path

**Problem:** A naive implementation does 2 Sonnet calls per turn (~7 s). Unacceptable for voice.

**Solution:** Three-tier fast-path:

| Tier | Latency | Condition |
|------|---------|-----------|
| 1. Haiku + prefetch hit | ~0.8 s | DocEHR result ready in cache |
| 2. Haiku conversational | ~0.8 s | Greeting / farewell (no tools needed) |
| 3. Sonnet tool-use loop | ~7 s | Cache miss; booking turn |

**Prefetch logic:**
- At `start_call()`: immediately fires `check_availability` as `asyncio.create_task()` in the background
- After `scheduling` turn with `appointment_agreed=true`: fires `check_lab_requirements` in the background
- Patient spends 5–15 s reading and typing → prefetch completes in <50 ms (stub) or ~300 ms (real DocEHR)
- On next turn: `_drain_prefetch()` returns the cached result; HermesVoiceAgent uses compact Haiku system prompt

**Effective latency per call:**
- Turn 1 (greeting): ~0.8 s
- Turn 2 (slots): ~0.8 s perceived (prefetch done)
- Turn 3 (labs): ~0.8 s perceived (prefetch done)
- Turn 4 (booking): ~7 s (Sonnet required — confirms booking)
- Turn 5 (farewell): ~0.8 s

### DocEHR Agent — Three Operating Modes

**Priority order: MCP > REST > stub**

**MCP mode** (when `DOCEHR_MCP_URL` is set):
Uses Anthropic's native MCP client beta (`betas=["mcp-client-2025-04-04"]`). DocEHR Agent becomes Claude Haiku with real DocEHR MCP tools wired in. True A2A: Hermes → DocEHR Agent (Haiku + MCP) → DocEHR EHR.
```python
resp = await ai.beta.messages.create(
    model=HAIKU,
    betas=["mcp-client-2025-04-04"],
    mcp_servers=[{"type": "url", "url": docehr_mcp_url, "name": "docehr"}],
    ...
)
```

**REST mode** (when `DOCEHR_ENABLED=true` + `DOCEHR_URL` set):
DocEHRClient makes HTTP calls to the DocEHR REST API endpoints.

**Stub mode** (default, no env vars):
Realistic in-memory mock. Returns Dr. Rao at City Clinic OPD, 3 available slots, Lipid Profile lab requirement.

### Call API Endpoints

| Endpoint | Action |
|----------|--------|
| `POST /calls/initiate` | Creates CallSession, fires availability prefetch, returns Hermes greeting |
| `POST /calls/{id}/turn` | Patient input → Hermes response; drains prefetch cache; persists transcript; fires next prefetch |
| `GET /calls/{id}` | Session state read |
| `POST /calls/{id}/end` | Marks ended; cleans up prefetch entries |

### Screen Reading & Speaker Mode

When DocEHR returns visual data (slot times, lab instructions, booking confirmation), the UI:

1. Injects a `speaker_suggest` turn into the transcript — a jade-tinted banner: "🔊 Switch to Speaker · Read instructions while staying on the call."
2. Shows an **Enable** button that sets `speakerOn = true`
3. Header shows 📱 Earpiece / 🔊 Speaker pill toggle (active pill highlighted in jade)
4. Banner only appears when `speakerOn === false` and DocEHR returned data that turn
5. On `End call`: `setSpeakerOn(false)` resets for the next session

**System prompt rule (in Hermes SOP):**
> "Whenever you are about to share information the patient must read on their screen — slot times, lab preparation instructions, or a booking confirmation — say this first: 'I have some information for you to read on your screen. To make it easier to read and listen at the same time, please go ahead and put this call on speakerphone.' Then PAUSE."

### Cost Per Call (Estimated)

| Component | Model | Input tokens | Output tokens | Cost |
|-----------|-------|-------------|--------------|------|
| Hermes greeting | Haiku | ~500 | ~120 | $0.00008 |
| DocEHR availability | Haiku | ~300 | ~80 | $0.00005 |
| Hermes slots (fast-path) | Haiku | ~400 | ~150 | $0.00009 |
| DocEHR labs | Haiku | ~300 | ~80 | $0.00005 |
| Hermes labs (fast-path) | Haiku | ~400 | ~150 | $0.00009 |
| Hermes booking | Sonnet | ~1200 | ~300 | $0.00540 |
| Hermes farewell | Haiku | ~400 | ~100 | $0.00007 |
| **Total per call** | | | | **~$0.006** |

*At scale: 1000 calls/day ≈ $6/day ≈ $180/month. MCP mode adds ~1-2 extra Haiku calls per DocEHR tool round (~$0.001 per call extra).*

---

## 11. On-Device ML Workers

All workers run in browser Web Workers (isolated threads). The main thread communicates via `postMessage`. Workers are warmed up at app startup by `Preloader.tsx` on eligible pages.

Device capability gating (`lib/deviceCapabilities.ts`) runs once at startup and picks a model tier (none / low / mid / high) based on available RAM and GPU. Prevents thermal throttling on devices with ≤3 GB RAM.

### Whisper STT Worker (`lib/sttWorker.ts`)

- Model: `onnx-community/whisper-small` (244 MB, 99 languages)
- Captures microphone audio, runs Whisper transcription
- Detects script to identify language (Devanagari, Tamil, etc.)
- Returns: `{ text, language, is_indian_language }`
- `is_indian_language = true` bypasses SmolLM2 (routes to multilingual classifier instead)

### SmolLM2 Intent Classifier (`lib/classifierWorker.ts`)

- Model: `HuggingFaceTB/SmolLM2-360M-Instruct` (360 MB, ONNX, WebGPU → WASM fallback)
- Classifies English PAL queries into 5 agent intents: records / medication / appointment / diet / evidence
- Returns: `{ agent, confidence }` or null on failure
- Cloud fallback: server-side Claude Haiku classification

### Multilingual-e5 Classifier (`lib/multilingualClassifierWorker.ts`)

- Model: `intfloat/multilingual-e5-small` (117 MB, 100+ languages)
- Embeds representative phrases per agent class at init
- Cosine-similarity classification on incoming queries
- Returns: `{ agent, confidence, scope }` (scope: general / personal)
- Handles 14 Indian languages: Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Urdu, Odia, Assamese, Sanskrit, Kashmiri

### EHR Summary Worker (`lib/ehrSummaryWorker.ts`)

- Model: `HuggingFaceTB/SmolLM2-1.7B-Instruct` (1.7 GB, ONNX q4f16)
- Tasks: `lab_results`, `medications`, `visit`, `booking_slots`
- Grounded strictly in supplied structured data — never infers beyond provided fields
- No PHI egress: all processing stays on-device
- Upgrade path noted in types: Qwen2.5-1.5B, Phi-3.5-mini, Llama-3.2-3B

---

## 12. Frontend

### Main Application (`web/app/page.tsx`)

Single-page application (~1600 lines). Four tabs:

| Tab | Content |
|-----|---------|
| **Ask** | Search input, voice recording, quick-start questions, search results with agent roster/stream/quiet modes |
| **History** | Conversation threads from real API; click → real turns; delete → API call |
| **Record** | Health facts browser, document upload |
| **Visits** | Upcoming appointments, care team, "Book a call with Hermes" button |

**Key handlers:**

- `handleTextQuery` — runs SmolLM2 → multilingual classifier → `POST /search`; threads `conversation_id` for multi-turn
- `handleMicClick` — Web Speech API (mobile) or Whisper ONNX (desktop); routes STT result to `handleTextQuery`
- `handleConfirmAction` — posts HMAC confirm token to `/search/confirm-action`
- `handleSecondOpinion` — posts to `/search/second-opinion`, updates answer with "Second look" badge
- `handleUpload` — multipart POST to `/records/upload`; shows jade (accepted) or rose (imaging declined) card
- `handleInitiateCall` — calls `POST /calls/initiate`; falls back to demo mode on network error
- `handleCallTurn` — sends patient text to `POST /calls/{id}/turn`; injects `speaker_suggest` turn when DocEHR returns visual data

### Answer Display — Three Modes

Toggled by Roster / Stream / Quiet pills in the header:

| Mode | Display |
|------|---------|
| **Roster** | Agent cards with specialist names, evidence class badges, citations |
| **Stream** | Single reasoning line showing which agents ran |
| **Quiet** | Answer text only, minimal UI |

### PWA & Native

- `web/public/manifest.webmanifest` — PWA manifest (name, icons, display:standalone, theme_color: #37b59b)
- `app/layout.tsx` — apple-web-app meta tags, viewport themeColor
- `lib/native.ts` — Capacitor wrappers for Camera and Push Notifications; degrades to browser no-ops on web

### Onboarding (`web/app/onboarding/page.tsx`)

3-step OTP flow:
1. Language selection (15 languages with native script labels)
2. Phone number entry (10-digit Indian mobile)
3. OTP verification (6-digit code, 3 attempts, 10-minute window)

On success: writes `pal_token`, `pal_user_id`, `pal_preferred_lang` to localStorage; redirects to `/`.

Main page redirects to `/onboarding` if `pal_preferred_lang` is not set.

### API Client (`web/lib/api.ts`)

Typed HTTP client. Auth token from `localStorage.pal_token`. All endpoints wrapped as named async functions. Returns typed responses.

Key exports: `search()`, `secondOpinion()`, `confirmAction()`, `listConversations()`, `getConversationTurns()`, `deleteConversation()`, `initiateCall()`, `sendCallTurn()`, `endCall()`, `uploadDocument()`.

### State Management (`web/lib/store.ts`)

Zustand auth store: `{ token, userId, tenantId, preferredLang }`. `setAuth()`, `clearAuth()`, `hydrate()` (reads from localStorage on mount).

---

## 13. Admin Dashboard

Available when `ADMIN_DASHBOARD=true` and user has an operator role.

**Layout:** `app/admin/layout.tsx` — sidebar navigation (Overview, Users, Audit, Settings).

**Pages:**

| Page | Data source | Key features |
|------|-------------|-------------|
| Overview | `GET /admin/stats` | Token usage, active members, model-run counts |
| Users | `GET /admin/users` | User list + invite flow |
| Audit | `GET /admin/audit` | Paginated PHI audit log, filterable by date/member/action; CSV export |
| Settings | `GET /admin/settings` | Tenant configuration (deployment mode, privacy mode, BAA, token budget) |

**Security:** Audit and security routes require `operator_security` TenantRole. `operator_staff` role has read-only access to non-PHI data. PHI content never appears in audit logs — only access metadata.

---

## 14. Feature Flags

All flags are env vars, read by `api/config.py` (Pydantic Settings) and surfaced via `GET /health`.

| Flag | Default | Effect |
|------|---------|--------|
| `DEPLOYMENT_MODE` | `self_hosted` | `institutional` enables multi-tenant RBAC |
| `AI_KEY_MODE` | `byo` | `operator` uses operator key; patient never provides a key |
| `MULTI_USER` | `false` | Enables family member accounts and consent grants |
| `FAMILY_RELATIONSHIPS` | `false` | Enables SPOUSE / PARENT_OF / CHILD_OF edges |
| `ADMIN_DASHBOARD` | `false` | Enables `/admin/*` routes |
| `UNIVERSAL_SEARCH` | `false` | Enables `/search` routes (Hermes orchestrator) |
| `DOCEHR_ENABLED` | `false` | Uses real DocEHR REST API instead of stub |
| `HINDSIGHT_ENABLED` | `false` | Uses Vectorize.io instead of pgvector RAG |

All new features default to off. Existing behavior is exactly preserved when all flags are off.

---

## 15. Six Non-Negotiable Invariants

These are architectural constraints that cannot be compromised for any feature.

1. **Evidence contract** — Every AI-generated fact must carry one of: `source_backed` / `user_canonical` / `inferred` / `statistical` / `unknown`. No unlabelled claims.

2. **Immutable raw sources** — `RawSource` rows are never updated or deleted. Content-addressed by SHA-256. AI never rewrites source documents.

3. **Model-run audit** — Every AI API call is logged to `model_run_audits` (model, agent, token counts, latency). API keys and PHI content are never logged.

4. **Human-in-the-loop** — AI proposes actions; patients confirm. All confirmable actions require a one-time HMAC token validated server-side. No AI can autonomously book or message.

5. **Provenance** — "Why do you think that?" is always answerable. Every answer carries `provenance_summary` and `citations`. Synthesizer cannot confabulate PMIDs/DOIs.

6. **Default-deny PHI** — No cross-member PHI without a live `ConsentGrant`. PHI guard enforces this at every DB access. Operator roles are denied PHI access structurally, not by convention.

---

## 16. Deployment

### Development (local)

```bash
# Start all services
docker-compose up

# Or run individually:
# Backend (port 8000)
cd api && uvicorn main:app --reload --port 8000

# Frontend (port 3003)
cd web && npm run dev -- --port 3003
```

Backend is available at `http://localhost:8000`. API docs at `http://localhost:8000/docs`.

Frontend proxies all `/api/*` calls to FastAPI via `app/api/[...proxy]/route.ts`.

### Database Setup

```bash
# Run migrations
cd api && alembic upgrade head

# Seed development data (creates Anil Kumar patient)
cd api && python seed.py
```

### Enabling the Full Stack

Minimum `.env` for full functionality in development:
```ini
ANTHROPIC_API_KEY=sk-ant-...
ADMIN_DASHBOARD=true
UNIVERSAL_SEARCH=true
```

To enable Vectorize.io Hindsight:
```ini
HINDSIGHT_ENABLED=true
HINDSIGHT_LLM_API_KEY=vz-...   # or leave empty to use ANTHROPIC_API_KEY
```

To enable real DocEHR (REST):
```ini
DOCEHR_ENABLED=true
DOCEHR_URL=http://docehr.internal
```

To enable DocEHR via MCP (true A2A):
```ini
DOCEHR_MCP_URL=https://docehr.internal/mcp
```

### Production Notes

- Replace `SECRET_KEY` with a cryptographically random 64-byte hex string
- Set `ENVIRONMENT=production` and `DEBUG=false`
- Configure `OPERATOR_ANTHROPIC_API_KEY` for institutional deployments
- Set `DEPLOYMENT_MODE=institutional` and `AI_KEY_MODE=operator`
- Run Celery worker for background tasks: `celery -A services.worker worker --loglevel=info`
- The `uploads/` volume must be persistent and backed up (raw source documents)
- `pgdata` and `redisdata` volumes must be on persistent storage

---

*Document generated 2026-06-23. PAL is an illustrative interactive prototype. All names and data shown are fictional.*
