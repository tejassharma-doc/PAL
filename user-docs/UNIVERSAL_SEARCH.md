# PAL Universal Health Search — Pipeline & Policy Reference

## Fugu Router — On-Device Routing Brain

The Fugu Router is the single on-device decision point for every conversation
turn. It uses **one embedding forward pass** (multilingual-e5-small, 117 MB ONNX)
followed by cosine similarity against precomputed class centroids — **no text
generation, no sampling**. The routing decision is deterministic from the scores.

### What the Fugu Router does per turn

```
query + rolling thread_summary (≤ 500 chars from previous API response)
  → [sync, 0 ms]  SAFETY TRIAGE — keyword deterministic check
                   emergency/crisis keywords → immediate short-circuit
  → [async, ~50ms] embed(query) → Float32Array (384-dim)
                   dot products vs precomputed agent centroids
                   dot products vs precomputed complexity centroids
  → [sync] mergeSafety(keyword_result, model_safety_category)
           keyword always wins — model cannot downgrade a keyword-triggered flag
  → [sync] DepthRules(ClassificationOutput) → RouterDecision
           exact TypeScript mirror of api/services/hermes/planner.py
  → depth: on_device | one | many | launch_hermes
```

### Complexity Bucket

A new field added to every classification output. Drives the on-device depth
decision — computed in the same embedding forward pass as intent classification.

| Complexity | Signals | On-device action | Cloud calls |
|---|---|---|---|
| `trivial` | Greeting, thanks, meta ("what can you do?") | Static non-clinical answer | **Zero** |
| `simple` | Single intent, confidence ≥ 0.75 | Classify → send to ONE cloud agent | 1 agent |
| `complex` | Multiple intents, OR low confidence, OR safety-adjacent | Classify → fan out to MANY agents | ≥ 2 agents |
| `call` | Booking / clinic message intent (`needs_action = true`) | Classify → launch Hermes workflow | Hermes + confirm-token gate |

Complexity `trivial` is the **only** case where PAL answers without any cloud
call. The answer is a static non-clinical string (greetings, acknowledgements).
All clinical queries, regardless of complexity, go to a cloud agent.

### Thread-Summary Contract

After every non-trivial API response, the server returns:

```json
{
  "thread_summary_for_router": "<rolling 500-char compact summary>"
}
```

The mobile client stores this per `conversation_id` in AsyncStorage and
prepends it to the next query before the embedding call:

```
embed("[Context: <summary>] <query>")
```

This makes the Fugu Router context-aware across turns — complexity and intent
classification improve as the conversation progresses.

### Feature Flag

The Fugu Router is gated behind `UNIVERSAL_SEARCH` (default: `false`).
Set `UNIVERSAL_SEARCH=true` in your environment to enable it.
When disabled, no behavior change — existing routing is unchanged.

---

## Pipeline

```
query
  → [on-device] FUGU ROUTER (one forward pass — see above)
      trivial → on-device static answer, STOP (zero API calls)
      emergency/crisis → SafetyBanner, STOP (zero agents)
      otherwise → OnDeviceClassificationJson sent to backend
  → [backend] /api/v1/search receives classification JSON
  → [SCOPE GATE] personal? generic? ambiguous?
      ambiguous → ask ONE disambiguation question (do not load record on a guess)
  → [PLANNER — deterministic policy, no LLM] decide depth → agents to invoke
  → load record ONLY if personal (through PHI consent/egress gate)
  → fan-out in parallel to selected agents
  → SYNTHESIZER (Hermes, Claude cloud) → one answer
  → response includes thread_summary_for_router → stored on device
```

## Intent → Depth Policy Table

| Condition | Depth |
|---|---|
| Single intent, confidence ≥ 0.75, no safety/med/evidence trigger | **ONE agent** |
| Multiple intents OR any med/evidence intent present | **MANY agents** (parallel) |
| Low confidence (< 0.75) OR safety-adjacent (urgent) OR no intents | **ALL agents + cloud planner** |
| Emergency/crisis | **NO agents** — safety short-circuit |
| Ambiguous scope | **NO agents** — disambiguation first |

