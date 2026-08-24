/**
 * AskScreen — conversational health search with MDT document upload.
 *
 * MDT Upload flow (paperclip button):
 *   1. User taps paperclip → showPicker() presents action sheet
 *   2. react-native-document-picker → PDF selection
 *      react-native-image-picker → camera or gallery (JPEG/PNG)
 *   3. uploadMedicalDocument() sends multipart to POST /medical/upload
 *   4. If pending_verification → VerificationSheet modal renders
 *   5. User taps Save → confirmMedicalDocument() → HealthFact rows persisted
 *
 * PHI gate: the mobile client sends a scope flag; the backend enforces consent
 * before accessing member records. Raw PHI is never transmitted from the client.
 *
 * Safety gate: FuguRouter keyword-deterministic check fires FIRST before any
 * API call. Emergency / crisis short-circuits to SafetyBanner immediately.
 *
 * Confirm-token gate: booking/messaging actions are proposed in chat;
 * the backend write gate requires a separate confirm-token before dispatching.
 */
import React, {useState, useRef, useCallback} from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
  Alert,
} from 'react-native'
import {SafeAreaView} from 'react-native-safe-area-context'
import DocumentPicker, {types as DocTypes} from 'react-native-document-picker'
import {launchImageLibrary, launchCamera} from 'react-native-image-picker'

import {PAL, FONT, RADIUS, SPACE} from '../theme'
import {search, uploadMedicalDocument, confirmMedicalDocument} from '../lib/api'
import type {MedicalDocVerifyResult} from '../lib/api'
import {SearchBar} from '../components/SearchBar'
import {SafetyBanner} from '../components/SafetyBanner'
import {VerificationSheet} from '../components/VerificationSheet'

// Optional on-device Fugu router — graceful degradation if ONNX not loaded
let FuguRouterClass: any = null
try { FuguRouterClass = require('../services/fuguRouter').FuguRouter } catch {}
type SafetyCategory = 'emergency' | 'crisis'

interface Message {
  id: string
  role: 'user' | 'pal'
  text: string
}

const SESSION_ID = 'android-' + Date.now().toString(36)

