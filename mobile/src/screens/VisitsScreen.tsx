/**
 * Visits — the website's "Your visits": dark gradient UPCOMING card with
 * "Prepare with PAL", past visits as white cards, and the
 * "clinician-canonical" note.
 */
import React, { useState } from 'react'
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { C, DEEP_GRAD, F, T } from '../theme'
import { Badge, Body, Empty, ErrorBox, Loading, PageTitle, Slab, useFocusLoad } from '../components/ui'
import { Gradient } from '../components/icons'
import { TabChrome } from '../components/Chrome'
import { medDetail, medName } from './RecordsScreen'
import * as api from '../lib/api'

export default function VisitsScreen({ navigation }: any) {
  const { data, error, loading, refreshing, reload } = useFocusLoad(api.getVisits)
  const next = data?.upcoming[data.upcoming.length - 1] // list is newest-first; the soonest is last
  const laterUpcoming = data?.upcoming.filter(v => v !== next) ?? []

  const prepare = (v?: api.Visit) =>
    navigation.navigate('Ask', {
      prefill: v ? `Help me prepare for my visit${v.doctor_name ? ` with Dr ${v.doctor_name}` : ''} about ${v.reason}` : undefined,
    })

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <TabChrome title="Visits" sub="appointments" />
      {loading ? (
        <Loading />
      ) : (
        <Body refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} colors={[C.jade]} />}>
          <PageTitle title="Your visits" lead="Every plan here comes from your care team." />
          {error ? <ErrorBox message={error} onRetry={reload} /> : null}

          {/* Upcoming hero */}
          <View style={s.hero}>
            <Gradient colors={DEEP_GRAD} angle={160} radius={16} />
            <Text style={s.heroSlab}>UPCOMING</Text>
            {next ? (
              <>
                <Text style={s.heroTitle}>{next.reason}</Text>
                <Text style={s.heroMeta}>
                  {[next.date, next.time].filter(Boolean).join(' · ')}
                  {next.doctor_name ? `  ·  Dr ${next.doctor_name.replace(/^dr\.?\s*/i, '')}` : ''}
                  {next.clinic_name ? `  ·  ${next.clinic_name}` : ''}
                </Text>
              </>
            ) : (
              <Text style={s.heroTitle}>No upcoming visits</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable style={[s.heroBtn, { backgroundColor: C.jade }]} onPress={() => prepare(next)}>
                <Text style={[s.heroBtnText, { color: C.deep2 }]}>Prepare with PAL</Text>
              </Pressable>
              {next?.previsit_status ? (
                <View style={[s.heroBtn, { backgroundColor: 'rgba(55,181,155,0.15)' }]}>
                  <Text style={[s.heroBtnText, { color: C.jade }]}>Pre-visit · {next.previsit_status}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {laterUpcoming.length > 0 && (
            <>
              <Slab>Also coming up</Slab>
              {laterUpcoming.map(v => (
                <VisitCard key={v.id} v={v} />
              ))}
            </>
          )}

          {data && data.past.length > 0 ? (
            <>
              <Slab>Past visits</Slab>
              {data.past.map(v => (
                <VisitCard key={v.id} v={v} />
              ))}
            </>
          ) : data && data.upcoming.length === 0 ? (
            <Empty icon="calendar-days" title="No visits yet" body="Your booked appointments will appear here." />
          ) : null}

          <View style={s.canon}>
            <Badge text="⛁ clinician-canonical" tone="blue" />
            <Text style={[T.lead, { flex: 1, fontSize: 15 }]}>Plans are your team's own words — never altered by AI.</Text>
          </View>
        </Body>
      )}
    </View>
  )
}

function VisitCard({ v }: { v: api.Visit }) {
  const [open, setOpen] = useState(false)
  const notes = !!(v.patient_summary || v.management_plan)
  return (
    <Pressable onPress={() => setOpen(o => !o)} style={({ pressed }) => [s.card, pressed && { opacity: 0.9 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
        <Text style={s.title} numberOfLines={2}>
          {v.reason}
        </Text>
        <Badge text={v.status} tone={v.status === 'cancelled' ? 'grey' : 'jade'} />
      </View>
      <Text style={[s.date, { marginTop: 4 }]}>
        {[v.date, v.time].filter(Boolean).join(' · ')}
        {v.doctor_name ? `  ·  Dr ${v.doctor_name.replace(/^dr\.?\s*/i, '')}` : ''}
      </Text>
      {v.clinic_name ? <Text style={[s.sub, { marginTop: 2 }]}>{v.clinic_name}</Text> : null}

      {open && (
        <View style={{ marginTop: 12, gap: 12 }}>
          {v.patient_summary ? <Note label="Summary for you" body={v.patient_summary} /> : null}
          {v.management_plan ? <Note label="Care plan" body={v.management_plan} /> : null}
          {v.medications?.length ? (
            <View>
              <Text style={[T.slab, { fontSize: 12, marginBottom: 6 }]}>Medicines</Text>
              {v.medications.map((m, i) => (
                <Text key={i} style={[s.sub, { opacity: 0.85, marginBottom: 3 }]}>
                  ℞ {medName(m)}
                  {medDetail(m) ? ` — ${medDetail(m)}` : ''}
                </Text>
              ))}
            </View>
          ) : null}
          {v.lab_tests?.length ? (
            <View>
              <Text style={[T.slab, { fontSize: 12, marginBottom: 6 }]}>Tests</Text>
              {v.lab_tests.map(t => (
                <Text key={t.id} style={[s.sub, { opacity: 0.85, marginBottom: 3 }]}>
                  ◎ {t.test_name}
                  {t.abnormal_flag ? ' · outside range' : ''}
                </Text>
              ))}
            </View>
          ) : null}
          {!notes && !v.medications?.length && !v.lab_tests?.length ? <Text style={s.sub}>No notes from this visit yet.</Text> : null}
        </View>
      )}
    </Pressable>
  )
}

function Note({ label, body }: { label: string; body: string }) {
  return (
    <View>
      <Text style={[T.slab, { fontSize: 12, marginBottom: 6 }]}>{label}</Text>
      <Text selectable style={{ fontFamily: F.serif, fontSize: 16.5, lineHeight: 25, color: C.ink }}>
        {body}
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  hero: { borderRadius: 16, overflow: 'hidden', padding: 16, marginBottom: 8 },
  heroSlab: { fontFamily: F.mono, fontSize: 12, letterSpacing: 1.4, color: C.jade, marginBottom: 10 },
  heroTitle: { fontFamily: F.serif, fontSize: 18, color: C.paper, lineHeight: 24 },
  heroMeta: { fontFamily: F.mono, fontSize: 12, color: C.mist, opacity: 0.7, marginTop: 6 },
  heroBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  heroBtnText: { fontFamily: F.sansBold, fontSize: 15 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 15, marginBottom: 10 },
  title: { flex: 1, fontFamily: F.sansBold, fontSize: 16.5, color: C.ink },
  sub: { fontFamily: F.sans, fontSize: 15, color: C.muted, lineHeight: 21 },
  date: { fontFamily: F.mono, fontSize: 12.5, color: C.jadeD },
  canon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
  },
})
