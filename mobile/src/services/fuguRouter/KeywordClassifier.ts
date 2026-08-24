/**
 * KeywordClassifier — pure-JS fallback when ONNX model is not bundled.
 *
 * Uses token-overlap scoring against the prototype phrase banks instead of
 * cosine similarity over embeddings.  Routing accuracy is lower than ONNX
 * but sufficient for correct agent dispatch on most queries.
 *
 * FuguClassifier imports this and calls classifyKeyword() automatically when
 * the ONNX session fails to initialise.  No changes needed in callers.
 */

import {AGENT_PHRASES, COMPLEXITY_PHRASES, detectScope} from './classPrototypes'
import type {AgentName, ClassificationOutput, Complexity, Intent} from './types'

// ── Tokenizer ─────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.!?;:\-–—()\[\]]+/)
    .filter(w => w.length > 2)
}

// Fraction of query tokens that appear in ANY prototype phrase for this class.
// Scaled so a single-word hit on 10 phrases is meaningful.
function overlapScore(queryTokens: string[], phrases: string[]): number {
  if (queryTokens.length === 0) return 0
  const phraseTokenSet = new Set<string>()
  for (const phrase of phrases) {
    for (const tok of tokenize(phrase)) phraseTokenSet.add(tok)
  }
  let hits = 0
  for (const tok of queryTokens) {
    if (phraseTokenSet.has(tok)) hits++
  }
  return hits / queryTokens.length
}

// ── Complexity heuristics (applied before score-based classification) ──────

const TRIVIAL_RE = /^(hello|hi|hey|namaste|vanakkam|namaskar|नमस्ते|வணக்கம்|నమస్కారం|ನಮಸ್ಕಾರ|سلام|assalamu|നമസ്കാരം|নমস্কার)\b|^(bye|goodbye|ok|okay|sure|yes|no|thanks|thank you|ठीक है|हाँ|नहीं|ধন্যবাদ|நன்றி|ధన్యవాదాలు)\b|^(what can you do|what are your features|help|how do you work)\b/i

const CALL_SUBSTRINGS = [
  'book', 'schedule', 'cancel appointment', 'reschedule', 'message my doctor',
  'contact clinic', 'send message', 'अपॉइंटमेंट', 'பதிவு', 'অ্যাপয়েন্টমেন্ট',
]

function hasCallIntent(q: string): boolean {
  const lower = q.toLowerCase()
  return CALL_SUBSTRINGS.some(kw => lower.includes(kw))
}

// A query is complex when it combines personal context + medical terms + length,
// or uses explicit AND/ALSO/GIVEN to join multiple health concerns.
const COMPLEX_CONJUNCTIONS = /\b(and also|as well as|given my|based on my|along with)\b/i
const PERSONAL_MEDICAL_RE = /\b(my (lab|blood|medication|condition|diagnosis|pressure|sugar|cholesterol|test|result))\b/i

function hasComplexIntent(q: string, wordCount: number): boolean {
  return COMPLEX_CONJUNCTIONS.test(q) || (wordCount > 9 && PERSONAL_MEDICAL_RE.test(q))
}

// ── Main export ────────────────────────────────────────────────────────────

export function classifyKeyword(
  query: string,
  _threadSummary: string,
): ClassificationOutput {
  const tokens = tokenize(query)
  const wordCount = query.trim().split(/\s+/).length

  // 1. Complexity — heuristic-first, score-based fallback
  let complexity: Complexity = 'simple'
  if (TRIVIAL_RE.test(query.trim())) {
    complexity = 'trivial'
  } else if (hasCallIntent(query)) {
    complexity = 'call'
  } else if (hasComplexIntent(query, wordCount)) {
    complexity = 'complex'
  } else {
    // Score-based: pick the complexity bucket with the most token overlap
    let bestScore = 0
    for (const [bucket, phrases] of Object.entries(COMPLEXITY_PHRASES) as [Complexity, string[]][]) {
      const s = overlapScore(tokens, phrases)
      if (s > bestScore) { bestScore = s; complexity = bucket }
    }
  }

  // 2. Agent intent scores
  const rawScores = (Object.entries(AGENT_PHRASES) as [AgentName, string[]][]).map(
    ([agent, phrases]) => ({agent, confidence: Math.min(1, overlapScore(tokens, phrases) * 4)}),
  )
  rawScores.sort((a, b) => b.confidence - a.confidence)
  const intents: Intent[] = rawScores.filter(a => a.confidence > 0.04)

  // 3. Scope detection (keyword-based, same as FuguClassifier)
  const scope = detectScope(query) === 'personal' ? 'personal' : 'generic'

  return {
    intents,
    complexity,
    scope,
    scope_confidence: scope === 'personal' ? 0.90 : 0.70,
    needs_action: complexity === 'call',
    // safety_category is merged from SafetyTriage in FuguRouter — leave as routine here
    safety_category: 'routine',
    multilingual_lang: null,
  }
}
