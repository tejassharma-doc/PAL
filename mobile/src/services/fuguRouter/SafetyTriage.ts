/**
 * Stage 1: Safety triage — deterministic-assisted.
 *
 * Keyword check runs FIRST, synchronously, before any model inference.
 * Conservative design: ambiguous signals escalate, never downgrade.
 * Safety short-circuits the router entirely — no agent fan-out for emergencies or crises.
 */

import {keywordSafetyCheck} from './EMERGENCY_KEYWORDS'
import type {SafetyCategory} from './types'

export interface SafetyTriageResult {
  category: SafetyCategory
  /** True when a deterministic keyword matched — model cannot override this. */
  keyword_triggered: boolean
}

/**
 * Run safety triage on a query.
 * Returns immediately — no async, no model calls.
 * The model's safety_category output is merged in FuguRouter after classification
 * but never downgrades a keyword-triggered emergency/crisis.
 */
export function safetyTriage(query: string): SafetyTriageResult {
  const keyword = keywordSafetyCheck(query)
  return {
    category: keyword,
    keyword_triggered: keyword !== 'routine',
  }
}

/**
 * Merge keyword-triggered safety with model-predicted safety.
 * Keyword always wins — it cannot be overridden.
 */
export function mergeSafety(
  keywordResult: SafetyTriageResult,
  modelCategory: SafetyCategory,
): SafetyCategory {
  if (keywordResult.keyword_triggered) return keywordResult.category
  return modelCategory
}

/** Returns true if the safety category requires a short-circuit (no agents). */
export function isShortCircuit(category: SafetyCategory): boolean {
  return category === 'emergency' || category === 'crisis'
}
