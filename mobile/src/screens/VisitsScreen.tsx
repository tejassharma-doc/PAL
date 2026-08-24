import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, ScrollView, Pressable, StyleSheet, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { PAL, FONT, RADIUS, SPACE } from '../theme'
import { initiateCall } from '../lib/api'
import HermesIncomingModal from '../components/HermesIncomingModal'
import HermesChatScreen from '../components/HermesChatScreen'

const VOICE_LANGS = new Set(['en', 'hi', 'pa', 'bn'])

type CallPhase = 'idle' | 'incoming' | 'connecting' | 'active'

export default function VisitsScreen() {
  const [callPhase, setCallPhase] = useState<CallPhase>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [greeting, setGreeting] = useState('')
  const [callError, setCallError] = useState<string | null>(null)
  const [lang, setLang] = useState('en')
  const dot1 = useRef(new Animated.Value(0)).current
  const dot2 = useRef(new Animated.Value(0)).current
  const dot3 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    AsyncStorage.getItem('pal_lang').then(l => { if (l) setLang(l) })
  }, [])

  const hasVoice = VOICE_LANGS.has(lang)

  useEffect(() => {
    if (callPhase !== 'idle') { dot1.setValue(0); dot2.setValue(0); dot3.setValue(0); return }
    function bouncer(val: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 180, useNativeDriver: true }),
          Animated.delay(840),
        ]),
      )
    }
    const a1 = bouncer(dot1, 0)
    const a2 = bouncer(dot2, 220)
    const a3 = bouncer(dot3, 440)
    a1.start(); a2.start(); a3.start()
    return () => { a1.stop(); a2.stop(); a3.stop() }
  }, [callPhase])

  async function startSession() {
    setCallPhase('connecting')
    setCallError(null)
    try {
      const session = await initiateCall({
        doctorId: 'rao-001',
        doctorName: 'Dr. Rao',
        patientName: 'Anil',
        appointmentReason: 'Lipid review',
      })
      setSessionId(session.session_id)
      setGreeting(
        session.hermes_response ??
        (hasVoice
          ? 'Hello Anil, this is Hermes calling about your upcoming appointment with Dr. Rao.'
          : "Hi Anil! I'm Hermes. I'm reaching out about your lipid review with Dr. Rao on 26 Jun at 11:30. Any questions, or would you like to reschedule?"),
      )
      setCallPhase('active')
    } catch {
      if (__DEV__) {
        setSessionId('dev-mock-session')
        setGreeting(
          "Hi Anil! I'm Hermes. I'm reaching out about your lipid review with Dr. Rao on 26 Jun at 11:30 AM. Any questions, or would you like to reschedule?",
        )
        setCallPhase('active')
      } else {
        setCallError('Could not connect — is the backend running?')
        setCallPhase('idle')
      }
    }
  }

  const handleAccept = () => startSession()
  const handleDecline = () => { setCallPhase('idle'); setCallError(null) }
  const handleEndCall = () => {
    setCallPhase('idle'); setSessionId(null); setGreeting(''); setCallError(null)
  }

  const dotStyle = (val: Animated.Value): object => ({
    transform: [{ translateY: val.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
  })

  // Full-screen chat when active
  if (callPhase === 'active' && sessionId) {
    return (
      <HermesChatScreen
        sessionId={sessionId}
        greeting={greeting}
        doctorName="Dr. Rao"
        lang={lang}
        textOnly={!hasVoice}
        onEnd={handleEndCall}
      />
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Your visits</Text>
        <Text style={styles.sub}>Every plan here comes from your care team.</Text>

        {/* Appointment card */}
        <View style={styles.apptCard}>
          <Text style={styles.upcoming}>◷ upcoming</Text>
          <Text style={styles.apptTitle}>Lipid review · Dr. Rao</Text>
          <Text style={styles.apptTime}>Thu 26 Jun, 11:30 · City Clinic OPD</Text>

          {/* Hermes indicator */}
          {callPhase === 'idle' && (
            <View style={styles.hermRow}>
              <View style={styles.hermBadge}>
                <Text style={styles.hermBadgeText}>H</Text>
              </View>
              <View style={styles.hermLabelWrap}>
                {hasVoice ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.hermText}>Hermes is calling</Text>
                    {[dot1, dot2, dot3].map((d, i) => (
                      <Animated.Text key={i} style={[styles.hermDot, dotStyle(d)]}>.</Animated.Text>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.hermText}>Hermes wants to chat</Text>
                )}
              </View>
              <View style={[
                styles.hermPulse,
                { backgroundColor: hasVoice ? PAL.jade : '#5a8fa8' },
              ]} />
            </View>
          )}

          {callError && <Text style={styles.errorText}>{callError}</Text>}

          <View style={styles.btnRow}>
            <Pressable
              style={[styles.prepBtn, callPhase === 'connecting' && styles.prepDisabled]}
              onPress={hasVoice ? () => setCallPhase('incoming') : startSession}
              disabled={callPhase === 'connecting'}
            >
              <Text style={styles.prepText}>
                {callPhase === 'connecting' ? 'Connecting…' : 'Prepare with PAL'}
              </Text>
            </Pressable>
            <Pressable style={styles.reschedBtn} onPress={startSession}>
              <Text style={styles.reschedText}>Reschedule</Text>
            </Pressable>
          </View>
        </View>

        {/* Care plans */}
        <Text style={styles.sectionLabel}>Care plans</Text>

        <View style={styles.careCard}>
          <View style={styles.careRow}>
            <View style={[styles.careAvatar, { backgroundColor: '#33607a' }]}>
              <Text style={styles.careAvatarText}>R</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.careName}>Dr. Rao</Text>
              <Text style={styles.careRole}>Physician · OPD</Text>
            </View>
            <Text style={styles.careDate}>12 May 2026</Text>
          </View>
          <View style={styles.carePlanRow}>
            <Text style={styles.carePlanText}>⛁ Cardiometabolic care plan</Text>
            <Text style={styles.carePlanArrow}>open →</Text>
          </View>
        </View>

        <View style={styles.careCard}>
          <View style={styles.careRow}>
            <View style={[styles.careAvatar, { backgroundColor: PAL.jadeDeep }]}>
              <Text style={styles.careAvatarText}>S</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.careName}>Sneha</Text>
              <Text style={styles.careRole}>Nutritionist · iNutriMon</Text>
            </View>
            <Text style={styles.careDate}>8 May 2026</Text>
          </View>
          <View style={styles.carePlanRow}>
            <Text style={styles.carePlanText}>☘ Cholesterol nutrition plan</Text>
            <Text style={styles.carePlanArrow}>open →</Text>
          </View>
        </View>

        <View style={styles.evidenceRow}>
          <View style={styles.evidenceBadge}>
            <Text style={styles.evidenceBadgeText}>⛁ clinician-canonical</Text>
          </View>
          <Text style={styles.evidenceText}>
            Plans are your team's own words — never altered by AI.
          </Text>
        </View>
      </ScrollView>

      <HermesIncomingModal
        visible={callPhase === 'incoming' || callPhase === 'connecting'}
        doctorName="Dr. Rao"
        appointmentLabel="Lipid review · 26 Jun"
        isConnecting={callPhase === 'connecting'}
        onAccept={handleAccept}
        onDecline={handleDecline}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAL.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.lg, paddingBottom: 100 },
  heading: {
    fontFamily: FONT.serif, fontSize: 26, fontWeight: '300',
    color: PAL.textDark, marginBottom: 4,
  },
  sub: { fontSize: 12, color: PAL.textMuted, marginBottom: SPACE.xl },
  apptCard: {
    backgroundColor: PAL.navyMid, borderRadius: RADIUS.md,
    padding: 15, marginBottom: SPACE.md,
  },
  upcoming: {
    fontFamily: FONT.mono, fontSize: 9, textTransform: 'uppercase',
    color: PAL.jade, marginBottom: 9,
  },
  apptTitle: { fontFamily: FONT.serif, fontSize: 18, color: PAL.cream, marginBottom: 3 },
  apptTime: { fontSize: 12, color: PAL.creamMuted, marginBottom: SPACE.md },
  hermRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    borderTopWidth: 1, borderTopColor: PAL.navyBorder,
    paddingTop: 10, marginBottom: 10,
  },
  hermBadge: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: PAL.jadeFaint,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  hermBadgeText: { fontFamily: FONT.serif, fontSize: 11, color: PAL.jade, fontWeight: '700' },
  hermLabelWrap: { flex: 1 },
  hermText: { fontFamily: FONT.mono, fontSize: 14, color: PAL.cream, fontWeight: '700' },
  hermDot: { fontFamily: FONT.mono, fontSize: 20, color: PAL.jade, lineHeight: 20 },
  hermPulse: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  errorText: {
    fontFamily: FONT.mono, fontSize: 10, color: PAL.rose,
    textAlign: 'center', marginBottom: 8,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  prepBtn: {
    flex: 1, backgroundColor: PAL.jade,
    borderRadius: RADIUS.sm, padding: 11, alignItems: 'center',
  },
  prepDisabled: { opacity: 0.6 },
  prepText: { color: PAL.navyDeep, fontWeight: '700', fontSize: 12 },
  reschedBtn: {
    flex: 1, backgroundColor: PAL.creamFaint,
    borderRadius: RADIUS.sm, padding: 11, alignItems: 'center',
  },
  reschedText: { color: PAL.cream, fontWeight: '600', fontSize: 12 },
  sectionLabel: {
    fontFamily: FONT.mono, fontSize: 9, textTransform: 'uppercase',
    color: PAL.textMuted, marginBottom: SPACE.md, marginLeft: 2,
  },
  careCard: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.md, padding: SPACE.md,
    marginBottom: 10, borderWidth: 1, borderColor: PAL.surfaceBorder,
  },
  careRow: { flexDirection: 'row', gap: 11, marginBottom: 10, alignItems: 'center' },
  careAvatar: {
    width: 38, height: 38, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  careAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  careName: { fontWeight: '600', fontSize: 14, color: PAL.textDark },
  careRole: { fontFamily: FONT.mono, fontSize: 10, color: PAL.textMuted, marginTop: 1 },
  careDate: { fontFamily: FONT.mono, fontSize: 11, color: PAL.textMuted },
  carePlanRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: PAL.surfaceBorder, paddingTop: 10,
  },
  carePlanText: { fontSize: 12, color: PAL.jadeDeep },
  carePlanArrow: { fontFamily: FONT.mono, fontSize: 11, color: PAL.jade },
  evidenceRow: {
    flexDirection: 'row', gap: 11, backgroundColor: PAL.surface, borderRadius: RADIUS.md,
    padding: SPACE.md, marginTop: 4, alignItems: 'center',
    borderWidth: 1, borderColor: PAL.surfaceBorder,
  },
  evidenceBadge: {
    backgroundColor: 'rgba(90,143,168,.14)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0,
  },
  evidenceBadgeText: { fontFamily: FONT.mono, fontSize: 9, color: '#33607a' },
  evidenceText: { flex: 1, fontSize: 11, color: PAL.textMuted, lineHeight: 16 },
})
