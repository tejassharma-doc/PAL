/**
 * Ask — the website's home tab: serif greeting with the jade italic
 * "What's on your mind?", "TRY ASKING" two-column prompt cards, chat bubbles
 * (user = deep green, PAL = white serif), breathing "thinking…" dot, a rose
 * consent card for "general vs my record", and the white composer pill.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { C, F, T } from '../theme'
import * as api from '../lib/api'
import { SafetyBanner } from '../components/SafetyBanner'
import { BreathDot, Slab } from '../components/ui'
import { TabChrome } from '../components/Chrome'
import { LineIcon } from '../components/icons'
import { CopyButton, Markdown } from '../components/Markdown'
import { PalRosette, PalVoice } from '../components/PalEmblem'
import { useAuth } from '../context/AuthContext'
import { route as fuguRoute } from '../services/fuguRouter'
import type { SafetyCategory } from '../services/fuguRouter'

interface Message {
  id: string
  role: 'user' | 'pal' | 'system' | 'consent' | 'thinking'
  text: string
  citations?: api.Citation[]
  query?: string
}

const PROMPTS = [
  { icon: 'stethoscope', text: 'What is type 2 diabetes?', sub: 'general · no record' },
  { icon: 'clipboard-list', text: 'Do my meds interact?', sub: 'about you · consent' },
  { icon: 'file-text', text: 'What do my latest lab results show?', sub: 'about you · record' },
  { icon: 'folder-heart', text: 'A heart-healthy dinner idea', sub: 'general · nutrition' },
]

const newSessionId = () => 'android-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function AskScreen({ route }: any) {
  const { session } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [safety, setSafety] = useState<SafetyCategory | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const sessionId = useRef(newSessionId())
  const scrollRef = useRef<ScrollView>(null)

  // "Prepare with PAL" on Visits opens Ask with a suggested question filled in.
  const prefill: string | undefined = route?.params?.prefill
  useEffect(() => {
    if (prefill) setText(prefill)
  }, [prefill])

  const name = session?.displayName && !session.displayName.startsWith('+') ? session.displayName : 'there'

  const push = (m: Message) => setMessages(prev => [...prev.filter(x => x.role !== 'thinking'), m])

  const send = useCallback(
    async (query: string, opts: { consentBasis?: 'per_query'; echo?: boolean } = {}) => {
      const q = query.trim()
      if (!q || busy) return
      Keyboard.dismiss()
      setText('')
      const id = Date.now().toString()
      setMessages(prev => [
        ...prev.filter(x => x.role !== 'consent'),
        ...(opts.echo === false ? [] : [{ id, role: 'user' as const, text: q }]),
        { id: id + '-t', role: 'thinking' as const, text: '' },
      ])
      setBusy(true)
      try {
        let classificationJson: string | null = null
        try {
          const d = await fuguRoute({ query: q, thread_summary: '', session_id: sessionId.current, conversation_id: conversationId ?? undefined })
          if (d.safety_short_circuit) {
            setSafety(d.classification?.safety_category === 'crisis' ? 'crisis' : 'emergency')
            setMessages(prev => prev.filter(x => x.role !== 'thinking'))
            return
          }
          classificationJson = JSON.stringify(d.classification)
        } catch {
          /* router unavailable — the server triages too */
        }

        const r = await api.ask({
          query: q,
          sessionId: sessionId.current,
          conversationId,
          consentBasis: opts.consentBasis,
          onDeviceClassificationJson: classificationJson,
        })
        switch (r.kind) {
          case 'answer':
            if (r.conversationId) setConversationId(r.conversationId)
            push({ id: id + '-r', role: 'pal', text: r.text || '(No answer text returned.)', citations: r.citations })
            break
          case 'disambiguation':
            push({ id: id + '-c', role: 'consent', text: r.question, query: q })
            break
          case 'safety':
            setSafety(r.category)
            push({ id: id + '-s', role: 'system', text: r.message })
            break
          case 'referral':
            push({ id: id + '-ref', role: 'pal', text: r.message + '\n\nYou can raise this at your next visit.' })
            break
          case 'on_device':
            if (r.conversationId) setConversationId(r.conversationId)
            push({ id: id + '-o', role: 'pal', text: 'Hello! Ask me about your health, your records or your medicines.' })
            break
        }
      } catch (e: any) {
        push({ id: id + '-e', role: 'system', text: e?.message ?? 'Could not reach PAL.' })
      } finally {
        setBusy(false)
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80)
      }
    },
    [busy, conversationId],
  )

  const newChat = () => {
    setMessages([])
    setConversationId(null)
    sessionId.current = newSessionId()
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <TabChrome title={session?.displayName && !session.displayName.startsWith('+') ? session.displayName : 'PAL'} sub="your health assistant" />
      {safety && <SafetyBanner visible category={safety} onDismiss={() => setSafety(null)} />}

      {messages.length > 0 && (
        <View style={s.chatBar}>
          <Text style={s.chatBarTitle}>Conversation</Text>
          <Pressable
            onPress={newChat}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="New chat"
            hitSlop={6}
            style={({ pressed }) => [s.newChat, (pressed || busy) && { opacity: 0.6 }]}
          >
            <LineIcon name="square-pen" size={19} color={C.jadeD} />
            <Text style={s.newChatText}>New chat</Text>
          </Pressable>
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => messages.length > 0 && scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 ? (
            <>
              <Text style={s.greet}>
                {greeting()}, {name}.{'\n'}
                <Text style={s.greetItalic}>What's on your mind?</Text>
              </Text>
              <Text style={[T.lead, { marginBottom: 14 }]}>Ask anything — general, or about you.</Text>
              <Text style={[T.meta, { textAlign: 'center', letterSpacing: 0.4, marginBottom: 6 }]}>tap a question below to see PAL work</Text>

              <View style={s.eyebrow}>
                <PalRosette size={16} color={C.jadeD} />
                <Slab color={C.jadeD} style={{ marginTop: 0, marginBottom: 0 }}>Try asking</Slab>
              </View>
              <View style={s.grid}>
                {PROMPTS.map(p => (
                  <Pressable key={p.text} style={({ pressed }) => [s.prompt, pressed && { opacity: 0.8 }]} onPress={() => send(p.text)}>
                    <LineIcon name={p.icon} size={22} />
                    <Text style={s.promptText}>{p.text}</Text>
                    <Text style={[T.meta, { fontSize: 12 }]}>{p.sub}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[T.meta, { textAlign: 'center', marginTop: 22, lineHeight: 15 }]}>
                PAL explains health information. It is not a diagnosis —{'\n'}talk to your doctor about treatment.
              </Text>
            </>
          ) : (
            <View style={{ gap: 10, paddingTop: 6 }}>
              {messages.map(m => {
                if (m.role === 'user')
                  return (
                    <View key={m.id} style={{ alignItems: 'flex-end' }}>
                      <View style={s.userBubble}>
                        <Text selectable style={s.userText}>
                          {m.text}
                        </Text>
                      </View>
                    </View>
                  )
                if (m.role === 'thinking')
                  return (
                    <View key={m.id} style={s.palRow}>
                    <PalVoice />
                    <View style={s.thinking}>
                      <BreathDot />
                      <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.jadeD, letterSpacing: 0.8 }}>thinking…</Text>
                    </View>
                    </View>
                  )
                if (m.role === 'consent')
                  return (
                    <View key={m.id} style={s.consent}>
                      <Text style={s.consentTitle}>◆ Use your record?</Text>
                      <Text style={s.consentBody}>{m.text}</Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable
                          style={[s.consentBtn, { backgroundColor: C.jade }]}
                          onPress={() => send(`About my own records: ${m.query}`, { consentBasis: 'per_query', echo: false })}
                        >
                          <Text style={[s.consentBtnText, { color: C.deep2 }]}>Use my record</Text>
                        </Pressable>
                        <Pressable
                          style={[s.consentBtn, { borderWidth: 1, borderColor: C.line2 }]}
                          onPress={() => send(`In general terms: ${m.query}`, { echo: false })}
                        >
                          <Text style={s.consentBtnText}>Keep it general</Text>
                        </Pressable>
                      </View>
                    </View>
                  )
                if (m.role === 'system')
                  return (
                    <View key={m.id} style={s.system}>
                      <Text style={{ fontFamily: F.sans, fontSize: 15, color: C.rose, lineHeight: 22 }}>{m.text}</Text>
                    </View>
                  )
                return (
                  <View key={m.id} style={s.palRow}>
                  <PalVoice />
                  <View style={s.palBubble}>
                    <Markdown text={m.text} />
                    {m.citations && m.citations.length > 0 && (
                      <View style={{ marginTop: 6, gap: 4 }}>
                        {m.citations.slice(0, 4).map((c, i) => {
                          const ok = !!c.url && /^https?:\/\//.test(c.url)
                          return (
                            <Text
                              key={i}
                              numberOfLines={2}
                              onPress={ok ? () => Linking.openURL(c.url!).catch(() => {}) : undefined}
                              style={s.cite}
                            >
                              {i + 1}. {c.title || c.source}
                            </Text>
                          )
                        })}
                      </View>
                    )}
                    <View style={s.answerActions}>
                      <CopyButton text={m.text} />
                    </View>
                  </View>
                  </View>
                )
              })}
            </View>
          )}
        </ScrollView>

        {/* Composer */}
        <View style={s.composerWrap}>
          <View style={s.composer}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={messages.length > 0 ? 'Ask a follow-up…' : 'Ask about your health…'}
              placeholderTextColor={C.muted}
              style={s.composerInput}
              multiline
              textAlignVertical="center"
              returnKeyType="send"
              onSubmitEditing={() => send(text)}
              editable={!busy}
              accessibilityLabel="Ask PAL"
            />
            <Pressable
              onPress={() => send(text)}
              disabled={!text.trim() || busy}
              accessibilityLabel="Send"
              style={[s.cBtn, { backgroundColor: text.trim() && !busy ? C.jadeD : 'rgba(31,125,107,0.35)' }]}
            >
              <LineIcon name="arrow-up" size={22} color="#fff" strokeWidth={2.4} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const s = StyleSheet.create({
  greet: { fontFamily: F.serifLight, fontSize: 27, letterSpacing: -0.2, lineHeight: 31, color: C.ink, marginTop: 12, marginBottom: 6 },
  greetItalic: { fontFamily: F.serifLightItalic, color: C.jadeD },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  prompt: {
    width: '48.5%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 13,
    padding: 13,
    gap: 6,
  },
  promptText: { fontFamily: F.sansSemi, fontSize: 15, lineHeight: 19, color: C.ink },
  userBubble: {
    backgroundColor: C.deep,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '82%',
  },
  userText: { fontFamily: F.sans, fontSize: 16.5, lineHeight: 25, color: C.paper },
  palBubble: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    borderBottomLeftRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flex: 1,
  },
  palRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, width: '100%' },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 10, marginHorizontal: 2 },
  answerActions: { flexDirection: 'row', marginTop: 8, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 4 },
  chatBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    backgroundColor: C.soft,
  },
  chatBarTitle: { fontFamily: F.sansSemi, fontSize: 16, color: C.ink },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(31,125,107,0.4)',
    backgroundColor: C.activeTint,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  newChatText: { fontFamily: F.sansBold, fontSize: 15, color: C.jadeD },
  cite: { fontFamily: F.sans, fontSize: 13.5, color: C.amberD, textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  thinking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    borderTopLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  consent: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    borderWidth: 1,
    borderColor: 'rgba(216,162,74,0.55)',
    backgroundColor: C.roseTint,
    borderRadius: 14,
    borderTopLeftRadius: 4,
    padding: 13,
  },
  consentTitle: { fontFamily: F.sansSemi, fontSize: 15, color: C.rose, marginBottom: 5 },
  consentBody: { fontFamily: F.sans, fontSize: 15, color: C.ink, lineHeight: 22, marginBottom: 12 },
  consentBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  consentBtnText: { fontFamily: F.sansSemi, fontSize: 13.5, color: C.ink },
  system: { backgroundColor: '#fff', borderLeftWidth: 3, borderLeftColor: C.rose, borderRadius: 12, padding: 11 },
  composerWrap: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: 'rgba(251,249,244,0.97)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(13,31,36,0.08)',
  },
  composer: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    elevation: 2,
  },
  composerInput: { flex: 1, fontFamily: F.sans, fontSize: 17, lineHeight: 23, color: C.ink, paddingVertical: 8, minHeight: 42, maxHeight: 132 },
  cBtn: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})
