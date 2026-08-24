/**
 * FuguRouter — main orchestrator for on-device routing.
 *
 * Pipeline per turn:
 *   1. safetyTriage(query)                         — deterministic keywords, sync
 *   2. classify(query, threadSummary)               — ONNX forward pass, async
 *   3. mergeSafety(triage, cls.safety_category)     — keyword always wins
 *   4. applyDepthRules(cls)                         — deterministic rules
 *   5. Return RouterDecision                         — caller dispatches accordingly
 *
 * The router NEVER generates text. It only decides WHERE the turn goes.
 * On-device answers for trivial turns are simple static responses — not LLM output.
 */

import {initClassifier, classify} from './FuguClassifier'
import {safetyTriage, mergeSafety} from './SafetyTriage'
import {applyDepthRules} from './DepthRules'
import {threadSummary as threadSummaryStore} from './ThreadSummary'
import type {ClassificationOutput, FuguRouterInput, RouterDecision} from './types'

// ── Static trivial responses (non-clinical greetings only) ─────────────────
// These are the only on-device text outputs — no clinical content.
const TRIVIAL_RESPONSES: Record<string, string> = {
  // English
  hello: "Hello! I'm PAL, your personal health assistant. How can I help you today?",
  hi: "Hi! How can I help you today?",
  thanks: "You're welcome! Is there anything else I can help you with?",
  bye: "Goodbye! Take care.",
  default: "I'm here to help with your health questions. What would you like to know?",
}

function trivialAnswer(query: string): string {
  const q = query.toLowerCase().trim()
  if (/^(hello|hi|hey|namaste|vanakkam|namaskar)/.test(q)) return TRIVIAL_RESPONSES.hello
  if (/^(bye|goodbye|alvida|poitu varren)/.test(q)) return TRIVIAL_RESPONSES.bye
  if (/\b(thank|thanks|धन्यवाद|நன்றி|ధన్యవాదాలు|ধন্যবাদ|ありがとう)\b/.test(q)) return TRIVIAL_RESPONSES.thanks
  return TRIVIAL_RESPONSES.default
}

// ── Init ───────────────────────────────────────────────────────────────────

let initialised = false

/**
 * Call once at app launch (e.g. in App.tsx useEffect).
 * Builds ONNX session + precomputes all centroids.
 * Subsequent calls are no-ops.
 */
export async function initFuguRouter(): Promise<void> {
  if (initialised) return
  // initClassifier() catches its own ONNX errors and falls back to keyword mode.
  // Wrap here too so the app never crashes at launch due to missing model.
  try { await initClassifier() } catch {}
  initialised = true
}

// ── Main route() ───────────────────────────────────────────────────────────

/**
 * Route one conversation turn.
 * Returns a RouterDecision; caller decides how to dispatch based on `depth`.
 *
 * @param input - query + rolling thread_summary + ids
 * @param apiThreadSummaryUpdate - if the previous API response included
 *   `thread_summary_for_router`, pass it here to update storage before
 *   classification (so the updated summary feeds into the current turn).
 */
export async function route(
  input: FuguRouterInput,
  apiThreadSummaryUpdate?: string,
): Promise<RouterDecision> {
  const {query, conversation_id} = input

  // Update thread summary from latest API response before using it
  if (apiThreadSummaryUpdate && conversation_id) {
    threadSummaryStore.update(conversation_id, apiThreadSummaryUpdate)
  }

  const threadContext = conversation_id ? threadSummaryStore.get(conversation_id) : ''

  // Stage 1: deterministic keyword safety check (sync, always first)
  const triage = safetyTriage(query)

  // Stage 2: model classification (one ONNX forward pass)
  let cls: ClassificationOutput
  try {
    cls = await classify(query, threadContext)
  } catch (err) {
    // Model failure → conservative fallback: route to cloud as 'simple'
    cls = {
      intents: [],
      complexity: 'simple',
      scope: 'generic',
      scope_confidence: 0.5,
      needs_action: false,
      safety_category: triage.category,
      multilingual_lang: null,
    }
  }

  // Stage 3: merge triage safety with model safety (keyword always wins)
  const mergedSafety = mergeSafety(triage, cls.safety_category)
  const clsWithSafety: ClassificationOutput = {...cls, safety_category: mergedSafety}

  // Stage 4: deterministic depth rules
  const decision = applyDepthRules(clsWithSafety)

  // For trivial turns, inject a static on-device answer
  if (decision.depth === 'on_device' && !decision.safety_short_circuit) {
    return {...decision, on_device_answer: trivialAnswer(query)}
  }

  return decision
}

/**
 * Called after receiving an API response.
 * Updates thread summary storage so the next turn has fresh context.
 */
export function updateThreadSummary(
  conversationId: string,
  summaryFromApi: string,
): void {
  if (summaryFromApi) {
    threadSummaryStore.update(conversationId, summaryFromApi)
  }
}