Bias: over-inclusion (more agents) preferred over under-inclusion when uncertain.

## Five Agents

| Agent | When invoked | Cloud reasoning? | PHI? |
|---|---|---|---|
| Records | personal scope only | No (read-only DB) | Yes — consent/egress gated |
| Medication & Adherence | always when medication intent | Yes (Claude) | Yes if personal |
| Appointment/Clinic | booking/messaging intent | Yes (Claude) | Yes if personal |
| Diet/Recipe | diet intent | Yes (Claude + iNutriMon MCP) | Yes if personal |
| Evidence | always when evidence intent or uncertainty | Yes (Claude + PubMed/bioRxiv) | No |

## Scope Gate Rules

| Scope | Record loaded? | PHI egress? |
|---|---|---|
| `generic` | **Never** | **Never** |
| `personal` | Yes — through consent/egress gate | Yes — if allowed by tenant privacy mode + consent basis |
| `ambiguous` | **Never** — ask disambiguation first | **Never** before disambiguation |

**Privacy-protective default:** when scope is ambiguous, treat as generic until patient opts in.

## Record-Context Consent

| Mode | Trigger | Behaviour |
|---|---|---|
| Per-session (default) | First personal query in conversation | Subsequent personal turns in same session inherit it |
| Standing "always personalise" | Explicit user opt-in (revocable, logged) | Persists across sessions |
| Per-query (strictest) | High-sensitivity tenant config | Every personal query requires fresh confirm |

Every record load is audited with: who, whose, scope, session, consent basis.

## Safety Triage Categories

| Category | Handling |
|---|---|
| `emergency` | Short-circuit: urgent-care guidance + emergency number. NO agents. |
| `crisis` | Short-circuit: supportive resources, crisis line. NO agents. |
| `urgent` | Route to ALL agents + cloud planner (over-include). |
| `routine` | Normal planner routing. |

Keywords trigger `emergency` or `crisis` **before** the small model runs.

## Confirm-Token Action Flow

1. Appointment/messaging agent proposes action.
2. Synthesizer surfaces it as a `pending_action` with `confirm_token_required: true`.
3. UI shows Confirm button.
4. Patient taps → `POST /search/confirm-action` with `confirm_token`.
5. Token validated server-side. Action dispatched. Never auto-sent.

## Hindsight Token Discipline

- **Record RAG not dump:** pgvector ANN retrieves relevant slice (top-K facts), never the whole chart.
- **Rolling summary:** compact running summary of the thread, not verbatim transcript.
- **On-device absorbs cheap turns:** triage, classification, light summary — never reach the cloud.
- **Prompt caching:** system/instruction scaffolding cached (not re-billed each call).
- **Complexity-tiered spend:** one-agent generic = small call; all-agents personal = full fan-out.

## Upload Policy

| Upload type | PAL behaviour |
|---|---|
| Document (lab report, prescription, discharge summary) | Stored → explained in plain language, non-diagnostically. Never prescribes or names a diagnosis. "Worth discussing with your doctor." |
| Imaging (DICOM, X-ray, CT, MRI, ultrasound, any image) | Stored → declines interpretation: "This needs a doctor or radiologist." Never interprets. |
| Unsure | Treated as imaging (more restrictive tier). |

## Second Opinion Escalation

- Available on every answer via "This doesn't seem right — get a second look."
- Re-runs with strongest model tier (higher Claude tier).
- Broader record pull (consent-gated).
- Re-grounds against Evidence agent (PubMed/bioRxiv).
- Shows what changed vs first answer.
- If clinical answers materially disagree → surfaces disagreement honestly + recommend clinician visit.
- Every escalation is logged (best signal for system errors).
