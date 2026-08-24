/**
 * Main-thread API for the multilingual intent classifier.
 *
 * Usage:
 *   preloadMultilingualClassifier()             // call from Preloader (mid/high tier only)
 *   const result = await classifyMultilingual(query)
 *   if (result) {
 *     // result.agent, result.confidence, result.scope
 *   }
 *
 * Returns null when: worker not ready, model not yet loaded, timeout.
 * Callers should fall back to Claude when null (same behaviour as before the worker existed).
 *
 * Progressive enhancement: the first Indian language query before the model
 * loads falls through to Claude as usual.  Once loaded, subsequent queries
 * hit the on-device path.
 */

import type { MLClassificationResult, MLWorkerToMain, MLMainToWorker } from './multilingualClassifierTypes'

const DEFAULT_TIMEOUT_MS = 8_000

type Resolve = (r: MLClassificationResult | null) => void
const pending = new Map<string, Resolve>()
let seq = 0
let worker: Worker | null = null
let ready = false
let loadStarted = false

function initWorker(): Worker | null {
  if (typeof window === 'undefined') return null
  if (worker) return worker

  try {
    worker = new Worker(
      new URL('./multilingualClassifierWorker.ts', import.meta.url),
      { type: 'module' },
    )

    worker.addEventListener('message', (e: MessageEvent<MLWorkerToMain>) => {
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
 * Classify a non-English (Indian language) query on-device.
 * Returns null if the worker is unavailable or not yet ready.
 */
export async function classifyMultilingual(
  query: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<MLClassificationResult | null> {
  const w = initWorker()
  if (!w || !ready) return null  // don't queue — return immediately if not warm

  const id = String(++seq)

  return new Promise<MLClassificationResult | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, timeoutMs)

    pending.set(id, (result) => {
      clearTimeout(timer)
      resolve(result)
    })

    w.postMessage({ type: 'classify', id, query } satisfies MLMainToWorker)
  })
}

/** True once centroid computation is done and the worker is ready for queries. */
export function isMultilingualClassifierReady(): boolean {
  return ready
}

/**
 * Start loading the model in the background.
 * Only call on mid/high-tier devices (cap=117 MB model is reasonable there).
 * Low-tier devices skip this — they save memory and accept Claude fallback.
 */
export function preloadMultilingualClassifier(): void {
  if (loadStarted || typeof window === 'undefined') return
  loadStarted = true
  const w = initWorker()
  if (w) {
    // Send a ping to warm up the model + build centroids.
    setTimeout(() => {
      w.postMessage({ type: 'ping' } satisfies MLMainToWorker)
    }, 4_000)  // stagger after classifier + STT start loading
  }
}
