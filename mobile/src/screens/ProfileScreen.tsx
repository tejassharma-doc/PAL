/**
 * Profile — the website's "Your Profile": serif title, white cards with mono
 * section labels and label/value pairs.
 */
import React from 'react'
import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { C, F, T } from '../theme'
import { AppBar, Avatar, Body, Button, ErrorBox, KV, Loading, PageTitle, fmtDate, useFocusLoad } from '../components/ui'
import { SignOutIcon } from '../components/icons'
import { useAuth } from '../context/AuthContext'
import * as api from '../lib/api'

export default function ProfileScreen({ navigation }: any) {
  const { session, signOut } = useAuth()
  const { data, error, loading, refreshing, reload } = useFocusLoad(api.getProfile)
  const p = data?.patient
  const nice = (x?: string | null) => (x ? x.replace(/_/g, ' ') : x)

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <AppBar title="Profile" sub="your details" onBack={() => navigation.goBack()} />
      {loading ? (
        <Loading />
      ) : (
        <Body refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} colors={[C.jade]} />}>
          <PageTitle title="Your Profile" lead="Manage your health information" />
          {error ? <ErrorBox message={error} onRetry={reload} /> : null}

          <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
            <Avatar name={p?.full_name || session?.displayName} size={52} radius={16} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.sansSemi, fontSize: 17, color: C.ink }}>{p?.full_name || session?.displayName}</Text>
              <Text style={[T.meta, { marginTop: 3 }]}>
                {session?.authType === 'phone' ? `signed in with +91 ${session.phone}` : `signed in as ${session?.email ?? session?.username}`}
              </Text>
            </View>
          </View>

          {p && (
            <>
              <View style={s.card}>
                <Text style={s.slab}>Personal information</Text>
                <KV k="Full Name" v={p.full_name} />
                <KV k="Phone" v={p.phone} />
                <KV k="Email" v={p.email} />
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1 }}>
                    <KV k="Date of Birth" v={p.date_of_birth ? fmtDate(p.date_of_birth) : null} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <KV k="Gender" v={nice(p.gender)} />
                  </View>
                </View>
                <KV k="Blood Group" v={p.blood_group} />
                <KV k="ABHA" v={p.abha_address || p.abha_id} />
                <KV k="Address" v={p.address} />
              </View>

              <View style={s.card}>
                <Text style={s.slab}>Medical information</Text>
                <KV k="Allergies" v={p.allergies} />
                <KV k="Long-term conditions" v={p.chronic_conditions} />
                <KV k="Current medicines" v={p.current_medications} />
                {!p.allergies && !p.chronic_conditions && !p.current_medications ? (
                  <Text style={T.lead}>Nothing recorded yet.</Text>
                ) : null}
              </View>

              {p.emergency_contact ? (
                <View style={s.card}>
                  <Text style={s.slab}>Emergency contact</Text>
                  <KV k={p.emergency_contact.relationship || 'Contact'} v={`${p.emergency_contact.name} · ${p.emergency_contact.phone}`} />
                </View>
              ) : null}
            </>
          )}

          {data?.credits && (
            <View style={s.card}>
              <Text style={s.slab}>AI credits</Text>
              <Text style={{ fontFamily: F.serifLight, fontSize: 34, color: C.jadeD }}>{data.credits.balance}</Text>
              <Text style={T.meta}>
                credits left · {data.credits.total_used} used
                {data.credits.last_refill_date ? ` · refilled ${fmtDate(data.credits.last_refill_date)}` : ''}
              </Text>
            </View>
          )}

          <Button title="Medication reminders" kind="secondary" onPress={() => navigation.navigate('Medicines')} style={{ marginBottom: 10 }} />
          <Button title="Sign out" kind="amber" icon={<SignOutIcon size={16} />} onPress={signOut} />
        </Body>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 18, marginBottom: 14 },
  slab: { fontFamily: F.mono, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: C.muted, marginBottom: 14 },
})
