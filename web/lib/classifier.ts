/**
 * On-device PAL query classifier.
 *
 * Usage:
 *   preloadClassifier()              // call at app startup to warm the model in background
 *   const result = await classifyOnDevice(query)
 *   if (!result) { /* server-side fallback *\/ }
 *
 * The worker is lazy-loaded on first call. Model download is ~360 MB on first use,
 * then cached in IndexedDB by @huggingface/transformers.
 *
 * Three-tier model:
 *   Tier 1 (this file) — on-device, no PHI egress, handles routing
 *   Tier 2 — Claude cloud (clinical reasoning, evidence synthesis)
 *   Tier 3 — PubMed/bioRxiv tool calls (no LLM knowledge)
 */

import type { ClassificationResult, WorkerToMain } from './classifierTypes'
export type { ClassificationResult, AgentName, IntentResult } from './classifierTypes'
import { detectScript, INDIAN_LANGUAGE_CODES } from './sttTypes'
import { classifyMultilingual } from './multilingualClassifier'

const DEFAULT_TIMEOUT_MS = 10_000

type Resolve = (r: ClassificationResult | null) => void
const pending = new Map<string, Resolve>()
let seq = 0
let worker: Worker | null = null
let ready = false
let loadStarted = false
// Set by preloadClassifier() from device capability detection
let _configuredModel: string | undefined

function initWorker(): Worker | null {
  if (typeof window === 'undefined') return null  // SSR guard
  if (worker) return worker

  try {
    worker = new Worker(
      new URL('./classifierWorker.ts', import.meta.url),
      { type: 'module' },
    )

    worker.addEventListener('message', (e: MessageEvent<WorkerToMain>) => {
      const msg = e.data
      switch (msg.type) {
        case 'progress':
          if (msg.status === 'ready') ready = true
          break
        case 'result': {
          const resolve = pending.get(msg.id)
          if (resolve) { pending.delete(msg.id); resolve(msg.result) }
          break
        }
        case 'error': {
          const resolve = pending.get(msg.id)
          if (resolve) { pending.delete(msg.id); resolve(null) }
          break
        }
      }
    })

    worker.addEventListener('error', () => {
      // Worker crashed (e.g. OOM, WebGPU denied) — clear so next call retries
      worker = null
      ready = false
      loadStarted = false
      for (const resolve of pending.values()) resolve(null)
      pending.clear()
    })

    return worker
  } catch {
    return null
  }
}

/**
 * Classify a health query on-device.
 *
 * For Indian language queries: tries the multilingual worker (e5-small) first.
 * If that worker isn't ready yet, falls through to the SmolLM2 worker which
 * returns an ambiguous result → Claude handles it (pre-existing behaviour).
 *
 * Returns null if: worker unavailable, model not loaded yet, or timeout.
 * Null signals the search router to fall back to server-side (Claude) classification.
 */
export async function classifyOnDevice(
  query: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ClassificationResult | null> {
  // Fast-path: try multilingual classifier for Indian language queries.
  const detectedLang = detectScript(query)
  if (detectedLang !== 'en' && INDIAN_LANGUAGE_CODES.has(detectedLang)) {
    const mlResult = await classifyMultilingual(query, timeoutMs)
    if (mlResult) {
      // Convert MLClassificationResult → ClassificationResult
      return {
        intents: [{ agent: mlResult.agent, confidence: mlResult.confidence }],
        scope: mlResult.scope,
        scope_confidence: mlResult.confidence,
        needs_action: mlResult.agent === 'appointment',
        safety_category: 'routine',
        multilingual_lang: detectedLang,
      }
    }
    // Multilingual classifier not ready → fall through to SmolLM2 worker,
    // which will detect the language internally and return ambiguous → Claude.
  }

  const w = initWorker()
  if (!w) return null

  const id = String(++seq)

  return new Promise<ClassificationResult | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(null)   // graceful timeout → server fallback
    }, timeoutMs)

    pending.set(id, (result) => {
      clearTimeout(timer)
      resolve(result)
    })

    w.postMessage({ type: 'classify', id, query, model: _configuredModel })
  })
}

/**
 * True once the model weights are fully loaded and the pipeline is warm.
 * Use to show a "thinking locally" indicator in the UI.
 */
export function isClassifierReady(): boolean {
  return ready
}

/**
 * Start loading the model in the background without waiting for a query.
 * Pass the model selected by device capability detection.
 */
export function preloadClassifier(model?: string): void {
  if (loadStarted || typeof window === 'undefined') return
  loadStarted = true
  if (model) _configuredModel = model
  initWorker()
  // Dummy classify to trigger model download — result is discarded
  setTimeout(() => {
    classifyOnDevice('health question warm-up', 60_000).catch(() => {})
  }, 2000)
}
