import React from 'react'
import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { C, F, T } from '../theme'
import { AppBar, Body, Empty, ErrorBox, Loading, fmtDateTime, useFocusLoad } from '../components/ui'
import * as api from '../lib/api'
import { CopyButton, Markdown } from '../components/Markdown'

export default function ConversationScreen({ route, navigation }: any) {
  const id: string = route.params.id
  const { data, error, loading, refreshing, reload } = useFocusLoad(() => api.getConversationTurns(id), [id])

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <AppBar title={route.params.title || 'Conversation'} sub="saved conversation" onBack={() => navigation.goBack()} />
      {loading ? (
        <Loading />
      ) : (
        <Body refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} colors={[C.jade]} />}>
          {error ? <ErrorBox message={error} onRetry={reload} /> : null}
          {data && data.length === 0 && <Empty title="This conversation is empty" />}
          <View style={{ gap: 10, paddingTop: 6 }}>
            {data?.map(t =>
              t.role === 'user' ? (
                <View key={t.id} style={{ alignItems: 'flex-end' }}>
                  <View style={s.user}>
                    <Text selectable style={s.userText}>
                      {t.content}
                    </Text>
                  </View>
                  <Text style={[T.meta, { marginTop: 4 }]}>{fmtDateTime(t.created_at)}</Text>
                </View>
              ) : (
                <View key={t.id} style={s.pal}>
                  <Markdown text={t.content} />
                  {t.citations?.length ? (
                    <Text style={s.cite}>{t.citations.map((c, i) => `${i + 1}. ${c.title || c.source}`).join('\n')}</Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                    <Text style={T.meta}>{fmtDateTime(t.created_at)}</Text>
                    <CopyButton text={t.content} />
                  </View>
                </View>
              ),
            )}
          </View>
        </Body>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  user: { backgroundColor: C.deep, borderRadius: 14, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '82%' },
  userText: { fontFamily: F.sans, fontSize: 16.5, lineHeight: 25, color: C.paper },
  pal: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, borderTopLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 12, width: '92%' },
  cite: { fontFamily: F.sans, fontSize: 13.5, color: C.amberD, marginTop: 8, lineHeight: 20 },
})
