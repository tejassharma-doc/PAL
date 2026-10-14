import React from 'react'
import { Pressable, RefreshControl, Text, View } from 'react-native'
import { C, F, T } from '../theme'
import { AppBar, Body, Button, Empty, ErrorBox, Loading, PageTitle, fmtDateTime, useFocusLoad } from '../components/ui'
import { LineIcon } from '../components/icons'
import * as api from '../lib/api'
import { ApiError } from '../lib/http'

async function load() {
  try {
    return { enabled: true, items: await api.listNotifications(50) }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { enabled: false, items: [] as api.AppNotification[] }
    throw e
  }
}

function targetFor(n: api.AppNotification): { name: string; params?: object } | null {
  if (n.notification_type.startsWith('family') || n.link?.startsWith('/family')) return { name: 'Family', params: undefined }
  if (n.link?.startsWith('/medications')) return { name: 'Medicines' }
  if (n.link?.startsWith('/visits')) return { name: 'Main', params: { screen: 'Visits' } }
  if (n.link?.startsWith('/records')) return { name: 'Main', params: { screen: 'Record' } }
  return null
}

export default function NotificationsScreen({ navigation }: any) {
  const { data, error, loading, refreshing, reload, setData } = useFocusLoad(load)

  const open = (n: api.AppNotification) => {
    if (!n.is_read) {
      setData(d => (d ? { ...d, items: d.items.map(x => (x.id === n.id ? { ...x, is_read: true } : x)) } : d))
      api.markNotificationRead(n.id).catch(() => {})
    }
    const t = targetFor(n)
    if (t) navigation.navigate(t.name, t.params)
  }

  const markAll = () => {
    setData(d => (d ? { ...d, items: d.items.map(x => ({ ...x, is_read: true })) } : d))
    api.markAllNotificationsRead().catch(() => reload())
  }

  const unread = data?.items.filter(n => !n.is_read).length ?? 0

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <AppBar title="Notifications" sub={unread ? `${unread} to review` : 'all caught up'} onBack={() => navigation.goBack()} />
      {loading ? (
        <Loading />
      ) : (
        <Body refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} colors={[C.jade]} />}>
          <PageTitle title="Notifications" lead="Family requests and updates about your care." />
          {error ? <ErrorBox message={error} onRetry={reload} /> : null}
          {data && !data.enabled && <Empty icon="bell" title="Notifications are off" body="This PAL server does not have notifications enabled." />}
          {data?.enabled && data.items.length === 0 && <Empty icon="bell" title="You're all caught up" body="Family requests and updates will appear here." />}
          {unread > 0 && <Button title={`Mark all ${unread} as read`} kind="outline" small onPress={markAll} style={{ alignSelf: 'flex-end', marginBottom: 10 }} />}
          {data?.items.map(n => (
            <Pressable
              key={n.id}
              onPress={() => open(n)}
              style={{
                backgroundColor: '#fff',
                borderWidth: 1,
                borderColor: n.is_read ? C.line : 'rgba(55,181,155,0.5)',
                borderRadius: 13,
                padding: 12,
                marginBottom: 9,
                flexDirection: 'row',
                gap: 11,
              }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: n.is_read ? 'rgba(13,31,36,0.05)' : C.jadeTint, alignItems: 'center', justifyContent: 'center' }}>
                <LineIcon name={n.notification_type.startsWith('family') ? 'users' : 'bell'} size={18} color={C.jadeD} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: n.is_read ? F.sans : F.sansSemi, fontSize: 15, color: C.ink }}>{n.title}</Text>
                {n.body ? <Text style={[T.lead, { fontSize: 13.5, marginTop: 2 }]}>{n.body}</Text> : null}
                <Text style={[T.meta, { marginTop: 5 }]}>{fmtDateTime(n.created_at)}</Text>
              </View>
            </Pressable>
          ))}
        </Body>
      )}
    </View>
  )
}
