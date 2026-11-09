'use client'

/**
 * Medicines — redesigned onto AppShell (pal-app.html `S.meds`).
 * Today's timeline (taken / skipped / due-now) from pending doses joined to
 * schedules, the due-now card with Yes / snooze / skip, and the full medicine
 * list with add / edit / pause / delete. All data via lib/medications-api.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import {
  listMedicationSchedules, pendingDoses, respondToDose,
  createMedicationSchedule, updateMedicationSchedule, deleteMedicationSchedule,
  type MedicationSchedule, type PendingDose, type DoseResponse,
} from '@/lib/medications-api'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function fmtTime(t: string): string {
  // "21:00" -> "9:00 pm"
  const [h, m] = (t || '').split(':').map(Number)
  if (Number.isNaN(h)) return t
  const am = h < 12
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${am ? 'am' : 'pm'}`
}
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
type DoseState = 'taken' | 'skipped' | 'due'
function doseState(d: PendingDose): DoseState {
  const r = (d.response || '').toLowerCase()
  const s = (d.status || '').toLowerCase()
  if (r === 'yes' || s === 'taken' || s === 'confirmed') return 'taken'
  if (r === 'no' || s === 'skipped' || s === 'missed') return 'skipped'
  return 'due'
}

export default function MedicationsPage() {
  const router = useRouter()
  const [patientId, setPatientId] = useState<string | null>(null)
  const [schedules, setSchedules] = useState<MedicationSchedule[]>([])
  const [doses, setDoses] = useState<PendingDose[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyDose, setBusyDose] = useState<string | null>(null)

  // add/edit form
  const [showAdd, setShowAdd] = useState(false)
  const [medicine, setMedicine] = useState('')
  const [dosage, setDosage] = useState('')
  const [times, setTimes] = useState<string[]>(['09:00'])
  const [days, setDays] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    setPatientId(localStorage.getItem('pal_patient_id'))
  }, [router])

  const load = useCallback(async () => {
    if (!patientId) { setLoading(false); return }
    setLoading(true)
    try {
      const [sch, ds] = await Promise.all([
        listMedicationSchedules(patientId),
        pendingDoses(patientId).catch(() => [] as PendingDose[]),
      ])
      setSchedules(sch)
      setDoses(ds)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load medicines')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => { void load() }, [load])

  const schedById = useMemo(() => {
    const m = new Map<string, MedicationSchedule>()
    schedules.forEach(s => m.set(s.id, s))
    return m
  }, [schedules])

  const today = todayStr()
  const todayDoses = useMemo(
    () => doses
      .filter(d => !d.scheduled_date || d.scheduled_date === today)
      .sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || '')),
    [doses, today],
  )
  const dueCount = useMemo(() => todayDoses.filter(d => doseState(d) === 'due').length, [todayDoses])

  async function respond(dose: PendingDose, r: DoseResponse) {
    setBusyDose(dose.id)
    try {
      await respondToDose(dose.id, r)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update dose')
    } finally {
      setBusyDose(null)
    }
  }

  // ── add / edit ──
  const toggleDay = (d: number) => setDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d].sort())
  const resetForm = () => { setMedicine(''); setDosage(''); setTimes(['09:00']); setDays([]); setEditingId(null) }
  const startAdd = () => { resetForm(); setShowAdd(true) }
  const startEdit = (s: MedicationSchedule) => {
    setEditingId(s.id); setMedicine(s.medicine_name); setDosage(s.dosage || '')
    setTimes(s.times?.length ? [...s.times] : ['09:00']); setDays(s.days_of_week || [])
    setShowAdd(true)
  }
  const submit = async () => {
    if (!patientId || !medicine.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        await updateMedicationSchedule(editingId, {
          medicine_name: medicine.trim(), dosage: dosage.trim() || undefined,
          times: times.filter(Boolean), days_of_week: days,
        })
      } else {
        await createMedicationSchedule({
          patient_id: patientId, medicine_name: medicine.trim(), dosage: dosage.trim() || undefined,
          times: times.filter(Boolean), days_of_week: days,
        })
      }
      resetForm(); setShowAdd(false); await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally { setSaving(false) }
  }
  const toggleActive = async (s: MedicationSchedule) => { await updateMedicationSchedule(s.id, { active: !s.active }); await load() }
  const remove = async (s: MedicationSchedule) => { await deleteMedicationSchedule(s.id); await load() }

  function scheduleSummary(s: MedicationSchedule): string {
    const t = (s.times || []).map(fmtTime).join(', ') || '—'
    const dows = s.days_of_week?.length ? s.days_of_week : [0, 1, 2, 3, 4, 5, 6]
    const d = dows.length === 7 ? 'every day' : dows.map(x => DAYS[x]).join(', ')
    return `${t} · ${d}`
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <AppShell active="meds" title="Medicines" medsBadge={dueCount}>
      <div className="page narrow">
        <div className="headrow">
          <div><h1 className="h">Today&apos;s medicines</h1><p className="lede">{dateLabel}</p></div>
          <button className="btn sec" onClick={startAdd}><Icon name="plus" /> Add a medicine</button>
        </div>

        {error && <div className="alertcard" style={{ marginTop: '1em' }}><Icon name="alert" /><div><b>Something went wrong</b><span className="muted small">{error}</span></div></div>}

        {/* add / edit form */}
        {showAdd && (
          <article className="card" style={{ marginTop: '1em' }}>
            <h2 className="s" style={{ marginTop: 0 }}>{editingId ? 'Edit medicine' : 'Add a medicine'}</h2>
            <div className="field"><label>Medicine name</label><input value={medicine} onChange={e => setMedicine(e.target.value)} placeholder="e.g. Atorvastatin" /></div>
            <div className="field"><label>Dosage (optional)</label><input value={dosage} onChange={e => setDosage(e.target.value)} placeholder="e.g. 1 tablet" /></div>
            <div className="field"><label>Times</label>
              {times.map((t, i) => (
                <div key={i} className="row" style={{ marginBottom: 6 }}>
                  <input type="time" style={{ flex: 1 }} value={t} onChange={e => setTimes(p => p.map((x, j) => j === i ? e.target.value : x))} />
                  {times.length > 1 && <button className="btn sec" onClick={() => setTimes(p => p.filter((_, j) => j !== i))}>✕</button>}
                </div>
              ))}
              <button className="btn ghost" style={{ padding: 0 }} onClick={() => setTimes(p => [...p, '12:00'])}>+ add another time</button>
            </div>
            <div className="field"><label>Days (none = every day)</label>
              <div className="row">
                {DAYS.map((d, i) => (
                  <button key={d} title={d} onClick={() => toggleDay(i)} aria-pressed={days.includes(i)}
                    style={{ width: '2.4em', height: '2.4em', borderRadius: 999, border: days.includes(i) ? 'none' : '1px solid var(--line-2)', background: days.includes(i) ? 'var(--jade-deep)' : '#fff', color: days.includes(i) ? '#fff' : 'var(--ink)', fontWeight: 600, minHeight: 0 }}>
                    {DOW_SHORT[i]}
                  </button>
                ))}
              </div>
            </div>
            <div className="row" style={{ marginTop: '1em' }}>
              <button className="btn pri" onClick={() => void submit()} disabled={saving || !medicine.trim()}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add reminder'}</button>
              <button className="btn ghost" onClick={() => { resetForm(); setShowAdd(false) }}>Cancel</button>
            </div>
          </article>
        )}

        {/* today's timeline */}
        {loading ? (
          <div className="muted" style={{ marginTop: '1.4em' }}>Loading…</div>
        ) : todayDoses.length > 0 ? (
          <div className="tl" style={{ marginTop: '1.4em' }}>
            {todayDoses.map(dose => {
              const sch = schedById.get(dose.schedule_id)
              const name = sch?.medicine_name || 'Medicine'
              const dose2 = sch?.dosage ? `${sch.dosage}` : ''
              const st = doseState(dose)
              return (
                <div className="tli" key={dose.id}>
                  <div className="tm" style={st === 'due' ? { color: 'var(--jade-deep)' } : undefined}>{fmtTime(dose.scheduled_time)}</div>
                  {st === 'due' ? (
                    <article className="card due">
                      <div className="head">
                        <div className="pillico"><Icon name="pill" /></div>
                        <div>
                          <div className="when">Due now, {fmtTime(dose.scheduled_time)}</div>
                          <div className="what">{name}</div>
                          {dose2 && <div className="dhow">{dose2}</div>}
                        </div>
                      </div>
                      <div className="acts">
                        <button className="btn pri" disabled={busyDose === dose.id} onClick={() => void respond(dose, 'yes')}><Icon name="check" /> Yes, I took it</button>
                        <div className="two">
                          <button className="btn sec" disabled={busyDose === dose.id} onClick={() => void respond(dose, 'snooze_10')}><Icon name="clock" /> In 10 minutes</button>
                          <button className="btn sec" disabled={busyDose === dose.id} onClick={() => void respond(dose, 'no')}>Skip this dose</button>
                        </div>
                      </div>
                    </article>
                  ) : (
                    <div className="card doneline">
                      <div className="pillico" style={st === 'skipped' ? { background: 'var(--soft)', color: 'var(--ink-3)' } : undefined}><Icon name="pill" /></div>
                      <div><b>{name}</b>{dose2 && <div className="muted small">{dose2}</div>}</div>
                      {st === 'taken'
                        ? <span className="tag ok st"><Icon name="check" /> Taken</span>
                        : <span className="tag warn st">Skipped</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: '1.4em' }}>No doses scheduled for today.</p>
        )}

        {/* all medicines */}
        <h2 className="s">All your medicines</h2>
        {schedules.length === 0 && !loading ? (
          <article className="card"><p className="muted">No medicines yet. Add one above, or upload a prescription.</p></article>
        ) : (
          <div className="list">
            {schedules.map(s => (
              <div key={s.id} className="li medrow" style={{ opacity: s.active ? 1 : 0.6, alignItems: 'flex-start' }}>
                <span className={`ic ${s.active ? 'rx' : ''}`}><Icon name="pill" /></span>
                <span className="tx">
                  <b>{s.medicine_name}{s.dosage ? ` ${s.dosage}` : ''}</b>
                  <span>{scheduleSummary(s)}{!s.active ? ' · Paused' : ''}</span>
                </span>
                <span className="row" style={{ flexWrap: 'nowrap', gap: '.4em' }}>
                  <button className="btn sec small" style={{ minHeight: '2.4em', padding: '0 .7em' }} onClick={() => startEdit(s)}>Edit</button>
                  <button className="btn sec small" style={{ minHeight: '2.4em', padding: '0 .7em' }} onClick={() => void toggleActive(s)}>{s.active ? 'Pause' : 'Resume'}</button>
                  <button className="btn ghost small" style={{ minHeight: '2.4em', color: 'var(--rose-deep)' }} onClick={() => void remove(s)}>Delete</button>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="muted small" style={{ marginTop: '1em' }}>New prescriptions from your doctor are added here automatically. Reminders arrive as a notification at each time.</p>
      </div>
    </AppShell>
  )
}
