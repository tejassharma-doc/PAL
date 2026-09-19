/**
 * Stage 3: Deterministic depth rules — exact TypeScript mirror of planner.py.
 *
 * Inputs: ClassificationOutput from FuguClassifier (after safety merge).
 * Output: RouterDecision.
 *
 * No LLM judgment here — every branch is a deterministic rule.
 * Rules are intentionally kept identical to api/services/hermes/planner.py
 * so that on-device decisions match what the cloud planner would choose.
 */

import type {AgentName, ClassificationOutput, RouterDecision, RoutingDepth} from './types'

const ALL_AGENTS: AgentName[] = ['records', 'medication', 'appointment', 'diet', 'evidence']

// Agents that always pull evidence alongside them for clinical safety
const ALWAYS_WITH_EVIDENCE = new Set<AgentName>(['medication'])

// Minimum confidence threshold for a single-agent simple dispatch
const SINGLE_AGENT_CONFIDENCE = 0.75

// Confidence below which we treat scope as ambiguous
const SCOPE_CONFIDENCE_MIN = 0.60

function agentsFromIntents(intents: ClassificationOutput['intents']): AgentName[] {
  const seen = new Set<AgentName>()
  const out: AgentName[] = []
  for (const {agent} of intents) {
    if (!seen.has(agent)) { seen.add(agent); out.push(agent) }
    if (ALWAYS_WITH_EVIDENCE.has(agent) && !seen.has('evidence')) {
      seen.add('evidence'); out.push('evidence')
    }
  }
  return out
}

/**
 * Apply deterministic depth rules to a ClassificationOutput.
 * Call this after safetyTriage + mergeSafety — safety_category must already be merged.
 */
export function applyDepthRules(cls: ClassificationOutput): RouterDecision {
  const loadRecord = cls.scope === 'personal'

  // ── Stage 1: safety short-circuit (no agents for emergency/crisis) ──
  if (cls.safety_category === 'emergency' || cls.safety_category === 'crisis') {
    return {
      depth: 'on_device',
      agents_to_invoke: [],
      load_record: false,
      safety_short_circuit: true,
      reason: `safety_short_circuit:${cls.safety_category}`,
      classification: cls,
    }
  }

  // ── Stage 2: trivial turns handled entirely on-device ──
  if (cls.complexity === 'trivial') {
    return {
      depth: 'on_device',
      agents_to_invoke: [],
      load_record: false,
      reason: 'trivial:on_device',
      classification: cls,
    }
  }

  // ── Stage 3: ambiguous scope → disambiguation required before dispatching ──
  if (cls.scope === 'ambiguous' || cls.scope_confidence < SCOPE_CONFIDENCE_MIN) {
    return {
      depth: 'one',
      agents_to_invoke: [],
      load_record: false,
      requires_disambiguation: true,
      reason: `disambiguation:scope=${cls.scope}:conf=${cls.scope_confidence.toFixed(2)}`,
      classification: cls,
    }
  }

  // ── Stage 4: call → launch stateful Hermes workflow ──
  if (cls.complexity === 'call' || cls.needs_action) {
    return {
      depth: 'launch_hermes',
      agents_to_invoke: [],
      load_record: loadRecord,
      reason: 'call:launch_hermes',
      classification: cls,
    }
  }

  const top = cls.intents[0]

  // ── Stage 5: complex or low-confidence → fan-out to all (or multi) agents ──
  if (
    cls.complexity === 'complex' ||
    cls.safety_category === 'urgent' ||
    !top ||
    top.confidence < SINGLE_AGENT_CONFIDENCE
  ) {
    // Urgent safety: widen to all agents
    const agents = cls.safety_category === 'urgent'
      ? ALL_AGENTS.slice()
      : agentsFromIntents(cls.intents).length > 0
        ? agentsFromIntents(cls.intents)
        : ALL_AGENTS.slice()

    return {
      depth: 'many',
      agents_to_invoke: agents,
      load_record: loadRecord,
      reason: `complex:${cls.complexity}:safety=${cls.safety_category}`,
      classification: cls,
    }
  }

  // ── Stage 6: simple single-agent dispatch ──
  const singleAgents = agentsFromIntents([top])
  const depth: RoutingDepth = singleAgents.length > 1 ? 'many' : 'one'
  return {
    depth,
    agents_to_invoke: singleAgents,
    load_record: loadRecord,
    reason: `simple:${top.agent}@${top.confidence.toFixed(2)}`,
    classification: cls,
  }
}
