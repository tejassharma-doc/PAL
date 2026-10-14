import React from 'react'
import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { C, F, T } from '../theme'
import { AppBar, Badge, Body, ErrorBox, KV, Loading, PageTitle, useFocusLoad } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import * as api from '../lib/api'
import { API_BASE } from '../config'

const FEATURES: [string, string][] = [
  ['universal_search', 'Universal search (Ask)'],
  ['chat', 'Notifications & family chat'],
  ['family_plan', 'Family groups'],
  ['medication_reminder', 'Medicine reminders'],
]

export default function SettingsScreen({ navigation }: any) {
  const { session } = useAuth()
  const { data, error, loading, refreshing, reload } = useFocusLoad(api.getHealth)
  const exp = session?.expiresAt ? new Date(session.expiresAt) : null

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <AppBar title="Server & app" sub="connection details" onBack={() => navigation.goBack()} />
      {loading ? (
        <Loading label="checking server…" />
      ) : (
        <Body refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} colors={[C.jade]} />}>
          <PageTitle title="Server & app" lead="What this app is connected to." />
          {error ? <ErrorBox message={error} onRetry={reload} /> : null}
          <View style={s.card}>
            <Text style={s.slab}>Server</Text>
            <KV k="Address" v={API_BASE} />
            <KV k="Status" v={data?.status ?? (error ? 'unreachable' : '')} />
          </View>
          {data?.flags && (
            <View style={s.card}>
              <Text style={s.slab}>Features on this server</Text>
              {FEATURES.map(([k, label]) => (
                <View key={k} style={s.row}>
                  <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 16, color: C.ink }}>{label}</Text>
                  <Badge text={data.flags?.[k] ? 'on' : 'off'} tone={data.flags?.[k] ? 'jade' : 'grey'} dot />
                </View>
              ))}
            </View>
          )}
          <View style={s.card}>
            <Text style={s.slab}>Session</Text>
            <KV k="Sign-in" v={session?.authType === 'phone' ? 'Mobile OTP' : 'Email & password'} />
            <KV k="Session expires" v={exp ? exp.toLocaleString('en-IN') : 'unknown'} />
          </View>
          <Text style={[T.meta, { textAlign: 'center' }]}>PAL v1.0.0 · Not a medical device · For informational use only</Text>
        </Body>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 18, marginBottom: 14 },
  slab: { fontFamily: F.mono, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: C.muted, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(13,31,36,0.05)' },
})
