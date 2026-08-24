export type AgentName = 'records' | 'medication' | 'appointment' | 'diet' | 'evidence'

export interface IntentResult {
  agent: AgentName
  confidence: number
}

/**
 * Slot extraction for appointment booking intent.
 * Populated by the on-device classifier when appointment confidence > 0.75.
 * All fields are optional — model extracts what's present, nothing more.
 */
export interface AppointmentSlots {
  doctor?: string          // "Dr. Shah", "cardiologist"
  date_preference?: string // "next Monday", "tomorrow", "15 January"
  time_preference?: string // "3pm", "morning", "after 5"
  reason?: string          // "follow-up", "blood pressure check"
  urgency?: 'routine' | 'urgent' | 'asap'
}

/** Fugu Router complexity bucket — drives the on-device depth decision. */
export type Complexity = 'trivial' | 'simple' | 'complex' | 'call'

export interface ClassificationResult {
  intents: IntentResult[]
  scope: 'personal' | 'generic' | 'ambiguous'
  scope_confidence: number
  needs_action: boolean
  safety_category: 'emergency' | 'crisis' | 'urgent' | 'routine'
  multilingual_lang?: string
  /** Fugu Router: complexity bucket — determines routing depth on-device. Default 'simple'. */
  complexity?: Complexity
  /** Present when top intent is appointment and confidence > 0.75 */
  appointment_slots?: AppointmentSlots
}

// Main thread → worker
export interface ClassifyMessage {
  type: 'classify'
  id: string
  query: string
  model?: string
}

// Worker → main thread
export type WorkerToMain =
  | { type: 'progress'; status: 'loading' | 'ready'; progress?: number }
  | { type: 'result'; id: string; result: ClassificationResult }
  | { type: 'error'; id: string; error: string }

// Safe defaults when worker is unavailable or times out
export const ROUTINE_FALLBACK: ClassificationResult = {
  intents: [{ agent: 'evidence', confidence: 0.5 }],
  scope: 'ambiguous',
  scope_confidence: 0.5,
  needs_action: false,
  safety_category: 'routine',
}
