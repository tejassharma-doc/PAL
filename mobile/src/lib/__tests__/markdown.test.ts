import { parseMarkdown, parseInline, markdownToPlainText } from '../markdown'

const EX1 = `### 1. Symptom Log
Since this is a general consultation, be prepared to discuss:

* **Current Symptoms:** What are you feeling? (e.g., fatigue, pain, cough, etc.)
* **Onset & Duration:** When did these symptoms start? Are they constant or intermittent?
* **Severity:** On a scale of 1-10, how much do they affect your daily life?

***Triggers:** Does anything specific make the symptoms better or worse?`

// The second example as pasted: all newlines lost.
const EX2 = `there are over 100 different types, each named after the organ.Based on current medical literature, here is an overview:### 1. Pathophysiology (How it works)Cancer occurs when cells grow. These cells can form masses called **tumors**.* **Benign tumors:** These are non-cancerous.* **Malignant tumors:** These spread (a process called **metastasis**).### 2. Risk FactorsSome text.*****Disclaimer:** I am an AI assistant, not a doctor.***Sources:*** *Blücher. "An overview." Diabetes Obes Metab (2025).`

test('example 1: heading, bullets with bold labels, glued bullet', () => {
  const b = parseMarkdown(EX1)
  expect(b[0]).toEqual({ t: 'h', level: 3, c: [{ t: 'text', v: '1. Symptom Log' }] })
  expect(b[1].t).toBe('p')
  expect(b[2].t).toBe('ul')
  expect((b[2] as any).items).toHaveLength(3)
  expect((b[2] as any).items[0][0]).toEqual({ t: 'b', c: [{ t: 'text', v: 'Current Symptoms:' }] })
  expect(b[3].t).toBe('ul')
  expect((b[3] as any).items[0][0]).toEqual({ t: 'b', c: [{ t: 'text', v: 'Triggers:' }] })
  expect(JSON.stringify(b)).not.toMatch(/\*\*|###/)
})

test('example 2: collapsed text still gets headings, bullets, rule and bold', () => {
  const b = parseMarkdown(EX2)
  const kinds = b.map(x => x.t)
  expect(kinds.filter(k => k === 'h')).toHaveLength(2)
  expect(kinds).toContain('ul')
  expect(kinds).toContain('hr')
  const flat = JSON.stringify(b)
  expect(flat).not.toMatch(/###/)
  expect(flat).toContain('"t":"b","c":[{"t":"text","v":"Disclaimer:"}]')
  expect(flat).toContain('"t":"b","c":[{"t":"text","v":"tumors"}]')
})

test('links, bare URLs, italics, code; arithmetic stays text', () => {
  expect(parseInline('see [PubMed](https://pubmed.ncbi.nlm.nih.gov/123) now')[1]).toEqual({
    t: 'link', href: 'https://pubmed.ncbi.nlm.nih.gov/123', c: [{ t: 'text', v: 'PubMed' }],
  })
  expect(parseInline('go to https://palcare.life.')[1]).toEqual({
    t: 'link', href: 'https://palcare.life', c: [{ t: 'text', v: 'https://palcare.life' }],
  })
  expect(parseInline('an *italic* word')[1]).toEqual({ t: 'i', c: [{ t: 'text', v: 'italic' }] })
  expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }])
  expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }])
  expect(parseInline('use `x`')[1]).toEqual({ t: 'code', v: 'x' })
})

test('numbered lists and plain text export', () => {
  const b = parseMarkdown('Steps:\n1. Rest\n2. **Drink** water\n\nhttps://a.org')
  expect(b[1]).toMatchObject({ t: 'ol', start: 1 })
  expect(markdownToPlainText('### Hi\n* **A:** b\n\n---\nSee [x](https://x.org)')).toBe('Hi\n\n• A: b\n\n—\n\nSee x (https://x.org)')
})

test('plain text without markdown is one paragraph, unchanged', () => {
  expect(parseMarkdown('Hello there. How are you?')).toEqual([{ t: 'p', c: [{ t: 'text', v: 'Hello there. How are you?' }] }])
})
