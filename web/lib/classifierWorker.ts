/**
 * On-device intent classifier — runs in a Web Worker.
 * Model: SmolLM2-360M-Instruct by default (360 MB, ONNX, WebGPU/WASM).
 * Swap via NEXT_PUBLIC_CLASSIFIER_MODEL env var when Gemma ONNX lands:
 *   onnx-community/gemma-3-1b-it-ONNX-GQA   (~1 GB, better quality)
 *   google/gemma-4-E2B-it-qat-mobile-transformers (needs ONNX export first)
 *
 * NOTE: google/gemma-4-E2B-it-qat-mobile-transformers uses TFLite format
 * (for native iOS/Android). Browser WebGPU requires ONNX format.
 * This file is ready for Gemma 4 ONNX — just set the env var when it ships.
 */

// Worker global — "dom" lib types 'self' as Window. We use (self as any) for
// postMessage calls to avoid the Window.postMessage targetOrigin overload conflicts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wSelf = self as any

import { pipeline, type TextGenerationPipeline } from '@huggingface/transformers'
import type { ClassificationResult, AppointmentSlots } from './classifierTypes'
import { detectScript, INDIAN_LANGUAGE_CODES } from './sttTypes'

const DEFAULT_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct'

const SYSTEM_PROMPT = `You are a medical query router. Classify the health query below.
Output ONLY a single valid JSON object — no markdown, no explanation.

JSON schema:
{"intents":[{"agent":"<records|medication|appointment|diet|evidence>","confidence":<0.0–1.0>}],"scope":"<personal|generic|ambiguous>","scope_confidence":<0.0–1.0>,"needs_action":<true|false>,"safety_category":"<emergency|crisis|urgent|routine>"}

Safety rules (check FIRST, before scope/intent):
- emergency: chest pain, stroke, can't breathe, severe bleeding, unconscious, seizure, overdose, anaphylaxis
- crisis: suicide, self-harm, want to die, kill myself, hurt myself
- urgent: high fever, severe pain, rapidly worsening, spreading infection
- routine: everything else

Scope rules:
- personal: "my", "I have", "my doctor said", specific personal health data
- generic: general health questions, no personal reference
- ambiguous: unclear

Agent rules (can list multiple):
- records: personal health history, labs, vitals, past diagnoses
- medication: drugs, dosage, adherence, interactions, side effects
- appointment: booking, scheduling, clinic, specific provider visit
- diet: nutrition, food, recipes, meal plan, dietary restrictions
- evidence: "what does research say", studies, guidelines, general medical facts

Appointment slot extraction (ONLY when top intent is appointment with confidence > 0.75):
Add "appointment_slots" to the JSON with any of these fields present in the query:
  doctor (name or specialty), date_preference, time_preference, reason, urgency (routine|urgent|asap)
Example: {"appointment_slots": {"doctor": "Dr. Shah", "date_preference": "next Monday", "time_preference": "3pm", "reason": "follow-up", "urgency": "routine"}}
Omit "appointment_slots" entirely if appointment is not the top intent or confidence ≤ 0.75.`

let pipe: TextGenerationPipeline | null = null
let loadingPromise: Promise<TextGenerationPipeline> | null = null

async function loadModel(model: string): Promise<TextGenerationPipeline> {
  if (pipe) return pipe
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    wSelf.postMessage({ type: 'progress', status: 'loading', progress: 0 })

    pipe = await pipeline('text-generation', model, {
      device: 'webgpu',
      dtype: 'q4f16',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (info: any) => {
        wSelf.postMessage({ type: 'progress', status: 'loading', progress: info?.progress ?? 0 })
      },
    }) as TextGenerationPipeline

    wSelf.postMessage({ type: 'progress', status: 'ready' })
    return pipe
  })().catch(async (e) => {
    // WebGPU unavailable — retry on WASM (CPU, slower)
    console.warn('[classifier] WebGPU failed, falling back to WASM:', e)
    pipe = await pipeline('text-generation', model, {
      device: 'wasm',
      dtype: 'q8',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (info: any) => {
        wSelf.postMessage({ type: 'progress', status: 'loading', progress: info?.progress ?? 0 })
      },
    }) as TextGenerationPipeline

    wSelf.postMessage({ type: 'progress', status: 'ready' })
    return pipe
  })

  return loadingPromise
}

