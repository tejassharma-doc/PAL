/**
 * History — the website's "Your conversations": serif title, search box,
 * mono day groups (TODAY / YESTERDAY / EARLIER), white cards with a serif
 * question, a jade bar + "used your record" pill for personal threads.
 */
import React, { useMemo, useState } from 'react'
import { Alert, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { C, F, T } from '../theme'
import { Badge, Body, Empty, ErrorBox, Loading, PageTitle, Slab, useFocusLoad } from '../components/ui'
import { TabChrome } from '../components/Chrome'
import { LineIcon } from '../components/icons'
import * as api from '../lib/api'

function groupOf(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(now) - start(d)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Earlier this week'
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function when(iso: string): string {
  const d = new Date(iso)
  const g = groupOf(iso)
  const t = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  if (g === 'Today') return t
  if (g === 'Yesterday' || g === 'Earlier this week') return `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${t}`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function HistoryScreen({ navigation }: any) {
  const { data, error, loading, refreshing, reload, setData } = useFocusLoad(api.listConversations)
  const [q, setQ] = useState('')

  const groups = useMemo(() => {
    const list = (data ?? []).filter(c =>
      !q.trim() ? true : `${c.title ?? ''} ${c.hindsight_summary ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
    const out: { label: string; items: api.ConversationSummary[] }[] = []
    for (const c of list) {
      const g = groupOf(c.updated_at || c.created_at)
      const last = out[out.length - 1]
      if (last && last.label === g) last.items.push(c)
      else out.push({ label: g, items: [c] })
    }
    return out
  }, [data, q])

  const remove = (c: api.ConversationSummary) =>
    Alert.alert(
      'Delete this conversation?',
      'This permanently removes the thread and everything PAL derived from it. It can’t be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteConversation(c.id)
              setData(d => d?.filter(x => x.id !== c.id))
            } catch (e: any) {
              Alert.alert('Could not delete', e?.message ?? '')
            }
          },
        },
      ],
    )

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <TabChrome title="History" sub="your conversations" />
      {loading ? (
        <Loading />
      ) : (
        <Body refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} colors={[C.jade]} />}>
          <PageTitle title="Your conversations" lead="Saved so you can continue. Yours to delete." />
          <View style={s.search}>
            <LineIcon name="search" size={20} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search your history…"
              placeholderTextColor="rgba(13,31,36,0.4)"
              style={s.searchInput}
              accessibilityLabel="Search your history"
            />
          </View>

          {error ? <ErrorBox message={error} onRetry={reload} /> : null}
          {data && data.length === 0 && !error && (
            <Empty icon="history" title="No conversations yet" body="Your chats with PAL will appear here." />
          )}
          {data && data.length > 0 && groups.length === 0 && <Empty title="Nothing matches" body="Try a different word." />}

          {groups.map(g => (
            <View key={g.label}>
              <Slab>{g.label}</Slab>
              {g.items.map(c => {
                const personal = c.scope_tag ? c.scope_tag !== 'generic' && c.scope_tag !== 'general' : false
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => navigation.navigate('Conversation', { id: c.id, title: c.title })}
                    onLongPress={() => remove(c)}
                    style={({ pressed }) => [s.card, personal && s.cardPersonal, pressed && { opacity: 0.85 }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <Text style={s.title} numberOfLines={3}>
                        {c.title || 'Conversation'}
                      </Text>
                      <Pressable onPress={() => remove(c)} hitSlop={10} accessibilityLabel="Conversation options">
                        <Text style={{ color: C.muted, fontSize: 17, letterSpacing: 1 }}>···</Text>
                      </Pressable>
                    </View>
                    {c.hindsight_summary ? (
                      <Text style={[T.meta, { marginTop: 6, lineHeight: 14 }]} numberOfLines={2}>
                        {c.hindsight_summary}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                      {personal ? <Badge text="used your record" dot /> : <Badge text="general" tone="grey" dot />}
                      <Text style={T.meta}>{when(c.updated_at || c.created_at)}</Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          ))}
        </Body>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  searchInput: { flex: 1, fontFamily: F.sans, fontSize: 16.5, color: C.ink, paddingVertical: 11 },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: 'rgba(13,31,36,0.08)',
  },
  cardPersonal: { borderLeftColor: C.jade },
  title: { flex: 1, fontFamily: F.serif, fontSize: 17, lineHeight: 23, color: C.ink },
})
