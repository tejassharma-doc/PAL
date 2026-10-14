/**
 * Medication reminders — the website's /medications page: "✶ ADD A MEDICINE"
 * card with times + day circles, then one card per medicine with a jade left
 * bar and a "⏰ 08:00 · Mon, Tue…" chip, plus the "did you take it?" doses.
 */
import React, { useState } from 'react'
import { Alert, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { C, F, T } from '../theme'
import { AppBar, Body, Button, Empty, ErrorBox, Loading, Slab, Toggle, useFocusLoad } from '../components/ui'
import * as api from '../lib/api'
import { LineIcon } from '../components/icons'
import { ApiError } from '../lib/http'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

async function loadAll() {
  try {
    const [schedules, doses] = await Promise.all([api.listSchedules(), api.pendingDoses()])
    return { enabled: true as const, schedules, doses }
  } catch (e) {
    // The /medications router is only mounted when MEDICATION_REMINDER_ENABLED=true.
    if (e instanceof ApiError && e.status === 404 && e.message === 'Not Found') {
      return { enabled: false as const, schedules: [] as api.MedicationSchedule[], doses: [] as api.DoseEvent[] }
    }
    throw e
  }
}

function summary(s: api.MedicationSchedule) {
  const t = (s.times || []).join(', ') || '—'
  const d = (s.days_of_week?.length ? s.days_of_week : [0, 1, 2, 3, 4, 5, 6]).map(x => DAYS[x]).join(', ')
  return `${t} · ${s.days_of_week?.length && s.days_of_week.length < 7 ? d : 'every day'}`
}

export default function MedicationsScreen({ navigation }: any) {
  const { data, error, loading, refreshing, reload, setData } = useFocusLoad(loadAll)
  const [adding, setAdding] = useState(false)
  const showForm = adding || (data?.enabled && data.schedules.length === 0)

  const scheduleName = (id: string) => data?.schedules.find(s => s.id === id)?.medicine_name ?? 'Medicine'

  const respond = async (dose: api.DoseEvent, r: api.DoseResponse) => {
    try {
      await api.respondToDose(dose.id, r)
      setData(d => (d ? { ...d, doses: d.doses.filter(x => x.id !== dose.id) } : d))
    } catch (e: any) {
      Alert.alert('Could not record', e?.message ?? '')
    }
  }

  const toggle = async (s: api.MedicationSchedule, active: boolean) => {
    setData(d => (d ? { ...d, schedules: d.schedules.map(x => (x.id === s.id ? { ...x, active } : x)) } : d))
    try {
      await api.updateSchedule(s.id, { active })
    } catch (e: any) {
      Alert.alert('Could not update', e?.message ?? '')
      reload()
    }
  }

  const remove = (s: api.MedicationSchedule) =>
    Alert.alert(`Delete ${s.medicine_name}?`, 'The reminder and its history will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteSchedule(s.id)
            setData(d => (d ? { ...d, schedules: d.schedules.filter(x => x.id !== s.id) } : d))
          } catch (e: any) {
            Alert.alert('Could not delete', e?.message ?? '')
          }
        },
      },
    ])

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <AppBar
        title="You"
        sub="medication schedule"
        onBack={() => navigation.goBack()}
        right={
          data?.enabled && data.schedules.length > 0 ? (
            <Pressable onPress={() => setAdding(a => !a)} hitSlop={8} accessibilityLabel={adding ? 'Close' : '+ Add'}>
              <Text style={{ color: C.jade, fontSize: 22, fontFamily: F.sans }}>{adding ? '×' : '+'}</Text>
            </Pressable>
          ) : undefined
        }
      />
      {loading ? (
        <Loading />
      ) : (
        <Body refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} colors={[C.jade]} />}>
          <Text style={s.h}>Medication reminders</Text>
          <Text style={[T.lead, { marginBottom: 14 }]}>Add medicines to get reminders at the right time</Text>
          {error ? <ErrorBox message={error} onRetry={reload} /> : null}

          {data && !data.enabled && (
            <Empty icon="⏰" title="Reminders are switched off" body="Medicine reminders are not enabled on this PAL server yet (MEDICATION_REMINDER_ENABLED)." />
          )}

          {data?.enabled && data.doses.length > 0 && (
            <>
              <Slab>Did you take these?</Slab>
              {data.doses.map(d => (
                <View key={d.id} style={[s.card, { borderColor: 'rgba(55,181,155,0.5)' }]}>
                  <Text style={s.name}>{scheduleName(d.schedule_id)}</Text>
                  <Text style={[T.meta, { marginTop: 4 }]}>
                    due {d.scheduled_time} · {d.scheduled_date}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                    <Mini label="Yes, taken" primary onPress={() => respond(d, 'yes')} />
                    <Mini label="Taking now" primary onPress={() => respond(d, 'take_now')} />
                    <Mini label="In 10 mins" onPress={() => respond(d, 'snooze_10')} />
                    <Mini label="Skipped" onPress={() => respond(d, 'no')} />
                  </View>
                </View>
              ))}
            </>
          )}

          {showForm && data?.enabled && (
            <AddForm
              onSaved={sc => {
                setAdding(false)
                setData(d => (d ? { ...d, schedules: [sc, ...d.schedules] } : d))
              }}
            />
          )}

          {data?.enabled &&
            data.schedules.map(sc => (
              <View key={sc.id} style={[s.card, { borderLeftWidth: 3, borderLeftColor: sc.active ? C.jade : C.line2, opacity: sc.active ? 1 : 0.6 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{sc.medicine_name}</Text>
                    {sc.dosage ? <Text style={[T.lead, { marginTop: 2, fontSize: 15 }]}>{sc.dosage}</Text> : null}
                    <View style={s.when}>
                      <Text style={s.whenText}>⏰ {summary(sc)}</Text>
                    </View>
                    {!sc.active ? <Text style={s.paused}>Paused</Text> : null}
                    {sc.end_date ? <Text style={[T.meta, { marginTop: 6 }]}>until {sc.end_date}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 12 }}>
                    <Toggle value={sc.active} onChange={v => toggle(sc, v)} label={`Reminders for ${sc.medicine_name}`} />
                    <Pressable onPress={() => remove(sc)} hitSlop={8} accessibilityLabel={`Delete ${sc.medicine_name}`}>
                      <Text style={{ fontFamily: F.sansSemi, fontSize: 13.5, color: C.rose }}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
        </Body>
      )}
    </View>
  )
}

function Mini({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: 8,
        backgroundColor: primary ? C.jade : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: C.line2,
      }}
    >
      <Text style={{ fontFamily: F.sansSemi, fontSize: 13.5, color: primary ? C.deep2 : C.ink }}>{label}</Text>
    </Pressable>
  )
}

