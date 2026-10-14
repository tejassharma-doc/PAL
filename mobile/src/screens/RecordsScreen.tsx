/**
 * Record — the website's "Medical Records": serif title, mono section labels
 * and white cards with a bold title, muted subtitle and a jade mono date.
 * Tap a card to expand its values.
 */
import React, { useState } from 'react'
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { C, F, T } from '../theme'
import { Badge, Body, Button, Empty, ErrorBox, Loading, PageTitle, Slab, useFocusLoad } from '../components/ui'
import { TabChrome } from '../components/Chrome'
import { LineIcon } from '../components/icons'
import * as api from '../lib/api'

export function medName(m: api.MedicationItem): string {
  return String(m.name ?? m.medicine_name ?? m.drug ?? (m as any).medication ?? 'Medicine')
}
export function medDetail(m: api.MedicationItem): string {
  return [m.dosage ?? m.dose, m.frequency, m.duration, m.instructions].filter(Boolean).join(' · ')
}

async function loadRecord() {
  const [labs, rx, docs] = await Promise.all([
    api.getLabTests(),
    api.getPrescriptions().catch(() => [] as api.Prescription[]),
    api.getRecordDocuments().catch(() => [] as api.RecordDocument[]),
  ])
  return { labs, rx, docs }
}

export default function RecordsScreen({ navigation }: any) {
  const { data, error, loading, refreshing, reload } = useFocusLoad(loadRecord)
  const empty = data && data.labs.length === 0 && data.rx.length === 0 && data.docs.length === 0

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <TabChrome title="Your record" sub="health records" />
      {loading ? (
        <Loading label="loading records…" />
      ) : (
        <Body refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} colors={[C.jade]} />}>
          <PageTitle title="Medical Records" lead="Complete medical history" />
          {error ? <ErrorBox message={error} onRetry={reload} /> : null}

          {empty && (
            <Empty
              icon="file-text"
              title="No records yet"
              body="Upload a lab report or prescription — PAL reads the values and you check them before anything is saved."
              action={<Button title="Upload a report" onPress={() => navigation.navigate('Upload')} style={{ alignSelf: 'stretch', marginTop: 6 }} />}
            />
          )}

          {data && data.labs.length > 0 && (
            <>
              <Slab>Lab tests & results</Slab>
              {data.labs.map(t => (
                <LabCard key={t.id} t={t} />
              ))}
            </>
          )}

          {data && data.rx.length > 0 && (
            <>
              <Slab>Prescriptions</Slab>
              {data.rx.map(p => (
                <RxCard key={p.id} p={p} />
              ))}
            </>
          )}

          {data && data.docs.length > 0 && (
            <>
              <Slab>Documents</Slab>
              {data.docs.map(d => (
                <View key={d.id} style={s.card}>
                  <View style={s.row}>
                    <Text style={s.title} numberOfLines={2}>
                      {d.title || d.file_name}
                    </Text>
                    {d.date ? <DateTag d={d.date} /> : null}
                  </View>
                  <Text style={s.sub}>
                    {d.kind} • {d.file_name}
                  </Text>
                </View>
              ))}
            </>
          )}
        </Body>
      )}
    </View>
  )
}

function DateTag({ d }: { d: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <LineIcon name="calendar" size={15} color={C.jadeD} />
      <Text style={s.date}>{d.slice(0, 10)}</Text>
    </View>
  )
}

function LabCard({ t }: { t: api.LabTest }) {
  const [open, setOpen] = useState(false)
  const rows: api.LabResultRow[] = Array.isArray(t.results) ? (t.results as api.LabResultRow[]) : []
  return (
    <Pressable onPress={() => setOpen(o => !o)} style={({ pressed }) => [s.card, pressed && { opacity: 0.9 }]} accessibilityHint="Show values">
      <View style={s.row}>
        <Text style={s.title} numberOfLines={2}>
          {t.report_name}
        </Text>
        {t.result_date || t.ordered_date ? <DateTag d={(t.result_date || t.ordered_date)!} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <Text style={s.sub}>
          Lab test • {t.status}
          {t.lab_name ? ` • ${t.lab_name}` : ''}
        </Text>
        {t.has_abnormal_values ? <Badge text="check values" tone="rose" /> : null}
      </View>
      {open && (
        <View style={{ marginTop: 12, gap: 6 }}>
          {rows.length === 0 && !t.interpretation ? <Text style={s.sub}>No values recorded.</Text> : null}
          {rows.map((r, i) => (
            <View key={i} style={[s.vital, r.abnormal ? { backgroundColor: 'rgba(194,103,94,0.07)' } : null]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.sansMedium, fontSize: 15, color: C.ink }}>{String(r.name ?? r.name_extracted ?? 'Value')}</Text>
                {r.range ? <Text style={[T.meta, { marginTop: 2 }]}>range {String(r.range)}</Text> : null}
              </View>
              <Text style={{ fontFamily: F.serif, fontSize: 18, color: r.abnormal ? C.rose : C.ink }}>
                {r.value ?? '—'}
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.muted }}> {r.unit ?? ''}</Text>
              </Text>
            </View>
          ))}
          {t.interpretation ? (
            <Text style={{ fontFamily: F.serif, fontSize: 16, lineHeight: 24, color: C.ink, marginTop: 4 }}>{t.interpretation}</Text>
          ) : null}
        </View>
      )}
    </Pressable>
  )
}

function RxCard({ p }: { p: api.Prescription }) {
  return (
    <View style={s.card}>
      <View style={s.row}>
        <Text style={s.title}>Prescription</Text>
        {p.created_at ? <DateTag d={p.created_at} /> : null}
      </View>
      {(p.items ?? []).map((m, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 10 }}>
          <View style={s.rxPic}>
            <Text style={{ color: C.jadeD, fontSize: 15 }}>℞</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.sansSemi, fontSize: 15, color: C.ink }}>{medName(m)}</Text>
            {medDetail(m) ? <Text style={[s.sub, { marginTop: 1 }]}>{medDetail(m)}</Text> : null}
          </View>
        </View>
      ))}
      {(!p.items || p.items.length === 0) && <Text style={[s.sub, { marginTop: 4 }]}>No items listed.</Text>}
      {p.refillable ? <Badge text={`${p.refills_remaining} refills left`} /> : null}
    </View>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 15, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontFamily: F.sansBold, fontSize: 17, color: C.ink },
  sub: { fontFamily: F.sans, fontSize: 15, color: C.muted },
  date: { fontFamily: F.mono, fontSize: 12.5, color: C.jadeD },
  vital: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(13,31,36,0.03)' },
  rxPic: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.jadeTint, alignItems: 'center', justifyContent: 'center' },
})
