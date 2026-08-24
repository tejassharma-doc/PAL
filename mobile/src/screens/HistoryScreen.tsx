import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PAL, FONT, RADIUS, SPACE } from '../theme'
import { listConversations, ConversationSummary } from '../lib/api'

const MOCK: ConversationSummary[] = [
  {
    id: '1', title: 'Cholesterol and diet',
    created_at: '2026-06-20T09:00:00Z', updated_at: '2026-06-20T09:15:00Z',
  },
  {
    id: '2', title: 'Metformin side effects',
    created_at: '2026-06-15T14:00:00Z', updated_at: '2026-06-15T14:20:00Z',
  },
  {
    id: '3', title: 'Blood pressure monitoring',
    created_at: '2026-06-10T11:00:00Z', updated_at: '2026-06-10T11:10:00Z',
  },
]

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function HistoryScreen() {
  const [convs, setConvs] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listConversations()
      .then(c => setConvs(c.length ? c : MOCK))
      .catch(() => setConvs(MOCK))
      .finally(() => setLoading(false))
  }, [])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>History</Text>
        <Text style={styles.sub}>Your previous conversations</Text>

        {loading && <ActivityIndicator color={PAL.jade} style={{ marginTop: 40 }} />}

        {!loading && convs.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No conversations yet.</Text>
            <Text style={styles.emptyHint}>Start by asking PAL a question.</Text>
          </View>
        )}

        {convs.map((c, i) => (
          <Pressable key={c.id} style={styles.card}>
            <View style={styles.iconWrap}>
              <Text style={styles.iconText}>{(i + 1).toString()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{c.title ?? 'Conversation'}</Text>
              <Text style={styles.cardDate}>{formatDate(c.updated_at)}</Text>
            </View>
            <Text style={styles.arrow}>→</Text>
          </Pressable>
        ))}
      </ScrollView>
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
  sub: {
    fontFamily: FONT.mono, fontSize: 10, color: PAL.textMuted,
    marginBottom: SPACE.xl, textTransform: 'uppercase',
  },
  card: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.md,
    padding: SPACE.md, marginBottom: SPACE.sm,
    flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    borderWidth: 1, borderColor: PAL.surfaceBorder,
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: RADIUS.sm,
    backgroundColor: PAL.jadeFaint,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  iconText: { fontFamily: FONT.mono, fontSize: 13, color: PAL.jade, fontWeight: '700' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: PAL.textDark, marginBottom: 3 },
  cardDate: { fontFamily: FONT.mono, fontSize: 10, color: PAL.textMuted },
  arrow: { fontFamily: FONT.mono, fontSize: 14, color: PAL.jade },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyTitle: {
    fontFamily: FONT.serif, fontSize: 20, color: PAL.textDark,
    fontWeight: '300', marginBottom: 8,
  },
  emptyHint: { fontFamily: FONT.mono, fontSize: 11, color: PAL.textMuted },
})
