/**
 * On-device EHR summarization types.
 *
 * Why on-device: summarization is DATA-TO-TEXT (numbers/codes → plain prose).
 * It does NOT require clinical reasoning — the data drives every claim.
 * No hallucination risk when the model is explicitly grounded in the supplied
 * structured data and told to never infer beyond it.
 *
 * Contrast with medication-agent (drug interactions) and evidence-agent
 * (literature synthesis) — those always go to Claude cloud.
 */

/** The kind of structured health data to summarise. */
export type SummaryTask =
  | 'lab_results'        // "Your LDL is 162 (above target of 130)…"
  | 'medication_list'    // "You are currently taking 3 medications…"
  | 'visit_summary'      // "Your last visit on 12 Jan covered…"
  | 'vitals_trend'       // "Your blood pressure has been trending up…"
  | 'appointment_brief'  // "You have an appointment with Dr. Shah on Monday…"

/** Structured input for a summary request. */
export interface SummaryInput {
  task: SummaryTask
  /** Raw structured data (JSON-serialisable) — labs, meds, vitals, notes, etc. */
  data: Record<string, unknown>
  /**
   * BCP-47 language code for the output language.
   * Defaults to 'en' — set to 'hi', 'ta', etc. for Indian language output.
   */
  lang?: string
  /** Optional patient first name for personalised phrasing ("Your LDL…" vs "Mr. Rajan, your LDL…") */
  patient_name?: string
}

export interface SummaryResult {
  /** Plain-language summary ready to display. */
  text: string
  /** Every claim in `text` is grounded in the supplied `data`. */
  grounded: true
  task: SummaryTask
  lang: string
}

/** Free-form generation request — for diet formatting, appointment briefs, etc. */
export interface GenerateInput {
  /** System prompt (instruction to the model). Keep concise; 1.7B context is limited. */
  system: string
  /** User-turn prompt with the data to format. */
  prompt: string
  /** Max new tokens to generate (default 256). */
  max_tokens?: number
}

export interface GenerateResult {
  text: string
}

// ── Follow-up call types ────────────────────────────────────────────────────

/** Context passed to the on-device voice simulation. */
export interface FollowUpCallInput {
  patient_name: string
  patient_age: number
  patient_language: string
  doctor_name: string
  requires_lab_test: boolean
  lab_test_details?: string
  available_slots: string[]
}

/** Structured output from the on-device voice simulation. */
export interface FollowUpCallResult {
  transcript: string
  call_status: 'Booked' | 'Call Back Requested' | 'Unreachable' | 'Refused'
  appointment_datetime: string | null
  lab_report_status: 'Acknowledged' | 'Already Done' | 'Questions Asked' | 'N/A'
  extracted_lab_entities: string[]
}

// Worker → main thread
export type EHRWorkerToMain =
  | { type: 'progress'; status: 'loading' | 'ready'; progress?: number }
  | { type: 'result'; id: string; result: SummaryResult }
  | { type: 'generate_result'; id: string; result: GenerateResult }
  | { type: 'follow_up_result'; id: string; result: FollowUpCallResult }
  | { type: 'error'; id: string; error: string }

// Main thread → worker
export type EHRMainToWorker =
  | { type: 'summarise'; id: string; input: SummaryInput; model?: string }
  | { type: 'generate'; id: string; input: GenerateInput; model?: string }
  | { type: 'run_follow_up_call'; id: string; input: FollowUpCallInput; model?: string }

/** Human-readable language names for system prompts (matches ai_provider.py). */
export const LANG_NAMES: Record<string, string> = {
  hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada',
  ml: 'Malayalam', bn: 'Bengali', mr: 'Marathi', gu: 'Gujarati',
  pa: 'Punjabi', ur: 'Urdu', or: 'Odia', as: 'Assamese',
  ne: 'Nepali', si: 'Sinhala',
}