function AddForm({ onSaved }: { onSaved: (s: api.MedicationSchedule) => void }) {
  const [name, setName] = useState('')
  const [dosage, setDosage] = useState('')
  const [times, setTimes] = useState<string[]>(['09:00'])
  const [days, setDays] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fixTime = (t: string) => (/^\d:\d\d$/.test(t) ? '0' + t : t.trim())

  const save = async () => {
    setError(null)
    const list = times.map(fixTime).filter(Boolean)
    if (!name.trim()) return setError('Enter the medicine name.')
    const bad = list.filter(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
    if (bad.length) return setError(`Times must be 24-hour HH:MM (check: ${bad.join(', ')}).`)
    setBusy(true)
    try {
      onSaved(
        await api.createSchedule({
          medicine_name: name.trim(),
          dosage: dosage.trim() || undefined,
          times: Array.from(new Set(list)).sort(),
          days_of_week: [...days].sort(),
        }),
      )
    } catch (e: any) {
      setError(e?.message ?? 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={s.card}>
      <Text style={s.formSlab}>✶ ADD A MEDICINE</Text>
      {error ? <ErrorBox message={error} /> : null}
      <Text style={s.label}>Medicine name</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. Atorvastatin" placeholderTextColor="rgba(13,31,36,0.38)" accessibilityLabel="Medicine name" />
      <Text style={s.label}>Dosage (optional)</Text>
      <TextInput style={s.input} value={dosage} onChangeText={setDosage} placeholder="e.g. 1 tablet" placeholderTextColor="rgba(13,31,36,0.38)" accessibilityLabel="Dosage" />
      <Text style={s.label}>Times</Text>
      {times.map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <TextInput
            style={[s.input, { flex: 1, marginBottom: 0 }]}
            value={t}
            onChangeText={v => setTimes(ts => ts.map((x, j) => (j === i ? v : x)))}
            placeholder="HH:MM"
            placeholderTextColor="rgba(13,31,36,0.38)"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            accessibilityLabel={`Time ${i + 1}`}
          />
          {times.length > 1 && (
            <Pressable onPress={() => setTimes(ts => ts.filter((_, j) => j !== i))} accessibilityLabel={`Remove time ${i + 1}`} style={[s.input, { width: 46, marginBottom: 0, alignItems: 'center', justifyContent: 'center' }]}>
              <LineIcon name="x" size={20} color={C.rose} />
            </Pressable>
          )}
        </View>
      ))}
      <Pressable onPress={() => setTimes(ts => [...ts, '20:00'])} style={{ paddingVertical: 2, marginBottom: 14 }}>
        <Text style={{ color: C.jadeD, fontFamily: F.sansSemi, fontSize: 15 }}>+ add another time</Text>
      </Pressable>
      <Text style={s.label}>Days (none = every day)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {DOW.map((d, i) => {
          const on = days.includes(i)
          return (
            <Pressable
              key={i}
              onPress={() => setDays(ds => (on ? ds.filter(x => x !== i) : [...ds, i]))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={DAYS[i]}
              style={[s.day, on && { backgroundColor: C.jade, borderWidth: 0 }]}
            >
              <Text style={{ fontFamily: F.sansSemi, fontSize: 15, color: on ? '#06201a' : C.ink }}>{d}</Text>
            </Pressable>
          )
        })}
      </View>
      <Button title={busy ? 'Saving…' : '＋ Add reminder'} onPress={save} loading={busy} disabled={!name.trim()} />
    </View>
  )
}

const s = StyleSheet.create({
  h: { fontFamily: F.sansBold, fontSize: 20, color: C.ink, marginTop: 6, marginBottom: 2 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.line, marginBottom: 12 },
  formSlab: { fontFamily: F.mono, fontSize: 12, letterSpacing: 1.2, color: C.jadeD, marginBottom: 12 },
  label: { fontFamily: F.sansSemi, fontSize: 13.5, color: C.muted, marginBottom: 5 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: F.sans,
    fontSize: 16.5,
    color: C.ink,
    marginBottom: 12,
  },
  day: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line2, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: F.sansBold, fontSize: 17, color: C.ink },
  when: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: 'rgba(55,181,155,0.12)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  whenText: { fontFamily: F.sansSemi, fontSize: 13.5, color: C.jadeD },
  paused: { fontFamily: F.sans, fontSize: 12.5, color: C.muted, marginTop: 6, fontStyle: 'italic' },
})
