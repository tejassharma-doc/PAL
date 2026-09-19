/**
 * FuguClassifier — Fugu-style on-device classification via ONNX Runtime.
 *
 * Model: Xenova/multilingual-e5-small (ONNX, 117 MB).
 * Download from: https://huggingface.co/Xenova/multilingual-e5-small
 * Place at: assets/models/multilingual-e5-small.onnx (bundled with the RN app via metro).
 *
 * HOW IT WORKS (Fugu fast variant — no text generation):
 *   1. At init: embed all prototype phrases → compute one centroid per agent/complexity class.
 *   2. Per turn: one forward pass on (thread_summary + query) → embedding vector.
 *   3. Dot product vs all centroids → agent scores + complexity scores.
 *   4. Read argmax — no sampling, no beam search. Decision comes from scores alone.
 *
 * ExecuTorch upgrade path:
 *   When react-native-executorch is stable and the model is compiled to .pte,
 *   replace the InferenceSession calls with ExecuTorchModule.forward().
 *   The rest of this class (centroids, cosine similarity, score reading) stays unchanged.
 */

import {InferenceSession, Tensor} from 'onnxruntime-react-native'
import {AGENT_PHRASES, COMPLEXITY_PHRASES, detectScope} from './classPrototypes'
import {classifyKeyword} from './KeywordClassifier'
import type {AgentName, Complexity, Intent, ClassificationOutput, ScopeCategory} from './types'

const MODEL_ASSET = 'assets/models/multilingual-e5-small.onnx'
const MAX_INPUT_TOKENS = 128  // hard cap for the embed call
const SCOPE_CONFIDENCE_KEYWORD_HIGH = 0.90  // when keyword matched, use high confidence

type Centroids = {
  agents: Record<AgentName, Float32Array>
  complexity: Record<Complexity, Float32Array>
}

let session: InferenceSession | null = null
let centroids: Centroids | null = null
let onnxAvailable = false

// ── Helpers ────────────────────────────────────────────────────────────────

function dotProduct(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function normalise(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm === 0) return v
  return v.map(x => x / norm)
}

/**
 * Truncate a string to a rough token-count limit.
 * Approximate: 1 token ≈ 4 chars (conservative for Indian scripts).
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const approxChars = maxTokens * 3
  return text.length > approxChars ? text.slice(-approxChars) : text
}

// ── Session + centroid lifecycle ────────────────────────────────────────────

async function ensureSession(): Promise<InferenceSession> {
  if (session) return session
  session = await InferenceSession.create(MODEL_ASSET)
  return session
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const sess = await ensureSession()

  // Concatenate texts with separator — e5-small expects "query: <text>" or plain text
  const inputText = texts.map(t => `query: ${t}`).join(' [SEP] ')

  // Build input tensor (token IDs) — for a bundled model we pass the raw string.
  // In production, tokenization is handled by the ONNX tokenizer exported alongside the model.
  // Here we use a simplified approach: pass one text at a time and stack results.
  const results: Float32Array[] = []
  for (const text of texts) {
    const prefixed = `query: ${text}`
    const inputTensor = new Tensor('string', [prefixed], [1, 1])
    const feeds = {input: inputTensor}
    const output = await sess.run(feeds)
    // e5-small output key is 'sentence_embedding' or 'last_hidden_state' depending on export
    const embKey = output['sentence_embedding'] ?? output['last_hidden_state']
    if (!embKey) throw new Error('Unexpected ONNX output keys: ' + Object.keys(output).join(', '))
    results.push(normalise(new Float32Array(embKey.data as Float32Array)))
  }
  return results
}

function buildCentroid(vecs: Float32Array[]): Float32Array {
  const dim = vecs[0].length
  const centroid = new Float32Array(dim)
  for (const v of vecs) {
    for (let j = 0; j < dim; j++) centroid[j] += v[j]
  }
  for (let j = 0; j < dim; j++) centroid[j] /= vecs.length
  return normalise(centroid)
}

export async function initClassifier(): Promise<void> {
  if (centroids) return  // already initialised

  try {
    const agentCentroids = {} as Record<AgentName, Float32Array>
    for (const [agent, phrases] of Object.entries(AGENT_PHRASES) as [AgentName, string[]][]) {
      const vecs = await embed(phrases)
      agentCentroids[agent] = buildCentroid(vecs)
    }

    const complexityCentroids = {} as Record<Complexity, Float32Array>
    for (const [bucket, phrases] of Object.entries(COMPLEXITY_PHRASES) as [Complexity, string[]][]) {
      const vecs = await embed(phrases)
      complexityCentroids[bucket] = buildCentroid(vecs)
    }

    centroids = {agents: agentCentroids, complexity: complexityCentroids}
    onnxAvailable = true
  } catch {
    // Model not bundled or ONNX runtime unavailable.
    // classify() will automatically use the keyword fallback.
    onnxAvailable = false
  }
}

// ── Classification ──────────────────────────────────────────────────────────

export async function classify(
  query: string,
  threadSummary: string,
): Promise<ClassificationOutput> {
  if (!onnxAvailable || !centroids) {
    // ONNX model unavailable — fall back to keyword classifier (pure JS, always works)
    return classifyKeyword(query, threadSummary)
  }

  // Prepend thread summary for context-aware routing; cap to stay within token window
  const contextualQuery = threadSummary
    ? truncateToTokens(`[Context: ${threadSummary}] ${query}`, MAX_INPUT_TOKENS)
    : query

  const [queryVec] = await embed([contextualQuery])

  // ── Agent intent scores ──
  const agentScores: {agent: AgentName; sim: number}[] = []
  for (const [agent, centroid] of Object.entries(centroids.agents) as [AgentName, Float32Array][]) {
    agentScores.push({agent, sim: dotProduct(queryVec, centroid)})
  }
  agentScores.sort((a, b) => b.sim - a.sim)

  const intents: Intent[] = agentScores
    .filter(s => s.sim > 0.1)  // discard near-zero similarities
    .map(s => ({agent: s.agent, confidence: Math.max(0, Math.min(1, s.sim))}))

  // ── Complexity bucket ──
  let bestComplexity: Complexity = 'simple'
  let bestComplexitySim = -1
  for (const [bucket, centroid] of Object.entries(centroids.complexity) as [Complexity, Float32Array][]) {
    const sim = dotProduct(queryVec, centroid)
    if (sim > bestComplexitySim) {
      bestComplexitySim = sim
      bestComplexity = bucket
    }
  }

  // ── Scope (keyword, no model call) ──
  const scopeKeyword = detectScope(query)
  const scope: ScopeCategory = scopeKeyword === 'personal' ? 'personal' : 'generic'
  const scope_confidence = scopeKeyword === 'personal'
    ? SCOPE_CONFIDENCE_KEYWORD_HIGH
    : 0.75  // moderate confidence for keyword-negative generic

  // ── needs_action: true when complexity is 'call' ──
  const needs_action = bestComplexity === 'call'

  return {
    intents,
    complexity: bestComplexity,
    scope,
    scope_confidence,
    needs_action,
    safety_category: 'routine',  // safety_category is merged in FuguRouter from triage result
    multilingual_lang: null,      // language detection handled by STT layer upstream
  }
}
