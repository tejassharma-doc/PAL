import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, PermissionsAndroid,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PAL, FONT, RADIUS, SPACE } from '../theme'
import { sendCallTurn, endCall, CallSession } from '../lib/api'

// Optional native modules — app works text-only if not linked
let Tts: { setDefaultLanguage(l: string): void; speak(t: string): void; stop(): void } | null = null
let Voice: { start(l: string): Promise<void>; stop(): Promise<void>; destroy(): Promise<void>; onSpeechResults: ((e: any) => void) | null; onSpeechError: ((e: any) => void) | null } | null = null
try { Tts = require('react-native-tts').default } catch {}
try { Voice = require('@react-native-voice/voice').default } catch {}

interface Message { role: 'user' | 'hermes'; text: string }

interface Props {
  sessionId: string
  greeting: string
  doctorName: string
  lang?: string
  textOnly?: boolean
  onEnd: () => void
}

function ttsLang(lang: string): string {
  const map: Record<string, string> = { hi: 'hi-IN', pa: 'pa-IN', bn: 'bn-IN', ta: 'ta-IN' }
  return map[lang] ?? 'en-IN'
}

export default function HermesChatScreen({
  sessionId, greeting, doctorName, lang = 'en', textOnly = false, onEnd,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([{ role: 'hermes', text: greeting }])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [listening, setListening] = useState(false)
  const [ended, setEnded] = useState(false)
  const mutedRef = useRef(false)
  const scrollRef = useRef<ScrollView>(null)

  const hasTTS = !textOnly && Tts !== null
  const hasSTT = !textOnly && Voice !== null

  const speak = useCallback((text: string) => {
    if (!hasTTS || mutedRef.current) return
    try {
      Tts!.setDefaultLanguage(ttsLang(lang))
      Tts!.speak(text)
    } catch {}
  }, [hasTTS, lang])

  useEffect(() => {
    if (greeting) speak(greeting)
    return () => {
      try { Tts?.stop() } catch {}
      try { Voice?.destroy() } catch {}
    }
  }, [])

  function toggleMute() {
    const now = !mutedRef.current
    mutedRef.current = now
    setMuted(now)
    if (now) try { Tts?.stop() } catch {}
  }

  async function startListening() {
    if (!hasSTT || listening || thinking) return
    // Request microphone permission on Android before starting Voice
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone access',
          message: 'PAL needs your microphone to hear your voice.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      )
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return
    }
    try {
      Voice!.onSpeechResults = (e: any) => {
        const text: string = e.value?.[0] ?? ''
        if (text) { setInput(text); setListening(false) }
      }
      Voice!.onSpeechError = () => setListening(false)
      await Voice!.start(ttsLang(lang))
      setListening(true)
    } catch {}
  }

  async function stopListening() {
    if (!hasSTT) return
    try { await Voice!.stop() } catch {}
    setListening(false)
  }

  async function sendMessage(override?: string) {
    const msg = (override ?? input).trim()
    if (!msg || thinking || ended) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: msg }])
    setThinking(true)

    try {
      const session: CallSession = await sendCallTurn(sessionId, msg)
      const reply = session.hermes_response ?? '…'
      setMessages(prev => [...prev, { role: 'hermes', text: reply }])
      speak(reply)
      if (session.call_ended) setEnded(true)
    } catch {
      setMessages(prev => [...prev, {
        role: 'hermes',
        text: 'Sorry — I couldn\'t reach the server. Please try again.',
      }])
    } finally {
      setThinking(false)
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80)
    }
  }

  function handleEnd() {
    try { endCall(sessionId) } catch {}
    try { Tts?.stop() } catch {}
    try { Voice?.destroy() } catch {}
    onEnd()
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.hBadge}>
          <Text style={styles.hBadgeText}>H</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Hermes</Text>
          <Text style={styles.subtitle}>{doctorName} · appointment prep</Text>
        </View>
        {hasTTS && (
          <Pressable style={styles.muteBtn} onPress={toggleMute}>
            <Text style={{ fontSize: 20 }}>{muted ? '🔇' : '🔊'}</Text>
          </Pressable>
        )}
        <Pressable style={styles.endBtn} onPress={handleEnd}>
          <Text style={styles.endText}>End</Text>
        </Pressable>
      </View>

      {/* Chat bubbles */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((m, i) => (
          <View key={i} style={m.role === 'user' ? styles.userRow : styles.hermesRow}>
            {m.role === 'hermes' && (
              <View style={styles.hermBadge}>
                <Text style={styles.hermBadgeText}>H</Text>
              </View>
            )}
            <View style={[
              styles.bubble,
              m.role === 'user' ? styles.userBubble : styles.hermesBubble,
            ]}>
              <Text style={[styles.bubbleText, m.role === 'user' && styles.userText]}>
                {m.text}
              </Text>
            </View>
          </View>
        ))}
        {thinking && (
          <View style={styles.hermesRow}>
            <View style={styles.hermBadge}>
              <Text style={styles.hermBadgeText}>H</Text>
            </View>
            <View style={[styles.bubble, styles.hermesBubble]}>
              <Text style={styles.thinking}>Thinking…</Text>
            </View>
          </View>
        )}
        {ended && (
          <View style={styles.endedNote}>
            <Text style={styles.endedText}>Call ended</Text>
          </View>
        )}
      </ScrollView>

      {/* Input bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputBar}>
          {hasSTT && (
            <Pressable
              style={[styles.micBtn, listening && styles.micActive]}
              onPress={listening ? stopListening : startListening}
            >
              <Text style={{ fontSize: 17 }}>{listening ? '●' : '🎤'}</Text>
            </Pressable>
          )}
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Type a message…"
            placeholderTextColor={PAL.creamMuted}
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
            editable={!thinking && !ended}
            multiline={false}
          />
          <Pressable
            style={[styles.sendBtn, (!input.trim() || thinking || ended) && styles.sendDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || thinking || ended}
          >
            <Text style={styles.sendArrow}>→</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAL.navyDeep },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    padding: SPACE.md, borderBottomWidth: 1, borderBottomColor: PAL.navyBorder,
  },
  hBadge: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: PAL.jadeFaint, borderWidth: 1, borderColor: PAL.jadeBorder,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  hBadgeText: { fontFamily: FONT.serif, fontSize: 16, color: PAL.jade, fontWeight: '700' },
  title: { fontFamily: FONT.mono, fontSize: 13, fontWeight: '700', color: PAL.cream },
  subtitle: { fontFamily: FONT.mono, fontSize: 9, color: PAL.creamMuted, marginTop: 1 },
  muteBtn: { padding: 8 },
  endBtn: {
    backgroundColor: PAL.roseFaint, borderWidth: 1, borderColor: PAL.roseBorder,
    borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 7,
  },
  endText: { color: PAL.rose, fontFamily: FONT.mono, fontSize: 11, fontWeight: '700' },
  messages: { flex: 1 },
  messagesContent: { padding: SPACE.md, gap: SPACE.sm, paddingBottom: SPACE.lg },
  hermesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  hermBadge: {
    width: 24, height: 24, borderRadius: 7,
    backgroundColor: PAL.jadeFaint, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 2,
  },
  hermBadgeText: { fontFamily: FONT.serif, fontSize: 11, color: PAL.jade, fontWeight: '700' },
  bubble: {
    maxWidth: '84%', borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  hermesBubble: {
    flex: 1, backgroundColor: PAL.navyMid,
    borderBottomLeftRadius: 4,
  },
  userBubble: { backgroundColor: PAL.jade, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 14, color: PAL.cream, lineHeight: 21 },
  userText: { color: PAL.navyDeep },
  thinking: { fontSize: 14, color: PAL.creamMuted, fontStyle: 'italic' },
  endedNote: { alignItems: 'center', paddingVertical: SPACE.md },
  endedText: { fontFamily: FONT.mono, fontSize: 10, color: PAL.creamMuted, textTransform: 'uppercase' },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    padding: SPACE.md, borderTopWidth: 1, borderTopColor: PAL.navyBorder,
    backgroundColor: PAL.navyMid,
  },
  micBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: PAL.jadeFaint, alignItems: 'center', justifyContent: 'center',
  },
  micActive: { backgroundColor: PAL.jade },
  input: {
    flex: 1, backgroundColor: PAL.creamFaint, borderRadius: RADIUS.pill,
    paddingHorizontal: 16, paddingVertical: 10,
    color: PAL.cream, fontSize: 14,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: PAL.jade, alignItems: 'center', justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.35 },
  sendArrow: { color: PAL.navyDeep, fontWeight: '700', fontSize: 18 },
})
