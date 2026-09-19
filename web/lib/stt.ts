/**
 * Main-thread STT API — wraps the Whisper Web Worker.
 *
 * Usage:
 *   preloadSTT()                          // warm up at app startup (optional)
 *   const rec = startRecording()          // begin capturing mic
 *   const result = await rec.stop()       // stop and transcribe
 *   // result: { text, language, is_indian_language } | null
 *
 * Multilingual routing contract:
 *   result.language  — BCP-47 code ('hi', 'ta', 'en', ...)
 *   result.is_indian_language — true → skip SmolLM2 classifier, route to Claude
 *                               false → run SmolLM2 intent classifier as normal
 *
 * Audio pipeline:
 *   MediaRecorder (webm/opus) → AudioContext.decodeAudioData → OfflineAudioContext
 *   resample to 16 kHz mono Float32Array → transferred (zero-copy) to worker.
 *
 * Returns null on: SSR, mic permission denied, worker crash, transcription timeout.
 */

import type { TranscriptionResult, STTWorkerToMain, STTMainToWorker } from './sttTypes'
import { INDIAN_LANGUAGE_CODES, detectScript } from './sttTypes'

type Pending = {
  resolve: (r: TranscriptionResult | null) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let workerReady = false
const pending = new Map<string, Pending>()
// Set by preloadSTT() from device capability detection; used for every transcription
let _configuredModel: string | undefined

function getWorker(): Worker | null {
  if (typeof window === 'undefined') return null
  if (worker) return worker

  worker = new Worker(new URL('./sttWorker.ts', import.meta.url), { type: 'module' })

  worker.addEventListener('message', (e: MessageEvent<STTWorkerToMain>) => {
    const msg = e.data
    if (msg.type === 'progress') {
      workerReady = msg.status === 'ready'
      return
    }
    const p = pending.get(msg.id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(msg.id)

    if (msg.type === 'result') {
      p.resolve({
        text: msg.text,
        language: msg.language,
        is_indian_language: INDIAN_LANGUAGE_CODES.has(msg.language),
      })
    } else {
      // error
      p.resolve(null)
    }
  })

  worker.addEventListener('error', () => {
    worker = null
    workerReady = false
    for (const p of pending.values()) p.resolve(null)
    pending.clear()
  })

  return worker
}

/** True once the Whisper model has finished loading in the worker. */
export function isSTTReady(): boolean {
  return workerReady
}

/**
 * Trigger background model load.
 * Pass the model selected by device capability detection; defaults to env var.
 */
export function preloadSTT(model?: string): void {
  if (typeof window === 'undefined') return
  if (model) _configuredModel = model
  const w = getWorker()
  if (w) w.postMessage({ type: 'init', model: _configuredModel } satisfies STTMainToWorker)
}

/** Resample an AudioBuffer to 16 kHz mono Float32Array for Whisper. */
async function to16kMono(buf: AudioBuffer): Promise<Float32Array> {
  const targetRate = 16_000
  const frames = Math.ceil(buf.duration * targetRate)
  const offline = new OfflineAudioContext(1, frames, targetRate)
  const src = offline.createBufferSource()
  src.buffer = buf
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

/**
 * Core: transcribe a pre-captured AudioBuffer or raw Float32Array (must be 16 kHz).
 * Returns null on timeout or worker error.
 */
export async function transcribeAudio(
  audio: AudioBuffer | Float32Array,
  timeoutMs = 30_000,
): Promise<TranscriptionResult | null> {
  const w = getWorker()
  if (!w) return null

  const float32 = audio instanceof Float32Array ? audio : await to16kMono(audio)
  const id = `stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return new Promise<TranscriptionResult | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, timeoutMs)
    pending.set(id, { resolve, timer })
    // Transfer ownership of the buffer (zero-copy)
    w.postMessage(
      { type: 'transcribe', id, audio: float32, model: _configuredModel } satisfies STTMainToWorker,
      [float32.buffer],
    )
  })
}

export interface RecordingHandle {
  /** Stop recording and return the transcription result. */
  stop: () => Promise<TranscriptionResult | null>
}

// ── Web Speech API (mobile path) ──────────────────────────────────────────────

export function isWebSpeechAvailable(): boolean {
  return typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
}

/**
 * Record using the browser's built-in speech recognition (Web Speech API).
 * Zero download, zero RAM, zero battery cost — backed by Google/Apple ASR.
 * Handles 90+ languages including all major Indian languages.
 * Falls back gracefully: if unavailable, returns null on stop().
 */
export function startWebSpeechRecording(langHint?: string): RecordingHandle {
  if (!isWebSpeechAvailable()) return { stop: () => Promise.resolve(null) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const recognition = new SR()
  recognition.continuous = false
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  // langHint from user's preferred_language (e.g. 'hi' → 'hi-IN', 'ta' → 'ta-IN').
  // No hint → browser uses its own language detection.
  if (langHint) recognition.lang = langHint.length === 2 ? `${langHint}-IN` : langHint

  let finalResult: TranscriptionResult | null = null
  let endResolve: ((r: TranscriptionResult | null) => void) | null = null
  let ended = false

  recognition.onresult = (event: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const transcript = (event.results[0]?.[0]?.transcript ?? '').trim()
    if (transcript) {
      const language = detectScript(transcript)
      finalResult = {
        text: transcript,
        language,
        is_indian_language: INDIAN_LANGUAGE_CODES.has(language),
      }
    }
  }

  const settle = (result: TranscriptionResult | null) => {
    ended = true
    if (endResolve) { endResolve(result); endResolve = null }
  }

  recognition.onend = () => settle(finalResult)
  recognition.onerror = () => settle(null)

  try {
    recognition.start()
  } catch {
    return { stop: () => Promise.resolve(null) }
  }

  return {
    stop: (): Promise<TranscriptionResult | null> => {
      if (!ended) { try { recognition.stop() } catch {} }
      if (ended) return Promise.resolve(finalResult)
      return new Promise((resolve) => { endResolve = resolve })
    },
  }
}

/**
 * Start microphone recording. Call .stop() to end and transcribe.
 *
 * Throws if mic permission is denied or MediaRecorder is unavailable.
 * The returned Promise resolves with null on transcription error/timeout.
 */
export function startRecording(maxSeconds = 60): RecordingHandle {
  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  const chunks: Blob[] = []
  let stopped = false

  // Kick off mic capture immediately (getUserMedia is async but we want
  // the recording to start as close to the caller's gesture as possible)
  const streamPromise = navigator.mediaDevices
    .getUserMedia({ audio: { channelCount: 1, sampleRate: 16_000, echoCancellation: true } })
    .then((s) => {
      stream = s
      recorder = new MediaRecorder(s)
      recorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data) }
      recorder.start(250) // collect in 250 ms chunks
      // Auto-stop after maxSeconds
      setTimeout(() => { if (!stopped) stopRecorder() }, maxSeconds * 1_000)
      return s
    })

  function stopRecorder() {
    stopped = true
    recorder?.stop()
    stream?.getTracks().forEach((t) => t.stop())
  }

  async function stop(): Promise<TranscriptionResult | null> {
    try {
      await streamPromise
    } catch {
      return null // mic denied
    }
    if (!stopped) stopRecorder()

    // Wait for final ondataavailable + onstop
    await new Promise<void>((res) => {
      if (!recorder || recorder.state === 'inactive') { res(); return }
      recorder.onstop = () => res()
    })

    if (chunks.length === 0) return null

    try {
      const blob = new Blob(chunks, { type: recorder?.mimeType ?? 'audio/webm' })
      const arrayBuffer = await blob.arrayBuffer()
      const audioCtx = new AudioContext()
      const decoded = await audioCtx.decodeAudioData(arrayBuffer)
      return transcribeAudio(decoded)
    } catch {
      return null
    }
  }

  return { stop }
}
