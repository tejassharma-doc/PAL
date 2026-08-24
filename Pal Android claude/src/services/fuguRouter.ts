/**
 * FuguRouter — on-device intent classifier stub for Android.
 *
 * The full FuguRouter uses an ONNX model for on-device classification.
 * This stub provides the same interface with keyword-based safety triage
 * so the app works without the ONNX model bundle (which ships separately).
 *
 * Safety triage runs FIRST and is keyword-deterministic.
 * On-device LLM triage runs SECOND for non-emergency queries.
 * Cloud dispatch (POST /api/v1/search) runs LAST for complex queries.
 */

export type SafetyCategory = 'emergency' | 'crisis' | 'none'

export interface RouterDecision {
  depth: 'on_device' | 'one' | 'many' | 'launch_hermes'
  on_device_answer?: string
  safety_short_circuit: boolean
  requires_disambiguation: boolean
  agents_to_invoke: string[]
  classification: {
    intents: string[]
    scope: 'personal' | 'general'
    scope_confidence: number
    complexity: 'low' | 'medium' | 'high'
    needs_action: boolean
    safety_category: SafetyCategory
    multilingual_lang?: string
  }
}

// Keywords that trigger immediate safety short-circuit (no API call)
const EMERGENCY_KW = [
  'chest pain', 'heart attack', 'stroke', 'can\'t breathe', 'cannot breathe',
  'unconscious', 'seizure', 'overdose', 'severe bleeding', 'suicide', 'kill myself',
  'want to die', 'ending my life', 'end my life',
]

const CRISIS_KW = [
  'depressed', 'hopeless', 'self harm', 'self-harm', 'cutting myself',
  'mental health crisis', 'panic attack',
]

export class FuguRouter {
  async route(input: {
    query: string
    thread_summary: string
    session_id: string
    conversation_id?: string
  }): Promise<RouterDecision> {
    const q = input.query.toLowerCase()

    // Safety triage — keyword-deterministic, runs before any LLM
    for (const kw of EMERGENCY_KW) {
      if (q.includes(kw)) {
        return {
          depth: 'on_device',
          safety_short_circuit: true,
          requires_disambiguation: false,
          agents_to_invoke: [],
          classification: {
            intents: ['safety'],
            scope: 'personal',
            scope_confidence: 1,
            complexity: 'low',
            needs_action: false,
            safety_category: (
              q.includes('suicide') ||
              q.includes('kill myself') ||
              q.includes('want to die') ||
              q.includes('ending my life') ||
              q.includes('end my life')
            ) ? 'crisis' : 'emergency',
          },
        }
      }
    }
    for (const kw of CRISIS_KW) {
      if (q.includes(kw)) {
        return {
          depth: 'on_device',
          safety_short_circuit: true,
          requires_disambiguation: false,
          agents_to_invoke: [],
          classification: {
            intents: ['safety'],
            scope: 'personal',
            scope_confidence: 1,
            complexity: 'low',
            needs_action: false,
            safety_category: 'crisis',
          },
        }
      }
    }

    // Simple greeting / on-device answer
    if (/^(hi|hello|hey|thanks|thank you|ok|okay)[\s!?.]*$/.test(q)) {
      return {
        depth: 'on_device',
        on_device_answer: 'Hi! Ask me anything about your health.',
        safety_short_circuit: false,
        requires_disambiguation: false,
        agents_to_invoke: [],
        classification: {
          intents: ['greeting'],
          scope: 'general',
          scope_confidence: 1,
          complexity: 'low',
          needs_action: false,
          safety_category: 'none',
        },
      }
    }

    // Default: route to cloud
    return {
      depth: 'one',
      safety_short_circuit: false,
      requires_disambiguation: false,
      agents_to_invoke: ['evidence'],
      classification: {
        intents: ['health_query'],
        scope: q.includes('my ') ? 'personal' : 'general',
        scope_confidence: 0.7,
        complexity: 'medium',
        needs_action: false,
        safety_category: 'none',
      },
    }
  }
}