function extractJson(text: string): ClassificationResult | null {
  // Try exact JSON block first
  const m = text.match(/\{[\s\S]*?"intents"[\s\S]*?\}/)
  if (m) {
    try { return JSON.parse(m[0]) } catch {}
  }
  // Wider match — any JSON object in the output
  const wide = text.match(/\{[\s\S]*?\}/)
  if (wide) {
    try { return JSON.parse(wide[0]) } catch {}
  }
  return null
}

function normalise(raw: Partial<ClassificationResult>): ClassificationResult {
  const validAgents = new Set(['records', 'medication', 'appointment', 'diet', 'evidence'])
  const validScopes = ['personal', 'generic', 'ambiguous'] as const
  const validSafety = ['emergency', 'crisis', 'urgent', 'routine'] as const
  const validUrgency = ['routine', 'urgent', 'asap'] as const

  const intents = (raw.intents ?? [])
    .filter(i => validAgents.has(i.agent))
    .map(i => ({ agent: i.agent, confidence: Math.min(1, Math.max(0, i.confidence)) }))
    .slice(0, 5)

  // Validate and carry appointment slots only when they were actually extracted
  let appointmentSlots: AppointmentSlots | undefined
  const rawSlots = (raw as any).appointment_slots
  if (rawSlots && typeof rawSlots === 'object') {
    appointmentSlots = {}
    if (typeof rawSlots.doctor === 'string') appointmentSlots.doctor = rawSlots.doctor
    if (typeof rawSlots.date_preference === 'string') appointmentSlots.date_preference = rawSlots.date_preference
    if (typeof rawSlots.time_preference === 'string') appointmentSlots.time_preference = rawSlots.time_preference
    if (typeof rawSlots.reason === 'string') appointmentSlots.reason = rawSlots.reason
    if (validUrgency.includes(rawSlots.urgency)) appointmentSlots.urgency = rawSlots.urgency
    // Discard empty object
    if (Object.keys(appointmentSlots).length === 0) appointmentSlots = undefined
  }

  return {
    intents,
    scope: validScopes.includes(raw.scope as any) ? raw.scope as any : 'ambiguous',
    scope_confidence: Math.min(1, Math.max(0, raw.scope_confidence ?? 0.5)),
    needs_action: Boolean(raw.needs_action),
    safety_category: validSafety.includes(raw.safety_category as any)
      ? raw.safety_category as any
      : 'routine',
    multilingual_lang: raw.multilingual_lang,
    appointment_slots: appointmentSlots,
  }
}

wSelf.addEventListener('message', async (e: MessageEvent) => {
  const { type, id, query, model } = e.data as {
    type: string; id: string; query: string; model?: string
  }
  if (type !== 'classify') return

  // Fast-path: non-English Indian language script detected.
  // SmolLM2-360M is English-dominant and unreliable on Devanagari, Tamil, etc.
  // Skip model inference entirely — return a pass-through result so the routing
  // layer sends the query directly to Claude (which handles all Indian languages).
  const detectedLang = detectScript(query)
  if (detectedLang !== 'en' && INDIAN_LANGUAGE_CODES.has(detectedLang)) {
    wSelf.postMessage({
      type: 'result',
      id,
      result: {
        intents: [{ agent: 'evidence', confidence: 0.5 }],
        scope: 'ambiguous',
        scope_confidence: 0.5,
        needs_action: false,
        safety_category: 'routine',
        multilingual_lang: detectedLang,
      } satisfies ClassificationResult,
    })
    return
  }

  try {
    const generator = await loadModel(model ?? DEFAULT_MODEL)

    const output = await (generator as any)(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Query: "${query}"` },
      ],
      { max_new_tokens: 180, do_sample: false, temperature: null, top_p: null },
    )

    // Transformers.js chat output: array with generated_text as array of messages
    const generated = output[0]?.generated_text
    const lastContent: string =
      Array.isArray(generated)
        ? (generated.at(-1)?.content ?? '')
        : (generated ?? '')

    const parsed = extractJson(lastContent)
    if (!parsed) throw new Error(`Model output not parseable as JSON: ${lastContent.slice(0, 200)}`)

    const normalised = normalise(parsed)
    // Preserve detected language even for Latin-script queries (e.g. Hinglish)
    if (!normalised.multilingual_lang && detectedLang !== 'en') {
      normalised.multilingual_lang = detectedLang
    }
    wSelf.postMessage({ type: 'result', id, result: normalised })
  } catch (err: unknown) {
    wSelf.postMessage({
      type: 'error',
      id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
