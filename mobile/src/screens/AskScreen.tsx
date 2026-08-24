import React, { useState, useRef, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, KeyboardAvoidingView,
  Platform, Pressable, Keyboard,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PAL, FONT, RADIUS, SPACE } from '../theme'
import { search, SearchResult } from '../lib/api'
import { SearchBar } from '../components/SearchBar'
import { SafetyBanner } from '../components/SafetyBanner'
import type { SafetyCategory } from '../services/fuguRouter'

// Optional on-device router — graceful degradation if ONNX not loaded
let FuguRouterClass: any = null
try { FuguRouterClass = require('../services/fuguRouter').FuguRouter } catch {}

interface Message {
  id: string
  role: 'user' | 'pal'
  text: string
  citations?: SearchResult['citations']
}

const SESSION_ID = 'mobile-' + Date.now().toString(36)

export default function AskScreen({ navigation }: any) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [safetyCategory, setSafetyCategory] = useState<SafetyCategory | null>(null)
  const [conversationId, setConversationId] = useState<string | undefined>()
  const scrollRef = useRef<ScrollView>(null)
  const fuguRouter = useRef(FuguRouterClass ? new FuguRouterClass() : null)

  const handleSubmit = useCallback(async (query: string) => {
    if (!query.trim() || isLoading) return
    Keyboard.dismiss()
    const msgId = Date.now().toString()
    setMessages(prev => [...prev, { id: msgId, role: 'user', text: query }])
    setIsLoading(true)

    try {
      let classificationJson: string | undefined

      if (fuguRouter.current) {
        try {
          const decision = await fuguRouter.current.route({
            query,
            thread_summary: '',
            session_id: SESSION_ID,
            conversation_id: conversationId,
          })
          if (decision.safety_short_circuit) {
            setSafetyCategory(decision.classification?.safety_category ?? 'emergency')
            setIsLoading(false)
            return
          }
          if (decision.depth === 'on_device' && decision.on_device_answer) {
            setMessages(prev => [
              ...prev,
              { id: msgId + '-r', role: 'pal', text: decision.on_device_answer },
            ])
            setIsLoading(false)
            return
          }
          classificationJson = JSON.stringify(decision.classification)
        } catch {}
      }

      const result = await search(query, SESSION_ID, {
        conversationId,
        onDeviceClassificationJson: classificationJson,
      })

      if (result.conversation_id) setConversationId(result.conversation_id)

      setMessages(prev => [
        ...prev,
        {
          id: msgId + '-r',
          role: 'pal',
          text: result.answer_text,
          citations: result.citations,
        },
      ])
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: msgId + '-e',
          role: 'pal',
          text: err?.message ?? 'Could not reach PAL — is the backend running?',
        },
      ])
    } finally {
      setIsLoading(false)
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80)
    }
  }, [isLoading, conversationId])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>PAL</Text>
        <Pressable style={styles.gearBtn} onPress={() => navigation?.navigate('Settings')}>
          <Text style={styles.gearIcon}>⚙</Text>
        </Pressable>
      </View>

      {/* Safety banner */}
      {safetyCategory && (safetyCategory === 'emergency' || safetyCategory === 'crisis') && (
        <SafetyBanner
          visible={true}
          category={safetyCategory}
          onDismiss={() => setSafetyCategory(null)}
        />
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, messages.length === 0 && styles.contentCentered]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          messages.length > 0 && scrollRef.current?.scrollToEnd({ animated: false })
        }
      >
        {messages.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Ask PAL</Text>
            <Text style={styles.emptySub}>
              Ask anything about your health,{'\n'}medications, or appointments.
            </Text>
            <View style={styles.chips}>
              {['What is my LDL?', 'How does statins work?', 'Prepare for lipid test'].map(q => (
                <Pressable key={q} style={styles.chip} onPress={() => handleSubmit(q)}>
                  <Text style={styles.chipText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {messages.map(m => (
          <View key={m.id} style={m.role === 'user' ? styles.userRow : styles.palRow}>
            {m.role === 'pal' && (
              <View style={styles.palBadge}>
                <Text style={styles.palBadgeText}>P</Text>
              </View>
            )}
            <View style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.palBubble]}>
              <Text style={[styles.bubbleText, m.role === 'user' && styles.userBubbleText]}>
                {m.text}
              </Text>
              {m.citations && m.citations.length > 0 && (
                <View style={styles.cites}>
                  {m.citations.slice(0, 3).map((c, i) => (
                    <Text key={i} style={styles.cite}>↗ {c.title}</Text>
                  ))}
                </View>
              )}
            </View>
          </View>
        ))}

        {isLoading && (
          <View style={styles.palRow}>
            <View style={styles.palBadge}>
              <Text style={styles.palBadgeText}>P</Text>
            </View>
            <View style={[styles.bubble, styles.palBubble]}>
              <Text style={styles.thinking}>Thinking…</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Search bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.barWrap}>
          <SearchBar onSubmit={handleSubmit} isLoading={isLoading} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAL.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md,
    borderBottomWidth: 1, borderBottomColor: PAL.surfaceBorder, backgroundColor: '#fff',
  },
  headerTitle: { fontFamily: FONT.serif, fontSize: 20, fontWeight: '300', color: PAL.textDark },
  gearBtn: { padding: 6 },
  gearIcon: { fontSize: 18, color: PAL.textMuted },
  scroll: { flex: 1 },
  content: { padding: SPACE.lg, paddingBottom: SPACE.md, gap: SPACE.sm },
  contentCentered: { flex: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingHorizontal: SPACE.xl },
  emptyTitle: {
    fontFamily: FONT.serif, fontSize: 32, fontWeight: '300',
    color: PAL.textDark, marginBottom: SPACE.sm,
  },
  emptySub: {
    fontFamily: FONT.mono, fontSize: 12, color: PAL.textMuted,
    textAlign: 'center', lineHeight: 20, marginBottom: SPACE.xl,
  },
  chips: { gap: SPACE.sm, alignItems: 'center' },
  chip: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md, paddingVertical: 9,
    borderWidth: 1, borderColor: PAL.surfaceBorder,
  },
  chipText: { fontFamily: FONT.mono, fontSize: 11, color: PAL.jade },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  palRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
  palBadge: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: PAL.jadeFaint, borderWidth: 1, borderColor: PAL.jadeBorder,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
  },
  palBadgeText: { fontFamily: FONT.serif, fontSize: 12, color: PAL.jade, fontWeight: '700' },
  bubble: { maxWidth: '84%', borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 10 },
  palBubble: {
    backgroundColor: PAL.surface, borderWidth: 1, borderColor: PAL.surfaceBorder,
    borderBottomLeftRadius: 4, flex: 1,
  },
  userBubble: { backgroundColor: PAL.jade, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 14, color: PAL.textDark, lineHeight: 21 },
  userBubbleText: { color: PAL.navyDeep },
  thinking: { fontSize: 14, color: PAL.textMuted, fontStyle: 'italic' },
  cites: {
    marginTop: 8, borderTopWidth: 1, borderTopColor: PAL.surfaceBorder,
    paddingTop: 8, gap: 3,
  },
  cite: { fontFamily: FONT.mono, fontSize: 10, color: PAL.jade },
  barWrap: { backgroundColor: PAL.surface, borderTopWidth: 1, borderTopColor: PAL.surfaceBorder, paddingTop: SPACE.sm },
})