export default function AskScreen({navigation}: any) {
  const [messages, setMessages]         = useState<Message[]>([])
  const [isLoading, setIsLoading]       = useState(false)
  const [safetyCategory, setSafety]     = useState<SafetyCategory | null>(null)
  const [conversationId, setConvId]     = useState<string | undefined>()
  const [verifyData, setVerifyData]     = useState<MedicalDocVerifyResult | null>(null)
  const [uploading, setUploading]       = useState(false)
  const scrollRef                        = useRef<ScrollView>(null)
  const fuguRouter                       = useRef(FuguRouterClass ? new FuguRouterClass() : null)

  // ── Chat submit ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (query: string) => {
    if (!query.trim() || isLoading) return
    Keyboard.dismiss()
    const msgId = Date.now().toString()
    setMessages(prev => [...prev, {id: msgId, role: 'user', text: query}])
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
            setSafety(decision.classification?.safety_category ?? 'emergency')
            setIsLoading(false)
            return
          }
          if (decision.depth === 'on_device' && decision.on_device_answer) {
            setMessages(prev => [...prev, {id: msgId + '-r', role: 'pal', text: decision.on_device_answer}])
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

      if (result.conversation_id) setConvId(result.conversation_id)
      setMessages(prev => [...prev, {id: msgId + '-r', role: 'pal', text: result.answer_text}])
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {id: msgId + '-e', role: 'pal', text: err?.message ?? 'Could not reach PAL.'},
      ])
    } finally {
      setIsLoading(false)
      setTimeout(() => scrollRef.current?.scrollToEnd({animated: true}), 80)
    }
  }, [isLoading, conversationId])

  // ── MDT document picker ─────────────────────────────────────────────────────

  async function pickPdf() {
    try {
      const result = await DocumentPicker.pickSingle({
        type: [DocTypes.pdf],
        copyTo: 'cachesDirectory',
      })
      await doUpload({
        uri: result.fileCopyUri ?? result.uri,
        name: result.name ?? 'document.pdf',
        type: result.type ?? 'application/pdf',
      })
    } catch (e) {
      if (!DocumentPicker.isCancel(e)) {
        Alert.alert('Pick failed', 'Could not open the document. Please try again.')
      }
    }
  }

  async function pickImage(source: 'camera' | 'gallery') {
    const launch = source === 'camera' ? launchCamera : launchImageLibrary
    launch(
      {mediaType: 'photo', quality: 0.9, includeBase64: false},
      async response => {
        if (response.didCancel || response.errorCode) return
        const asset = response.assets?.[0]
        if (!asset?.uri) return
        await doUpload({
          uri: asset.uri,
          name: asset.fileName ?? `photo_${Date.now()}.jpg`,
          type: asset.type ?? 'image/jpeg',
        })
      },
    )
  }

  async function doUpload(file: {uri: string; name: string; type: string}) {
    setUploading(true)
    try {
      const result = await uploadMedicalDocument(file)
      if (result.type === 'pending_verification') {
        setVerifyData(result)
      } else if (result.type === 'document_accepted') {
        Alert.alert('Document saved', result.message)
      } else {
        Alert.alert('Unsupported format', result.message)
      }
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message ?? 'Please try again.')
    } finally {
      setUploading(false)
    }
  }

  function showPicker() {
    // On Android, Alert is the most reliable cross-version action sheet
    Alert.alert(
      'Upload medical document',
      'Choose how to add your document',
      [
        {text: 'Choose PDF', onPress: pickPdf},
        {text: 'Take photo', onPress: () => pickImage('camera')},
        {text: 'Choose from gallery', onPress: () => pickImage('gallery')},
        {text: 'Cancel', style: 'cancel'},
      ],
    )
  }

  // ── MDT confirm ──────────────────────────────────────────────────────────────

  async function handleDocSave() {
    if (!verifyData || verifyData.type !== 'pending_verification') return
    await confirmMedicalDocument({
      rawSourceId: verifyData.raw_source_id,
      observations: verifyData.observations,
      reportDate: verifyData.report_date,
    })
    setVerifyData(null)
    Alert.alert('Saved', 'Lab values saved to your health record.')
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>PAL</Text>
        <Pressable style={styles.gearBtn} onPress={() => navigation?.navigate('Settings')}>
          <Text style={styles.gearIcon}>⚙</Text>
        </Pressable>
      </View>

      {/* Safety banner — keyword-deterministic, shows before API results */}
      {safetyCategory && (
        <SafetyBanner
          visible
          category={safetyCategory}
          onDismiss={() => setSafety(null)}
        />
      )}

      {/* Upload progress indicator */}
      {uploading && (
        <View style={styles.uploadingBanner}>
          <Text style={styles.uploadingText}>Extracting health data…</Text>
        </View>
      )}

      {/* Conversation messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          messages.length === 0 && styles.contentCentered,
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          messages.length > 0 && scrollRef.current?.scrollToEnd({animated: false})
        }
      >
        {messages.length === 0 && !uploading && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Ask PAL</Text>
            <Text style={styles.emptySub}>
              Ask anything about your health,{'\n'}medications, or appointments.
            </Text>
            <Text style={styles.attachHint}>
              📎 Tap the paperclip to upload a lab report or prescription.
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

      {/* Search bar with paperclip */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.barWrap}>
          <SearchBar
            onSubmit={handleSubmit}
            onAttach={showPicker}
            isLoading={isLoading || uploading}
          />
        </View>
      </KeyboardAvoidingView>

      {/* MDT Verification Sheet — modal bottom sheet */}
      {verifyData?.type === 'pending_verification' && (
        <VerificationSheet
          data={verifyData}
          onSave={handleDocSave}
          onCancel={() => setVerifyData(null)}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: PAL.bg},
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md,
    borderBottomWidth: 1, borderBottomColor: PAL.surfaceBorder,
    backgroundColor: PAL.surface,
  },
  headerTitle: {fontFamily: FONT.serif, fontSize: 20, fontWeight: '300', color: PAL.textDark},
  gearBtn: {padding: 6},
  gearIcon: {fontSize: 18, color: PAL.textMuted},

  uploadingBanner: {
    backgroundColor: PAL.jadeFaint, borderBottomWidth: 1, borderBottomColor: PAL.jadeBorder,
    paddingHorizontal: SPACE.lg, paddingVertical: 8, flexDirection: 'row', alignItems: 'center',
  },
  uploadingText: {fontFamily: FONT.mono, fontSize: 11, color: PAL.jadeDeep},

  scroll: {flex: 1},
  content: {padding: SPACE.lg, paddingBottom: SPACE.md, gap: SPACE.sm},
  contentCentered: {flex: 1, justifyContent: 'center'},

  empty: {alignItems: 'center', paddingHorizontal: SPACE.xl},
  emptyTitle: {
    fontFamily: FONT.serif, fontSize: 32, fontWeight: '300',
    color: PAL.textDark, marginBottom: SPACE.sm,
  },
  emptySub: {
    fontFamily: FONT.mono, fontSize: 12, color: PAL.textMuted,
    textAlign: 'center', lineHeight: 20, marginBottom: SPACE.sm,
  },
  attachHint: {
    fontFamily: FONT.mono, fontSize: 11, color: PAL.jade,
    textAlign: 'center', lineHeight: 18, marginBottom: SPACE.xl,
  },
  chips: {gap: SPACE.sm, alignItems: 'center'},
  chip: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md, paddingVertical: 9,
    borderWidth: 1, borderColor: PAL.surfaceBorder,
  },
  chipText: {fontFamily: FONT.mono, fontSize: 11, color: PAL.jade},

  userRow: {flexDirection: 'row', justifyContent: 'flex-end'},
  palRow:  {flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm},
  palBadge: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: PAL.jadeFaint, borderWidth: 1, borderColor: PAL.jadeBorder,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
  },
  palBadgeText: {fontFamily: FONT.serif, fontSize: 12, color: PAL.jade, fontWeight: '700'},
  bubble: {maxWidth: '84%', borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 10},
  palBubble: {
    backgroundColor: PAL.surface, borderWidth: 1, borderColor: PAL.surfaceBorder,
    borderBottomLeftRadius: 4, flex: 1,
  },
  userBubble: {backgroundColor: PAL.jade, borderBottomRightRadius: 4},
  bubbleText: {fontSize: 14, color: PAL.textDark, lineHeight: 21},
  userBubbleText: {color: PAL.navyDeep},
  thinking: {fontSize: 14, color: PAL.textMuted, fontStyle: 'italic'},

  barWrap: {
    backgroundColor: PAL.surface,
    borderTopWidth: 1, borderTopColor: PAL.surfaceBorder,
    paddingTop: SPACE.sm,
  },
})
