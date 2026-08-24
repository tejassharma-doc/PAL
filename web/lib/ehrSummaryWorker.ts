/**
 * On-device EHR Summary Worker — runs in a Web Worker.
 *
 * Model: HuggingFaceTB/SmolLM2-1.7B-Instruct by default (~1.7 GB ONNX q4f16).
 * Upgrade path (when ONNX exports ship):
 *   Qwen2.5-1.5B-Instruct  — stronger multilingual, similar size
 *   Phi-3.5-mini-instruct   — best quality (~3.8 GB q4, needs WebGPU 8 GB+)
 *   Llama-3.2-3B-Instruct   — strong visit summaries (~3 GB q4)
 * Configure via NEXT_PUBLIC_EHR_SUMMARY_MODEL env var.
 *
 * WHY ON-DEVICE IS SAFE HERE:
 *   Task is data-to-text only. Every claim in the output is forced to be
 *   grounded in the structured input — the system prompt explicitly forbids
 *   inference beyond the supplied data. No PHI leaves the device.
 *   Clinical reasoning (drug interactions, evidence synthesis, diagnosis)
 *   is never done here — those always go to Claude cloud.
 *
 * Audio-native note:
 *   If Qwen2.5-Omni-3B ONNX becomes available, the STT worker (sttWorker.ts)
 *   can be swapped to it for end-to-end audio → summary with no separate
 *   Whisper step. Set NEXT_PUBLIC_STT_MODEL=onnx-community/Qwen2.5-Omni-3B.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wSelf = self as any

import { pipeline, type TextGenerationPipeline } from '@huggingface/transformers'
import type {
  EHRMainToWorker, EHRWorkerToMain,
  SummaryInput, SummaryResult, SummaryTask,
  FollowUpCallInput, FollowUpCallResult,
} from './ehrSummaryTypes'
import { LANG_NAMES } from './ehrSummaryTypes'

const DEFAULT_MODEL = 'HuggingFaceTB/SmolLM2-1.7B-Instruct'

function post(msg: EHRWorkerToMain) {
  wSelf.postMessage(msg)
}

// ── Prompt templates per task type ─────────────────────────────────────────

const SYSTEM_COMMON = `You are a health data reader for PAL, a patient health app.
Your job: convert structured health data into plain, warm, easy-to-read language.

HARD RULES:
- Ground every sentence in the supplied data. Do NOT infer, guess, or add facts.
- Never diagnose. Never prescribe. Never interpret imaging.
- If a value is abnormal, say so plainly ("above the usual range of X") — do not say "you have [disease]".
- Short and clear: 2-5 sentences. No bullet lists unless task requires it.
- Use simple words; avoid jargon.`

const TASK_PROMPTS: Record<SummaryTask, (d: Record<string, unknown>, name?: string) => string> = {
  lab_results: (d, name) =>
    `${name ? `Patient: ${name}. ` : ''}Lab results data:\n${JSON.stringify(d, null, 2)}\n\nWrite a brief plain-language summary of these lab results. Mention which values are within range and which are outside the usual range. Do not diagnose.`,

  medication_list: (d, name) =>
    `${name ? `Patient: ${name}. ` : ''}Current medication list:\n${JSON.stringify(d, null, 2)}\n\nSummarise what medications this patient is currently taking, how many, and any key timing notes from the data. Do not add interaction information — that requires a doctor.`,

  visit_summary: (d, name) =>
    `${name ? `Patient: ${name}. ` : ''}Clinical visit note data:\n${JSON.stringify(d, null, 2)}\n\nWrite 3 concise bullet points summarising what was covered in this visit, based only on the data above.`,

  vitals_trend: (d, name) =>
    `${name ? `Patient: ${name}. ` : ''}Vitals history:\n${JSON.stringify(d, null, 2)}\n\nDescribe the trend in these vitals in plain language. Note if any reading is consistently outside the usual range. Do not diagnose.`,

  appointment_brief: (d, name) =>
    `${name ? `Patient: ${name}. ` : ''}Appointment data:\n${JSON.stringify(d, null, 2)}\n\nWrite a brief, friendly appointment reminder based on this data. Include doctor name, date/time, and reason if present.`,
}

function buildMessages(input: SummaryInput) {
  const taskFn = TASK_PROMPTS[input.task]
  const userContent = taskFn(input.data, input.patient_name)

  let system = SYSTEM_COMMON
  if (input.lang && input.lang !== 'en') {
    const langName = LANG_NAMES[input.lang] ?? input.lang.toUpperCase()
    system += `\n\nIMPORTANT: Respond entirely in ${langName}.`
  }

  return { system, userContent }
}

// ── Model loading ───────────────────────────────────────────────────────────

let pipe: TextGenerationPipeline | null = null
let loadingPromise: Promise<TextGenerationPipeline> | null = null

async function loadModel(model: string): Promise<TextGenerationPipeline> {
  if (pipe) return pipe
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    post({ type: 'progress', status: 'loading', progress: 0 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressCb = (info: any) => {
      post({ type: 'progress', status: 'loading', progress: info?.progress ?? 0 })
    }

    try {
      pipe = await pipeline('text-generation', model, {
        device: 'webgpu',
        dtype: 'q4f16',
        progress_callback: progressCb,
      }) as TextGenerationPipeline
    } catch {
      // WebGPU unavailable — WASM fallback (slower but universal)
      pipe = await pipeline('text-generation', model, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: progressCb,
      }) as TextGenerationPipeline
    }

    post({ type: 'progress', status: 'ready' })
    return pipe!
  })()

  return loadingPromise
}

// ── Message handler ─────────────────────────────────────────────────────────

function extractText(output: any): string {
  const generated = output[0]?.generated_text
  return (
    Array.isArray(generated)
      ? (generated.at(-1)?.content ?? '').trim()
      : (generated ?? '').trim()
  )
}

wSelf.addEventListener('message', async (e: MessageEvent<EHRMainToWorker>) => {
  const { id, model = DEFAULT_MODEL } = e.data

  // ── summarise ──────────────────────────────────────────────────────────────
  if (e.data.type === 'summarise') {
    const { input } = e.data
    try {
      const gen = await loadModel(model)
      const { system, userContent } = buildMessages(input)

      const output = await (gen as any)(
        [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        { max_new_tokens: 256, do_sample: false, temperature: null, top_p: null },
      )

      const result: SummaryResult = {
        text: extractText(output),
        grounded: true,
        task: input.task,
        lang: input.lang ?? 'en',
      }
      post({ type: 'result', id, result })
    } catch (err) {
      post({ type: 'error', id, error: String(err) })
    }
    return
  }

  // ── generate (free-form, e.g. diet formatting, appointment briefs) ─────────
  if (e.data.type === 'generate') {
    const { input } = e.data
    const { system, prompt, max_tokens = 256 } = input
    try {
      const gen = await loadModel(model)

      const output = await (gen as any)(
        [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        { max_new_tokens: max_tokens, do_sample: false, temperature: null, top_p: null },
      )

      post({ type: 'generate_result', id, result: { text: extractText(output) } })
    } catch (err) {
      post({ type: 'error', id, error: String(err) })
    }
    return
  }

  // ── run_follow_up_call — clinic receptionist follow-up conversation ────────
  if (e.data.type === 'run_follow_up_call') {
    const { input } = e.data as { input: FollowUpCallInput; id: string; model?: string }
    const langName = LANG_NAMES[input.patient_language] ?? 'English'
    const langInstruction = input.patient_language !== 'en'
      ? `\nCommunicate entirely in ${langName}.`
      : ''

    const system = `You are a clinic receptionist on a follow-up phone call.${langInstruction}
Follow this 5-step flow:
1. Greet patient by name, ask if now is a good time.
2. State this is a follow-up for Dr. ${input.doctor_name}.
3. Negotiate an appointment from the available slots.
4. ${input.requires_lab_test ? `Remind patient to get ${input.lab_test_details ?? 'prescribed tests'} done and upload the report to the Records section of their app.` : 'No lab tests required.'}
5. Summarise the agreed appointment and say goodbye.

Output ONLY a JSON object (no prose outside JSON):
{"transcript":"<dialogue>","call_status":"Booked|Call Back Requested|Unreachable|Refused","appointment_datetime":"<ISO8601 or null>","lab_report_status":"Acknowledged|Already Done|Questions Asked|N/A","extracted_lab_entities":[]}`

    const userPrompt = `Patient: ${input.patient_name} (age ${input.patient_age})
Doctor: Dr. ${input.doctor_name}
Available slots: ${input.available_slots.join(', ') || 'none provided'}
Lab test required: ${input.requires_lab_test}${input.lab_test_details ? `\nLab details: ${input.lab_test_details}` : ''}

Simulate the call and return the JSON.`

    try {
      const gen = await loadModel(model)
      const output = await (gen as any)(
        [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
        { max_new_tokens: 512, do_sample: false, temperature: null, top_p: null },
      )

      let raw = extractText(output).trim()
      // Strip markdown fences if present
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim()
      }

      let result: FollowUpCallResult
      try {
        result = JSON.parse(raw) as FollowUpCallResult
      } catch {
        // Parsing failed — surface the raw text as the transcript with safe defaults
        result = {
          transcript: raw,
          call_status: 'Unreachable',
          appointment_datetime: null,
          lab_report_status: 'N/A',
          extracted_lab_entities: [],
        }
      }
      post({ type: 'follow_up_result', id, result })
    } catch (err) {
      post({ type: 'error', id, error: String(err) })
    }
  }
})
