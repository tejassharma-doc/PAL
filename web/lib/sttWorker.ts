/**
 * Whisper ONNX Web Worker — Speech-to-text for PAL.
 *
 * Model: onnx-community/whisper-small by default (244 MB ONNX, 99 languages).
 * Covers all major Indian languages: hi ta te kn ml bn mr gu pa ur or as.
 *
 * Whisper outputs native script (Devanagari for Hindi, Tamil script for Tamil, etc.)
 * We then run detectScript() on the transcription to identify the language —
 * more reliable than reading Whisper's internal language token in transformers.js.
 *
 * Audio input must be Float32Array at 16 kHz mono (Whisper requirement).
 * The main thread (stt.ts) handles recording + resampling before posting here.
 *
 * WebGPU → WASM fallback mirrors the classifier pattern.
 * Configure model via NEXT_PUBLIC_STT_MODEL env var.
 */

// Worker global — "dom" lib types 'self' as Window; cast to any for postMessage/addEventListener.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wSelf = self as any

import { pipeline, env } from '@huggingface/transformers'
import { detectScript } from './sttTypes'
import type { STTMainToWorker, STTWorkerToMain } from './sttTypes'

env.allowLocalModels = false
env.useBrowserCache = true

const DEFAULT_MODEL =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_STT_MODEL) ||
  'onnx-community/whisper-small'

type ASRPipeline = Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>

let asr: ASRPipeline | null = null
let currentModel = ''
let loadingPromise: Promise<ASRPipeline> | null = null

function post(msg: STTWorkerToMain) {
  wSelf.postMessage(msg)
}

async function loadModel(model: string): Promise<ASRPipeline> {
  if (asr && currentModel === model) return asr
  if (loadingPromise) return loadingPromise

  loadingPromise = (async (): Promise<ASRPipeline> => {
    post({ type: 'progress', status: 'loading', progress: 0 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressCb = (info: any) => {
      post({ type: 'progress', status: 'loading', progress: info?.progress ?? 0 })
    }

    let instance: ASRPipeline
    try {
      instance = await pipeline('automatic-speech-recognition', model, {
        device: 'webgpu',
        // fp16 encoder + q4 decoder — best quality/size for WebGPU
        dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
        progress_callback: progressCb,
      })
    } catch {
      // WebGPU denied or OOM — fall back to WASM (q8 for accuracy)
      instance = await pipeline('automatic-speech-recognition', model, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: progressCb,
      })
    }

    asr = instance
    currentModel = model
    loadingPromise = null
    post({ type: 'progress', status: 'ready' })
    return instance
  })()

  return loadingPromise
}

wSelf.addEventListener('message', async (e: MessageEvent<STTMainToWorker>) => {
  // init: pre-warm the model without transcribing (called by preloadSTT)
  if (e.data.type === 'init') {
    loadModel(e.data.model || DEFAULT_MODEL).catch(() => {})
    return
  }
  if (e.data.type !== 'transcribe') return
  const { id, audio, model = DEFAULT_MODEL } = e.data

  try {
    const t = await loadModel(model)

    // Whisper transcription — language:null triggers auto-detection
    // chunk_length_s:30 matches Whisper's training window
    const output = await (t as any)(audio, {
      task: 'transcribe',
      language: null,
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    })

    // Normalise output shape (single vs. array)
    const text: string = Array.isArray(output)
      ? ((output[0] as { text?: string }).text ?? '').trim()
      : ((output as { text?: string }).text ?? '').trim()

    // Detect language from Unicode script ranges in the transcribed text
    const language = detectScript(text)

    post({ type: 'result', id, text, language })
  } catch (err) {
    post({ type: 'error', id, error: String(err) })
  }
})
