/**
 * Tiny, dependency-free Markdown parser for PAL answers.
 *
 * The AI answers arrive as Markdown (### headings, **bold**, * bullets,
 * [links](url), --- rules). This turns them into a small block tree that the
 * web (React DOM) and the app (React Native) render with their own components.
 * The SAME file is used by both: web/lib/markdown.ts is a copy of
 * mobile/src/lib/markdown.ts — keep them identical.
 *
 * It never produces HTML strings, so there is nothing to sanitise.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'hr' }

/**
 * Repairs common damage before parsing: Windows newlines, headings or bullets
 * glued onto the end of the previous sentence (text that lost its newlines),
 * and "***Label:**" (a bullet whose space after "*" was lost).
 */
export function normalizeMarkdown(src: string): string {
  let s = (src ?? '').replace(/\r\n?/g, '\n')
  // "...end.### 2. Next" → heading on its own line (needs ## or more, so "C#" is safe)
  s = s.replace(/([^\n#])[ \t]*(#{2,6}[ \t]+)/g, '$1\n\n$2')
  // "...end.* **Label:**" → bullet on its own line
  s = s.replace(/([.:!?)\]])[ \t]*\*[ \t]+(?=\*\*)/g, '$1\n* ')
  // "...end.*****Disclaimer:**" → rule, then the bold paragraph
  s = s.replace(/([^\n*])[ \t]*\*{5}(?=[^*\s])/g, '$1\n\n***\n\n**')
  return s
}

const URL_RE = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]]/

/** Inline parser: **bold**, __bold__, *italic*, _italic_, `code`, [text](url), bare URLs. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    // `code`
    if (rest[0] === '`') {
      const end = rest.indexOf('`', 1)
      if (end > 1) {
        flush()
        out.push({ t: 'code', v: rest.slice(1, end) })
        i += end + 1
        continue
      }
    }
    // [text](url)
    if (rest[0] === '[') {
      const m = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(rest)
      if (m) {
        flush()
        out.push({ t: 'link', href: m[2], c: parseInline(m[1]) })
        i += m[0].length
        continue
      }
    }
    // bare URL
    if (rest[0] === 'h') {
      const m = URL_RE.exec(rest)
      if (m) {
        flush()
        out.push({ t: 'link', href: m[0], c: [{ t: 'text', v: m[0] }] })
        i += m[0].length
        continue
      }
    }
    // ***bold italic***
    if (rest.startsWith('***')) {
      const end = rest.indexOf('***', 3)
      if (end > 3) {
        flush()
        out.push({ t: 'b', c: [{ t: 'i', c: parseInline(rest.slice(3, end)) }] })
        i += end + 3
        continue
      }
    }
    // **bold** / __bold__
    if (rest.startsWith('**') || rest.startsWith('__')) {
      const mark = rest.slice(0, 2)
      const end = rest.indexOf(mark, 2)
      if (end > 2) {
        flush()
        out.push({ t: 'b', c: parseInline(rest.slice(2, end)) })
        i += end + 2
        continue
      }
    }
    // *italic* / _italic_ (not "2 * 3", not snake_case)
    if ((rest[0] === '*' || rest[0] === '_') && rest[1] && rest[1] !== ' ' && rest[1] !== rest[0]) {
      const prev = i > 0 ? src[i - 1] : ' '
      if (rest[0] === '*' || !/\w/.test(prev)) {
        const end = rest.indexOf(rest[0], 1)
        if (end > 1 && rest[end - 1] !== ' ' && (rest[0] === '*' || !/\w/.test(rest[end + 1] ?? ''))) {
          flush()
          out.push({ t: 'i', c: parseInline(rest.slice(1, end)) })
          i += end + 1
          continue
        }
      }
    }
    buf += rest[0]
    i++
  }
  flush()
  return out
}

/** Block parser. */
export function parseMarkdown(src: string): Block[] {
  const lines = normalizeMarkdown(src).split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let list: { t: 'ul' | 'ol'; start: number; items: string[] } | null = null

  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n')) })
    para = []
  }
  const endList = () => {
    if (list) {
      const items = list.items.map(parseInline)
      blocks.push(list.t === 'ul' ? { t: 'ul', items } : { t: 'ol', start: list.start, items })
    }
    list = null
  }
  const addItem = (kind: 'ul' | 'ol', text: string, start = 1) => {
    endPara()
    if (!list || list.t !== kind) {
      endList()
      list = { t: kind, start, items: [] }
    }
    list.items.push(text)
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      endPara()
      endList()
      continue
    }
    // whole line ***bold italic*** → bold paragraph
    if (/^\*{3}[^*].*[^*]\*{3}$/.test(line)) {
      endPara()
      endList()
      blocks.push({ t: 'p', c: parseInline(line) })
      continue
    }
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line)) {
      endPara()
      endList()
      blocks.push({ t: 'hr' })
      continue
    }
    // "*****Bold:** text" → rule + paragraph
    let m = /^\*{5}(\S.*)$/.exec(line)
    if (m) {
      endPara()
      endList()
      blocks.push({ t: 'hr' })
      para.push('**' + m[1])
      continue
    }
    m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line)
    if (m) {
      endPara()
      endList()
      blocks.push({ t: 'h', level: m[1].length, c: parseInline(m[2]) })
      continue
    }
    // "***Label:** text" → bullet with bold label (space after "*" was lost)
    m = /^\*{3}([^*\s][^*]*\*\*.*)$/.exec(line)
    if (m) {
      addItem('ul', '**' + m[1])
      continue
    }
    m = /^[*\-•+]\s+(.*)$/.exec(line)
    if (m) {
      addItem('ul', m[1])
      continue
    }
    m = /^(\d{1,3})[.)]\s+(.*)$/.exec(line)
    if (m) {
      addItem('ol', m[2], parseInt(m[1], 10))
      continue
    }
    m = /^>\s?(.*)$/.exec(line)
    if (m) {
      endPara()
      endList()
      blocks.push({ t: 'quote', c: parseInline(m[1]) })
      continue
    }
    // continuation of a list item (indented line) or a paragraph line
    if (list && /^\s{2,}/.test(raw)) {
      const items = (list as { items: string[] }).items
      items[items.length - 1] += ' ' + line
      continue
    }
    endList()
    para.push(line)
  }
  endPara()
  endList()
  return blocks
}

/** Plain text (for Copy): Markdown symbols removed, structure kept. */
export function markdownToPlainText(src: string): string {
  const inl = (c: Inline[]): string =>
    c.map(n => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'link' ? `${inl(n.c)}${inl(n.c) === n.href ? '' : ` (${n.href})`}` : inl(n.c))).join('')
  return parseMarkdown(src)
    .map(b => {
      switch (b.t) {
        case 'h':
        case 'p':
        case 'quote':
          return inl(b.c)
        case 'ul':
          return b.items.map(it => `• ${inl(it)}`).join('\n')
        case 'ol':
          return b.items.map((it, k) => `${b.start + k}. ${inl(it)}`).join('\n')
        case 'hr':
          return '—'
      }
    })
    .join('\n\n')
}
