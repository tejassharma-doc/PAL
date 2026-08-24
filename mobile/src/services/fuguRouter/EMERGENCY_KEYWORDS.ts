/**
 * Deterministic keyword lists for safety triage Stage 1.
 * Mirrors SAFETY_KEYWORDS_EMERGENCY / CRISIS in api/services/hermes/orchestrator.py.
 * Keyword check runs BEFORE the model — no network, no inference, always correct.
 */

export const EMERGENCY_KEYWORDS: readonly string[] = [
  'chest pain', 'heart attack', 'stroke', 'severe bleeding', "can't breathe",
  'breathing difficulty', 'unconscious', 'seizure', 'choking', 'anaphylaxis',
  'overdose', 'poisoning', 'severe burn', 'high fever convulsion',
]

export const CRISIS_KEYWORDS: readonly string[] = [
  'suicide', 'self-harm', 'kill myself', 'end my life', 'want to die',
  'hurt myself',
]

/**
 * Return the deterministic safety category for a query string.
 * Emergency is checked first — if both apply, emergency wins.
 */
export function keywordSafetyCheck(query: string): 'emergency' | 'crisis' | 'routine' {
  const q = query.toLowerCase()
  for (const kw of EMERGENCY_KEYWORDS) {
    if (q.includes(kw)) return 'emergency'
  }
  for (const kw of CRISIS_KEYWORDS) {
    if (q.includes(kw)) return 'crisis'
  }
  return 'routine'
}
