/**
 * Renders PAL answers (Markdown) as real formatting: headings, bold, italics,
 * bullet / numbered lists, rules, tappable links. Every Text is selectable so
 * the answer can be copied; CopyButton copies the whole answer as plain text.
 * The website renders the same block tree (web/components/Markdown.tsx).
 */
import React, { useEffect, useRef, useState } from 'react'
import { Clipboard, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { C, F } from '../theme'
import { LineIcon } from './icons'
import { Block, Inline, markdownToPlainText, parseMarkdown } from '../lib/markdown'

function renderInline(nodes: Inline[], key = 'i'): React.ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`
    switch (n.t) {
      case 'text':
        return n.v
      case 'b':
        return (
          <Text key={k} style={s.bold}>
            {renderInline(n.c, k)}
          </Text>
        )
      case 'i':
        return (
          <Text key={k} style={s.italic}>
            {renderInline(n.c, k)}
          </Text>
        )
      case 'code':
        return (
          <Text key={k} style={s.code}>
            {n.v}
          </Text>
        )
      case 'link':
        return (
          <Text key={k} style={s.link} accessibilityRole="link" onPress={() => Linking.openURL(n.href).catch(() => {})}>
            {renderInline(n.c, k)}
          </Text>
        )
    }
  })
}

const inlineText = (c: Inline[]): string => c.map(n => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('')
/** A paragraph that starts with bold "Disclaimer" is shown as a soft note. */
const isDisclaimer = (b: Block) => b.t === 'p' && b.c[0]?.t === 'b' && /^\s*disclaimer/i.test(inlineText(b.c[0].c))

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text)
  return (
    <View>
      {blocks.map((b, i) => {
        const first = i === 0
        switch (b.t) {
          case 'h':
            return (
              <Text key={i} selectable style={[b.level <= 1 ? s.h1 : b.level === 2 ? s.h2 : s.h3, first && { marginTop: 0 }]}>
                {renderInline(b.c)}
              </Text>
            )
          case 'p':
            if (isDisclaimer(b))
              return (
                <View key={i} style={s.callout}>
                  <Text selectable style={s.calloutText}>
                    {renderInline(b.c)}
                  </Text>
                </View>
              )
            return (
              <Text key={i} selectable style={[s.p, first && { marginTop: 0 }]}>
                {renderInline(b.c)}
              </Text>
            )
          case 'quote':
            return (
              <View key={i} style={s.quote}>
                <Text selectable style={s.p}>
                  {renderInline(b.c)}
                </Text>
              </View>
            )
          case 'ul':
          case 'ol':
            return (
              <View key={i} style={[s.list, first && { marginTop: 0 }]}>
                {b.items.map((it, j) => (
                  <View key={j} style={s.li}>
                    <Text style={s.marker}>{b.t === 'ul' ? '•' : `${b.start + j}.`}</Text>
                    <Text selectable style={s.liText}>
                      {renderInline(it)}
                    </Text>
                  </View>
                ))}
              </View>
            )
          case 'hr':
            return <View key={i} style={s.hr} />
        }
      })}
    </View>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Copy answer"
      hitSlop={8}
      onPress={() => {
        Clipboard.setString(markdownToPlainText(text))
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 2000)
      }}
      style={({ pressed }) => [s.copy, pressed && { opacity: 0.7 }]}
    >
      <LineIcon name={copied ? 'check' : 'copy'} size={17} color={copied ? C.jadeD : C.icon} />
      <Text style={[s.copyText, copied && { color: C.jadeD }]}>{copied ? 'Copied' : 'Copy'}</Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  h1: { fontFamily: F.serifMedium, fontSize: 21, lineHeight: 27, color: C.ink, marginTop: 14, marginBottom: 4 },
  h2: { fontFamily: F.serifMedium, fontSize: 19.5, lineHeight: 25, color: C.ink, marginTop: 14, marginBottom: 4 },
  h3: { fontFamily: F.serifMedium, fontSize: 18.5, lineHeight: 24, color: C.ink, marginTop: 12, marginBottom: 2 },
  p: { fontFamily: F.sans, fontSize: 16.5, lineHeight: 26, color: C.ink, marginTop: 8 },
  bold: { fontFamily: F.sansBold },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: F.mono, fontSize: 14.5, backgroundColor: 'rgba(13,31,36,0.06)' },
  link: { color: C.jadeD, textDecorationLine: 'underline' },
  list: { marginTop: 8, gap: 6 },
  li: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  marker: { fontFamily: F.sansBold, fontSize: 16.5, lineHeight: 26, color: C.jadeD, minWidth: 14 },
  liText: { flex: 1, fontFamily: F.sans, fontSize: 16.5, lineHeight: 26, color: C.ink },
  hr: { height: 1, backgroundColor: C.line, marginVertical: 12 },
  quote: { borderLeftWidth: 3, borderLeftColor: C.jade, paddingLeft: 10, marginTop: 8 },
  callout: { backgroundColor: 'rgba(13,31,36,0.04)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
  calloutText: { fontFamily: F.sans, fontSize: 15, lineHeight: 22, color: C.muted },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 2 },
  copyText: { fontFamily: F.sansSemi, fontSize: 14, color: C.icon },
})
