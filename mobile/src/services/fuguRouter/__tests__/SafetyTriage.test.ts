import {safetyTriage, mergeSafety, isShortCircuit} from '../SafetyTriage'

describe('safetyTriage — keyword detection', () => {
  test.each([
    ['chest pain',           'emergency'],
    ['I have chest pain',    'emergency'],
    ['CHEST PAIN',           'emergency'],  // case-insensitive
    ['heart attack',         'emergency'],
    ['severe bleeding',      'emergency'],
    ["can't breathe",        'emergency'],
    ['overdose',             'emergency'],
  ])('"%s" → emergency', (query, expected) => {
    const result = safetyTriage(query)
    expect(result.category).toBe(expected)
    expect(result.keyword_triggered).toBe(true)
  })

  test.each([
    ['suicide',          'crisis'],
    ['I want to hurt myself', 'crisis'],
    ['kill myself',      'crisis'],
    ['end my life',      'crisis'],
  ])('"%s" → crisis', (query, expected) => {
    const result = safetyTriage(query)
    expect(result.category).toBe(expected)
    expect(result.keyword_triggered).toBe(true)
  })

  test.each([
    ['what is diabetes'],
    ['hello'],
    ['book an appointment'],
    ['my blood test results'],
    ['what does metformin do'],
  ])('"%s" → routine', (query) => {
    const result = safetyTriage(query)
    expect(result.category).toBe('routine')
    expect(result.keyword_triggered).toBe(false)
  })
})

describe('mergeSafety', () => {
  test('keyword emergency overrides model routine', () => {
    const triage = {category: 'emergency' as const, keyword_triggered: true}
    expect(mergeSafety(triage, 'routine')).toBe('emergency')
  })

  test('keyword crisis overrides model urgent', () => {
    const triage = {category: 'crisis' as const, keyword_triggered: true}
    expect(mergeSafety(triage, 'urgent')).toBe('crisis')
  })

  test('non-triggered triage defers to model category', () => {
    const triage = {category: 'routine' as const, keyword_triggered: false}
    expect(mergeSafety(triage, 'urgent')).toBe('urgent')
  })

  test('non-triggered triage passes through model routine', () => {
    const triage = {category: 'routine' as const, keyword_triggered: false}
    expect(mergeSafety(triage, 'routine')).toBe('routine')
  })
})

describe('isShortCircuit', () => {
  test('emergency is a short circuit', () => expect(isShortCircuit('emergency')).toBe(true))
  test('crisis is a short circuit', () => expect(isShortCircuit('crisis')).toBe(true))
  test('urgent is not a short circuit', () => expect(isShortCircuit('urgent')).toBe(false))
  test('routine is not a short circuit', () => expect(isShortCircuit('routine')).toBe(false))
})
