/**
 * Upload — "Upload Lab Report" from the website, then the review step:
 * PAL reads the values, the patient checks/corrects them, nothing is saved
 * until they tap Save.
 *
 * Server flow (medical-data-toolkit, unchanged):
 *   POST /medical/upload   → pending_verification with extracted observations
 *                            (or document_accepted when extraction is off)
 *   POST /medical/confirm  → saves the reviewed values as a lab report and,
 *                            for medicine rows, optional reminder schedules
 */
import React, { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker'
import { C, F, T } from '../theme'
import { Badge, Body, BreathDot, Button, ErrorBox, PageTitle, Slab, Toggle, fmtDate } from '../components/ui'
import { Gradient } from '../components/icons'
import { TabChrome } from '../components/Chrome'
import { LineIcon } from '../components/icons'
import * as api from '../lib/api'

type Pending = Extract<api.UploadResult, { type: 'pending_verification' }>

const MAX_BYTES = 20 * 1024 * 1024

export default function UploadScreen({ navigation }: any) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [obs, setObs] = useState<api.Observation[]>([])
  const [reminders, setReminders] = useState(true)

  const choose = async () => {
    setError(null)
    setDone(null)
    try {
      const [f] = await pick({ type: [types.pdf, types.images], mode: 'import' })
      const mime = f.type ?? ''
      if (!/^(application\/pdf|image\/(jpeg|jpg|png))$/.test(mime)) {
        setError('Please choose a PDF, JPEG or PNG file.')
        return
      }
      if (f.size && f.size > MAX_BYTES) {
        setError('That file is larger than 20 MB.')
        return
      }
      setBusy(true)
      const r = await api.uploadMedicalDocument({
        uri: f.uri,
        name: f.name ?? (mime === 'application/pdf' ? 'report.pdf' : 'report.jpg'),
        type: mime,
      })
      if (r.type === 'pending_verification') {
        setPending(r)
        setObs(r.observations.map(o => ({ ...o, original_display: o.original_display ?? o.display })))
      } else if (r.type === 'document_accepted') {
        setDone(
          r.mdt_error
            ? `Saved "${r.filename}", but PAL could not read its values (${r.mdt_error}).`
            : `Saved "${r.filename}" to your record.`,
        )
      } else {
        setError(r.message)
      }
    } catch (e: any) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return
      setError(e?.message ?? 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const edit = (i: number, patch: Partial<api.Observation>) =>
    setObs(prev => prev.map((o, j) => (j === i ? { ...o, ...patch, edited: true } : o)))
  const remove = (i: number) => setObs(prev => prev.filter((_, j) => j !== i))

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.confirmMedicalDocument(pending, obs, reminders)
      setPending(null)
      setObs([])
      const parts = [`Saved ${r.observations_count} value${r.observations_count === 1 ? '' : 's'}`]
      if (r.edits_applied) parts.push(`${r.edits_applied} corrected by you`)
      if (r.reminders_created) parts.push(`${r.reminders_created} medicine reminder${r.reminders_created === 1 ? '' : 's'} created`)
      setDone(parts.join(', ') + '.')
    } catch (e: any) {
      setError(e?.message ?? 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const discard = () =>
    Alert.alert('Discard this upload?', 'Nothing from this document will be saved to your record.', [
      { text: 'Keep reviewing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setPending(null)
          setObs([])
        },
      },
    ])

  const hasMeds = obs.some(o => o.is_medication || o.dosage || o.frequency || (o.times && o.times.length))

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <TabChrome title="Upload" sub="add to your record" />
      <Body bottomPad={32}>
        {!pending && (
          <>
            <PageTitle title="Upload Lab Report" lead="Upload your medical reports for automatic processing" />
            {error ? <ErrorBox message={error} /> : null}
            {done ? (
              <View style={s.done}>
                <Text style={{ fontFamily: F.sansSemi, fontSize: 16, color: C.jadeD }}>✓ {done}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Button title="View record" small kind="secondary" onPress={() => navigation.navigate('Record')} />
                  <Button title="Upload another" small kind="outline" onPress={choose} />
                </View>
              </View>
            ) : null}

            <Pressable onPress={choose} disabled={busy} accessibilityRole="button" style={({ pressed }) => [s.choose, pressed && { opacity: 0.9 }]}>
              <Gradient colors={['#3bb79c', '#2a9a84']} angle={135} radius={16} />
              {busy ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <BreathDot />
                  <Text style={s.chooseText}>Reading your report…</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <LineIcon name="folder-open" size={24} color="#fff" />
                  <Text style={s.chooseText}>Choose file</Text>
                </View>
              )}
            </Pressable>

            <View style={s.info}>
              <InfoRow icon="upload" text="PDF, JPEG or PNG — up to 20 MB" />
              <InfoRow icon="scan-eye" text="PAL reads the values; you check them before anything is saved" />
              <InfoRow icon="ban" text="Scans and X-ray images (DICOM) are not supported" />
            </View>
          </>
        )}

        {pending && (
          <>
            <PageTitle title="Check what PAL read" lead="Correct anything that looks wrong, then save." />
            {error ? <ErrorBox message={error} /> : null}
            <View style={s.reportCard}>
              <Text style={[T.slab, { marginTop: 0, color: C.jadeD, opacity: 1, fontSize: 12 }]}>✶ {pending.doc_kind.replace(/_/g, ' ')}</Text>
              <Text style={{ fontFamily: F.serif, fontSize: 19, color: C.ink, marginTop: 2 }}>{pending.report_title || pending.filename}</Text>
              <Text style={[T.meta, { marginTop: 4 }]}>
                {pending.report_date ? fmtDate(pending.report_date) : 'date not found'}
                {pending.patient_name_on_doc ? ` · name on report: ${pending.patient_name_on_doc}` : ''}
              </Text>
              {pending.patient_name_on_profile == null ? (
                <View style={s.warn}>
                  <Text style={s.warnText}>Check that this report is yours before saving.</Text>
                </View>
              ) : pending.name_match_status !== 'match' ? (
                <View style={s.warn}>
                  <Text style={s.warnText}>
                    {pending.name_match_status === 'partial'
                      ? 'The name on this report only partly matches your profile. Make sure it is yours.'
                      : 'The name on this report does not match your profile. Only save it if it is yours.'}
                  </Text>
                </View>
              ) : null}
              {pending.warnings?.map((w, i) => (
                <Text key={i} style={[s.warnText, { marginTop: 6 }]}>
                  • {w}
                </Text>
              ))}
              {pending.source_modality === 'handwritten' ? (
                <View style={{ marginTop: 8 }}>
                  <Badge text="handwritten — check carefully" tone="amber" />
                </View>
              ) : null}
            </View>

            <Slab>Values ({obs.length})</Slab>
            {obs.length === 0 && <Text style={T.lead}>No values were found in this document.</Text>}
            {obs.map((o, i) => (
              <View key={i} style={[s.obs, o.legible === false && { borderColor: 'rgba(194,103,94,0.4)' }]}>
                <TextInput style={s.obsName} value={o.display} onChangeText={t => edit(i, { display: t })} accessibilityLabel="Test or medicine name" />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[s.obsInput, { flex: 2 }]}
                    value={(o.is_medication ? o.dosage ?? o.value : o.value) ?? ''}
                    onChangeText={t => edit(i, o.is_medication ? { dosage: t } : { value: t })}
                    placeholder={o.is_medication ? 'Dose' : 'Value'}
                    placeholderTextColor="rgba(13,31,36,0.35)"
                    accessibilityLabel="Value"
                  />
                  <TextInput
                    style={[s.obsInput, { flex: 1 }]}
                    value={o.unit ?? ''}
                    onChangeText={t => edit(i, { unit: t })}
                    placeholder="Unit"
                    placeholderTextColor="rgba(13,31,36,0.35)"
                    accessibilityLabel="Unit"
                  />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={T.meta}>
                    {o.reference_range ? `range ${o.reference_range}` : [o.frequency, o.duration].filter(Boolean).join(' · ')}
                    {o.legible === false ? '  ·  hard to read' : ''}
                  </Text>
                  <Pressable onPress={() => remove(i)} hitSlop={8}>
                    <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.rose }}>remove</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            {hasMeds && (
              <View style={s.toggleRow}>
                <LineIcon name="pill" size={18} color={C.jadeD} />
                <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 15, color: C.ink }}>Create medicine reminders from this</Text>
                <Toggle value={reminders} onChange={setReminders} label="Create medicine reminders" />
              </View>
            )}
            <Button title="Save to my record" onPress={confirm} loading={busy} disabled={obs.length === 0} style={{ marginTop: 6 }} />
            <Button title="Discard" kind="outline" onPress={discard} disabled={busy} style={{ marginTop: 8 }} />
          </>
        )}
      </Body>
    </View>
  )
}

function InfoRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6 }}>
      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: C.jadeTint, alignItems: 'center', justifyContent: 'center' }}>
        <LineIcon name={icon} size={17} color={C.jadeD} />
      </View>
      <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 15, color: C.ink }}>{text}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  choose: { height: 66, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 14 },
  chooseText: { fontFamily: F.serifMedium, fontSize: 19, color: '#fff' },
  info: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12 },
  done: { backgroundColor: 'rgba(55,181,155,0.08)', borderWidth: 1, borderColor: 'rgba(55,181,155,0.3)', borderRadius: 14, padding: 14, marginBottom: 10 },
  reportCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 15 },
  warn: { backgroundColor: C.roseTint, borderWidth: 1, borderColor: C.roseLine, borderRadius: 11, padding: 10, marginTop: 10 },
  warnText: { fontFamily: F.sans, fontSize: 13.5, color: C.rose, lineHeight: 19 },
  obs: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 12, marginBottom: 9 },
  obsName: { fontFamily: F.sansSemi, fontSize: 16, color: C.ink, paddingVertical: 4, marginBottom: 6 },
  obsInput: {
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: F.serif,
    fontSize: 17,
    color: C.ink,
    backgroundColor: C.soft,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(13,31,36,0.08)',
    marginVertical: 6,
  },
})
