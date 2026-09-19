/**
 * Types for the multilingual intent classifier worker.
 *
 * Uses Xenova/multilingual-e5-small (117 MB, 100+ languages).
 * Replaces the "always call Claude" fast-path in classifierWorker.ts
 * for Indian language queries.
 */

export type MLAgentName =
  | 'appointment'
  | 'medication'
  | 'diet'
  | 'records'
  | 'evidence'

/** Fugu Router complexity bucket — determined by cosine similarity to complexity prototypes. */
export type MLComplexity = 'trivial' | 'simple' | 'complex' | 'call'

/** Safety triage level for health queries */
export type MLSafety = 'routine' | 'urgent' | 'emergency' | 'crisis'

export interface MLClassificationResult {
  agent: MLAgentName
  confidence: number
  scope: 'personal' | 'generic'
  /** Fugu Router complexity bucket. Absent when centroids not yet built. */
  complexity?: MLComplexity
  /** Safety triage level. Absent when safety classification not performed. */
  safety?: MLSafety
}

// Main thread → worker
export type MLMainToWorker =
  | { type: 'classify'; id: string; query: string }
  | { type: 'ping' }  // warms up the model without a real query

// Worker → main thread
export type MLWorkerToMain =
  | { type: 'progress'; status: 'loading' | 'ready'; progress?: number }
  | { type: 'result'; id: string; result: MLClassificationResult }
  | { type: 'error'; id: string; error: string }
