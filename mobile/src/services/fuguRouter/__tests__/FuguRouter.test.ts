/**
 * FuguRouter integration tests — multi-turn acceptance scenario from the spec.
 *
 * The spec defines this exact five-turn sequence:
 *   Turn 1: "what is diabetes?"     → simple/generic → ONE evidence
 *   Turn 2: "am I at risk…labs?"    → complex/personal → MANY (records+evidence)
 *   Turn 3: "what should I eat…"    → complex/personal → MANY (diet+records+evidence)
 *   Turn 4: "book a review…"        → call → launch_hermes
 *   Turn 5: "thanks!"               → trivial → on_device
 *
 * FuguClassifier uses onnxruntime-react-native which is mocked in jest.setup.js.
 * The mock returns deterministic outputs based on the query string so we can
 * control classification output from tests without a real ONNX model.
 */

import {route, initFuguRouter} from '../FuguRouter'
import type {RouterDecision} from '../types'

// ── Mock FuguClassifier to return controlled outputs ───────────────────────

jest.mock('../FuguClassifier', () => ({
  initClassifier: jest.fn().mockResolvedValue(undefined),
  classify: jest.fn().mockImplementation(async (query: string) => {
    const q = query.toLowerCase()

    // trivial
    if (/^(thanks|thank you|hello|hi|bye)/.test(q)) {
      return {intents: [], complexity: 'trivial', scope: 'generic', scope_confidence: 0.95,
               needs_action: false, safety_category: 'routine', multilingual_lang: null}
    }
    // call / booking
    if (/book|appointment|schedule/.test(q)) {
      return {intents: [{agent: 'appointment', confidence: 0.91}], complexity: 'call',
               scope: 'personal', scope_confidence: 0.85,
               needs_action: true, safety_category: 'routine', multilingual_lang: null}
    }
    // complex personal — diet / labs
    if (/eat|cholesterol|food|diet/.test(q)) {
      return {intents: [
               {agent: 'diet', confidence: 0.87},
               {agent: 'records', confidence: 0.72},
               {agent: 'evidence', confidence: 0.65},
             ], complexity: 'complex', scope: 'personal', scope_confidence: 0.82,
               needs_action: false, safety_category: 'routine', multilingual_lang: null}
    }
    // complex personal — risk / labs
    if (/risk|lab|blood/.test(q)) {
      return {intents: [
               {agent: 'records', confidence: 0.84},
               {agent: 'evidence', confidence: 0.70},
             ], complexity: 'complex', scope: 'personal', scope_confidence: 0.78,
               needs_action: false, safety_category: 'routine', multilingual_lang: null}
    }
    // default simple generic
    return {intents: [{agent: 'evidence', confidence: 0.85}], complexity: 'simple',
             scope: 'generic', scope_confidence: 0.80,
             needs_action: false, safety_category: 'routine', multilingual_lang: null}
  }),
}))

// ── Helper ─────────────────────────────────────────────────────────────────

async function turn(query: string, conversationId = 'conv_test'): Promise<RouterDecision> {
  return route({query, thread_summary: '', session_id: 'test', conversation_id: conversationId})
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initFuguRouter()
})

describe('Multi-turn acceptance scenario (spec §acceptance)', () => {
  test('Turn 1: "what is diabetes?" → ONE agent (evidence), generic scope, no record load', async () => {
    const d = await turn('what is diabetes?')
    expect(d.depth).toBe('one')
    expect(d.agents_to_invoke).toContain('evidence')
    expect(d.load_record).toBe(false)
    expect(d.classification.complexity).toBe('simple')
    expect(d.classification.scope).toBe('generic')
  })

  test('Turn 2: "am I at risk given my labs?" → MANY agents, personal scope, load record', async () => {
    const d = await turn('am I at risk given my labs?')
    expect(d.depth).toBe('many')
    expect(d.agents_to_invoke).toContain('records')
    expect(d.agents_to_invoke).toContain('evidence')
    expect(d.load_record).toBe(true)
    expect(d.classification.complexity).toBe('complex')
    expect(d.classification.scope).toBe('personal')
  })

  test('Turn 3: "what should I eat…cholesterol?" → MANY agents, diet+records+evidence', async () => {
    const d = await turn('what should I eat for my cholesterol?')
    expect(d.depth).toBe('many')
    expect(d.agents_to_invoke).toContain('diet')
    expect(d.load_record).toBe(true)
    expect(d.classification.complexity).toBe('complex')
  })

  test('Turn 4: "book a review with my doctor" → launch_hermes', async () => {
    const d = await turn('book a review with my doctor')
    expect(d.depth).toBe('launch_hermes')
    expect(d.classification.complexity).toBe('call')
    expect(d.classification.needs_action).toBe(true)
  })

  test('Turn 5: "thanks!" → on_device, 0 agents, on_device_answer provided', async () => {
    const d = await turn('thanks!')
    expect(d.depth).toBe('on_device')
    expect(d.agents_to_invoke).toHaveLength(0)
    expect(d.on_device_answer).toBeTruthy()
    expect(d.safety_short_circuit).toBeUndefined()
    expect(d.load_record).toBe(false)
  })
})

describe('Safety short-circuit — fires before model', () => {
  test('emergency keyword → on_device + short circuit, no agents', async () => {
    const d = await turn('I have chest pain and can\'t breathe')
    expect(d.depth).toBe('on_device')
    expect(d.safety_short_circuit).toBe(true)
    expect(d.agents_to_invoke).toHaveLength(0)
    expect(d.load_record).toBe(false)
  })

  test('crisis keyword → on_device + short circuit', async () => {
    const d = await turn('I want to kill myself')
    expect(d.depth).toBe('on_device')
    expect(d.safety_short_circuit).toBe(true)
  })
})

describe('Router fallback on classifier error', () => {
  test('model crash → conservative simple fallback still routes to cloud', async () => {
    // Temporarily make classify throw
    const {classify} = require('../FuguClassifier')
    const original = classify.getMockImplementation()
    classify.mockRejectedValueOnce(new Error('ONNX session crashed'))

    const d = await turn('what is metformin?')
    // Fallback produces empty intents + simple — depth rules with no intents → many
    expect(['one', 'many']).toContain(d.depth)

    classify.mockImplementation(original)
  })
})
