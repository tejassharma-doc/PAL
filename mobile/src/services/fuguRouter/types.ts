// ── Fugu Router types ─────────────────────────────────────────────────────────
// Mirrors api/services/hermes/planner.py — kept in sync deliberately.

export type AgentName = 'records' | 'medication' | 'appointment' | 'diet' | 'evidence'
export type ScopeCategory = 'personal' | 'generic' | 'ambiguous'
export type SafetyCategory = 'emergency' | 'crisis' | 'urgent' | 'routine'

/** Fugu complexity bucket — drives the on-device depth decision (no text generation). */
export type Complexity = 'trivial' | 'simple' | 'complex' | 'call'

/** Routing depth chosen by the on-device planner. */
export type RoutingDepth = 'on_device' | 'one' | 'many' | 'launch_hermes'

export interface Intent {
  agent: AgentName
  confidence: number  // 0.0–1.0
}

/** Structured output from one FuguClassifier forward pass — no text generated. */
export interface ClassificationOutput {
  intents: Intent[]
  complexity: Complexity
  scope: ScopeCategory
  scope_confidence: number
  needs_action: boolean
  safety_category: SafetyCategory
  multilingual_lang: string | null
}

/** Final decision from the deterministic DepthRules layer. */
export interface RouterDecision {
  depth: RoutingDepth
  agents_to_invoke: AgentName[]
  load_record: boolean
  /** Only present when depth === 'on_device' for a trivial turn. */
  on_device_answer?: string
  /** True when scope is ambiguous — caller must show disambiguation question. */
  requires_disambiguation?: boolean
  /** True when safety short-circuit fired. */
  safety_short_circuit?: boolean
  /** Audit trail — human-readable reason for the depth choice. */
  reason: string
  classification: ClassificationOutput
}

/** Input to FuguRouter.route() per conversation turn. */
export interface FuguRouterInput {
  query: string
  /** Rolling thread summary received from the previous API response. Empty for turn 1. */
  thread_summary: string
  session_id: string
  conversation_id?: string
}

/**
 * JSON payload sent to the backend when depth !== 'on_device'.
 * Shape matches what api/services/hermes/orchestrator._parse_classification() expects.
 */
export interface OnDeviceClassificationJson {
  intents: Intent[]
  scope: ScopeCategory
  scope_confidence: number
  complexity: Complexity
  needs_action: boolean
  safety_category: SafetyCategory
  multilingual_lang: string | null
  appointment_slots?: Record<string, string>
}
