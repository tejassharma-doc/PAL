import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useIsFocused } from '@react-navigation/native'
import { PAL, FONT, RADIUS, SPACE } from '../theme'
import { listConversations, ConversationSummary } from '../lib/api'

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export default function HistoryScreen() {
  const [convs, setConvs] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const isFocused = useIsFocused()

  const loadConversations = () => {
    setLoading(true)
    listConversations()
      .then(c => {
        console.log('✅ Loaded conversations from backend:', c.length, JSON.stringify(c, null, 2))
        setConvs(c)
      })
      .catch(err => {
        console.error('❌ Error loading conversations:', err)
        setConvs([])
      })
      .finally(() => setLoading(false))
  }

  const onRefresh = () => {
    setRefreshing(true)
    listConversations()
      .then(c => {
        console.log('🔄 Refreshed conversations:', c.length)
        setConvs(c)
      })
      .catch(err => {
        console.error('❌ Error refreshing:', err)
        setConvs([])
      })
      .finally(() => setRefreshing(false))
  }

  useEffect(() => {
    if (isFocused) {
      loadConversations()
    }
  }, [isFocused])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PAL.jade} />
        }
      >
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
              <Text style={styles.iconText}>💬</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {c.title ?? 'Conversation'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.cardDate}>{formatDate(c.updated_at)}</Text>
                <Text style={styles.cardTime}>{formatTime(c.updated_at)}</Text>
              </View>
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
  iconText: { fontFamily: FONT.mono, fontSize: 18, color: PAL.jade },
  cardTitle: { fontSize: 14, fontWeight: '600', color: PAL.textDark, marginBottom: 4 },
  cardDate: { fontFamily: FONT.mono, fontSize: 10, color: PAL.textMuted },
  cardTime: { fontFamily: FONT.mono, fontSize: 10, color: PAL.jade },
  arrow: { fontFamily: FONT.mono, fontSize: 14, color: PAL.jade },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyTitle: {
    fontFamily: FONT.serif, fontSize: 20, color: PAL.textDark,
    fontWeight: '300', marginBottom: 8,
  },
  emptyHint: { fontFamily: FONT.mono, fontSize: 11, color: PAL.textMuted },
})
