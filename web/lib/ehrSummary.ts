/**
 * Main-thread API for on-device EHR summarisation.
 *
 * Usage:
 *   preloadEHRSummary()                       // warm up at app startup
 *   const result = await summariseEHR({
 *     task: 'lab_results',
 *     data: { LDL: 162, HDL: 48, triglycerides: 210 },
 *     lang: 'hi',                             // respond in Hindi
 *     patient_name: 'Rajan',
 *   })
 *   // result.text = "रजन, आपका LDL 162 है जो सामान्य सीमा 130 से अधिक है…"
 *
 * Returns null on: SSR, worker crash, timeout.
 * Falls back to server-side summarisation (Claude Haiku) when null.
 *
 * PHI note: the structured `data` object is sent to the on-device worker —
 * it never leaves the device. This is the correct path for pre-display
 * summarisation. If the summary is used in a cloud query (e.g. passed to
 * the medication agent for interaction checking), it goes through the
 * standard PHI egress gate in the API.
 */

import type {
  SummaryInput, SummaryResult,
  GenerateInput, GenerateResult,
  FollowUpCallInput, FollowUpCallResult,
  EHRWorkerToMain, EHRMainToWorker,
} from './ehrSummaryTypes'

type Pending = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (r: any) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let workerReady = false
const pending = new Map<string, Pending>()

function getWorker(): Worker | null {
  if (typeof window === 'undefined') return null
  if (worker) return worker

  worker = new Worker(new URL('./ehrSummaryWorker.ts', import.meta.url), { type: 'module' })

  worker.addEventListener('message', (e: MessageEvent<EHRWorkerToMain>) => {
    const msg = e.data
    if (msg.type === 'progress') {
      workerReady = msg.status === 'ready'
      return
    }
    const p = pending.get(msg.id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(msg.id)
    if (msg.type === 'result') p.resolve(msg.result)
    else if (msg.type === 'generate_result') p.resolve(msg.result)
    else if (msg.type === 'follow_up_result') p.resolve(msg.result)
    else p.resolve(null)
  })

  worker.addEventListener('error', () => {
    worker = null
    workerReady = false
    for (const p of pending.values()) p.resolve(null)
    pending.clear()
  })

  return worker
}

/** True once the EHR summary model has finished loading. */
export function isEHRSummaryReady(): boolean {
  return workerReady
}

/** Trigger background model load. Call from layout.tsx at app startup. */
export function preloadEHRSummary(): void {
  if (typeof window !== 'undefined') getWorker()
}

/**
 * Summarise structured health data on-device.
 *
 * @param input  Task type + structured data to summarise.
 * @param timeoutMs  Worker timeout (default 20 s — 1.7 B model is slower than classifier).
 * @returns Plain-language summary, or null if worker unavailable / timed out.
 */
export async function summariseEHR(
  input: SummaryInput,
  timeoutMs = 20_000,
): Promise<SummaryResult | null> {
  const w = getWorker()
  if (!w) return null

  const id = `ehr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return new Promise<SummaryResult | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, timeoutMs)
    pending.set(id, {
      resolve: (r) => resolve(r && 'task' in r ? r as SummaryResult : null),
      timer,
    })
    const model = process.env.NEXT_PUBLIC_EHR_SUMMARY_MODEL || undefined
    w.postMessage({ type: 'summarise', id, input, model } satisfies EHRMainToWorker)
  })
}

/**
 * Free-form text generation on the already-loaded 1.7B EHR model.
 *
 * Use this to format diet plans, appointment reminders, or any structured
 * data → prose task that doesn't need clinical reasoning.
 * Reuses the model already in memory — no extra cost, no Claude call.
 *
 * Returns null if: worker not loaded, device is low-tier (model disabled),
 * or timeout. Callers should fall back to displaying raw structured data.
 *
 * @param system  System prompt (keep short — 1.7 B context is limited).
 * @param prompt  User-turn with the data to format.
 * @param timeoutMs  Default 25 s (slightly longer than summarise — gen can be longer).
 */
export async function generateOnDevice(
  system: string,
  prompt: string,
  timeoutMs = 25_000,
): Promise<string | null> {
  const w = getWorker()
  if (!w) return null

  const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const input: GenerateInput = { system, prompt }

  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, timeoutMs)
    pending.set(id, {
      resolve: (r) => resolve(r && 'text' in r ? (r as GenerateResult).text : null),
      timer,
    })
    const model = process.env.NEXT_PUBLIC_EHR_SUMMARY_MODEL || undefined
    w.postMessage({ type: 'generate', id, input, model } satisfies EHRMainToWorker)
  })
}

/**
 * Run a follow-up appointment call simulation on-device using SmolLM2-1.7B.
 *
 * The entire conversation is generated locally — no PHI leaves the device.
 * Only the extracted structured result (call_status, appointment_datetime,
 * lab_report_status) is sent to the server via POST /follow-up/complete.
 *
 * Returns null if: device is low-tier (EHR model disabled), worker not loaded,
 * or timeout. Caller must fall back to POST /follow-up/dispatch (cloud path).
 *
 * @param input   Patient + call context from the preflight response.
 * @param timeoutMs  Default 45 s — 512 token generation is slower than summarise.
 */
export async function runFollowUpCall(
  input: FollowUpCallInput,
  timeoutMs = 45_000,
): Promise<FollowUpCallResult | null> {
  const w = getWorker()
  if (!w) return null

  const id = `followup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return new Promise<FollowUpCallResult | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, timeoutMs)
    pending.set(id, {
      resolve: (r: FollowUpCallResult | null) => resolve(r),
      timer,
    })
    const model = process.env.NEXT_PUBLIC_EHR_SUMMARY_MODEL || undefined
    w.postMessage({ type: 'run_follow_up_call', id, input, model } satisfies EHRMainToWorker)
  })
}
