import {applyDepthRules} from '../DepthRules'
import type {ClassificationOutput} from '../types'

function makeClassification(overrides: Partial<ClassificationOutput> = {}): ClassificationOutput {
  return {
    intents: [{agent: 'evidence', confidence: 0.85}],
    complexity: 'simple',
    scope: 'generic',
    scope_confidence: 0.80,
    needs_action: false,
    safety_category: 'routine',
    multilingual_lang: null,
    ...overrides,
  }
}

describe('applyDepthRules — safety short-circuit', () => {
  test('emergency → on_device + safety_short_circuit, no agents', () => {
    const decision = applyDepthRules(makeClassification({safety_category: 'emergency'}))
    expect(decision.depth).toBe('on_device')
    expect(decision.safety_short_circuit).toBe(true)
    expect(decision.agents_to_invoke).toHaveLength(0)
    expect(decision.load_record).toBe(false)
  })

  test('crisis → on_device + safety_short_circuit, no agents', () => {
    const decision = applyDepthRules(makeClassification({safety_category: 'crisis'}))
    expect(decision.depth).toBe('on_device')
    expect(decision.safety_short_circuit).toBe(true)
    expect(decision.agents_to_invoke).toHaveLength(0)
  })
})

describe('applyDepthRules — trivial complexity', () => {
  test('trivial → on_device, no agents, load_record=false', () => {
    const decision = applyDepthRules(makeClassification({complexity: 'trivial'}))
    expect(decision.depth).toBe('on_device')
    expect(decision.agents_to_invoke).toHaveLength(0)
    expect(decision.load_record).toBe(false)
    expect(decision.safety_short_circuit).toBeUndefined()
  })

  test('trivial + personal scope → on_device, load_record still false', () => {
    const decision = applyDepthRules(makeClassification({complexity: 'trivial', scope: 'personal'}))
    expect(decision.depth).toBe('on_device')
    expect(decision.load_record).toBe(false)  // trivial turns never load records
  })
})

describe('applyDepthRules — scope disambiguation', () => {
  test('ambiguous scope → requires_disambiguation', () => {
    const decision = applyDepthRules(makeClassification({scope: 'ambiguous'}))
    expect(decision.requires_disambiguation).toBe(true)
    expect(decision.agents_to_invoke).toHaveLength(0)
  })

  test('low scope confidence → requires_disambiguation', () => {
    const decision = applyDepthRules(makeClassification({scope_confidence: 0.50}))
    expect(decision.requires_disambiguation).toBe(true)
  })
})

describe('applyDepthRules — call complexity', () => {
  test('call → launch_hermes, no agents list', () => {
    const decision = applyDepthRules(makeClassification({complexity: 'call'}))
    expect(decision.depth).toBe('launch_hermes')
    expect(decision.agents_to_invoke).toHaveLength(0)
  })

  test('needs_action → launch_hermes regardless of complexity', () => {
    const decision = applyDepthRules(makeClassification({needs_action: true, complexity: 'simple'}))
    expect(decision.depth).toBe('launch_hermes')
  })

  test('call + personal scope → load_record=true', () => {
    const decision = applyDepthRules(makeClassification({complexity: 'call', scope: 'personal'}))
    expect(decision.load_record).toBe(true)
  })
})

describe('applyDepthRules — complex complexity', () => {
  test('complex → many agents, load_record=false for generic scope', () => {
    const decision = applyDepthRules(makeClassification({
      complexity: 'complex',
      intents: [
        {agent: 'records', confidence: 0.80},
        {agent: 'diet', confidence: 0.70},
      ],
    }))
    expect(decision.depth).toBe('many')
    expect(decision.load_record).toBe(false)
  })

  test('complex + personal → load_record=true', () => {
    const decision = applyDepthRules(makeClassification({
      complexity: 'complex',
      scope: 'personal',
      intents: [{agent: 'records', confidence: 0.80}],
    }))
    expect(decision.load_record).toBe(true)
  })

  test('urgent safety → many agents (all widened)', () => {
    const decision = applyDepthRules(makeClassification({
      complexity: 'simple',
      safety_category: 'urgent',
    }))
    expect(decision.depth).toBe('many')
    expect(decision.agents_to_invoke.length).toBeGreaterThan(1)
  })
})

describe('applyDepthRules — simple single-agent dispatch', () => {
  test('simple records → one agent, depth=one', () => {
    const decision = applyDepthRules(makeClassification({
      complexity: 'simple',
      intents: [{agent: 'records', confidence: 0.85}],
    }))
    expect(decision.depth).toBe('one')
    expect(decision.agents_to_invoke).toEqual(['records'])
  })

  test('simple medication → medication + evidence (always paired)', () => {
    const decision = applyDepthRules(makeClassification({
      complexity: 'simple',
      intents: [{agent: 'medication', confidence: 0.90}],
    }))
    expect(decision.agents_to_invoke).toContain('medication')
    expect(decision.agents_to_invoke).toContain('evidence')
    expect(decision.depth).toBe('many')
  })

  test('simple diet → one agent', () => {
    const decision = applyDepthRules(makeClassification({
      complexity: 'simple',
      intents: [{agent: 'diet', confidence: 0.88}],
    }))
    expect(decision.depth).toBe('one')
    expect(decision.agents_to_invoke).toEqual(['diet'])
  })

  test('low confidence top intent → many agents even with simple complexity', () => {
    const decision = applyDepthRules(makeClassification({
      complexity: 'simple',
      intents: [{agent: 'records', confidence: 0.60}],
    }))
    expect(decision.depth).toBe('many')
  })
})

describe('applyDepthRules — reason field (audit trail)', () => {
  test('every decision includes a reason string', () => {
    const cases: Partial<ClassificationOutput>[] = [
      {safety_category: 'emergency'},
      {complexity: 'trivial'},
      {complexity: 'call'},
      {complexity: 'complex'},
      {complexity: 'simple'},
    ]
    for (const c of cases) {
      const decision = applyDepthRules(makeClassification(c))
      expect(typeof decision.reason).toBe('string')
      expect(decision.reason.length).toBeGreaterThan(0)
    }
  })
})
