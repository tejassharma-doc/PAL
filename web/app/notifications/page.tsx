'use client'

/**
 * Notifications (bell) — redesigned onto AppShell (matches the rest of the app).
 * Real medication reminders: doses awaiting your answer (with the four response
 * buttons) + today's scheduled doses. Data via lib/medications-api.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import {
  listMedicationSchedules, pendingDoses, respondToDose,
  type MedicationSchedule, type PendingDose, type DoseResponse,
} from '@/lib/medications-api'

const ACK: { value: DoseResponse; label: string; primary?: boolean }[] = [
  { value: 'yes', label: 'Yes', primary: true },
  { value: 'take_now', label: 'Will take now', primary: true },
  { value: 'snooze_10', label: 'In 10 mins' },
  { value: 'no', label: 'No' },
]
function todayDow(): number { return (new Date().getDay() + 6) % 7 }
function fmtTime(t: string): string {
  const [h, m] = (t || '').split(':').map(Number)
  if (Number.isNaN(h)) return t
  const am = h < 12; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${am ? 'am' : 'pm'}`
}
type TodayDose = { key: string; medicine: string; dosage: string | null; time: string }
function dosesForToday(schedules: MedicationSchedule[]): TodayDose[] {
  const dow = todayDow(); const out: TodayDose[] = []
  for (const s of schedules) {
    if (!s.active) continue
    if (s.days_of_week?.length && !s.days_of_week.includes(dow)) continue
    for (const time of s.times || []) out.push({ key: `${s.id}:${time}`, medicine: s.medicine_name, dosage: s.dosage, time })
  }
  return out.sort((a, b) => a.time.localeCompare(b.time))
}

export default function NotificationsPage() {
  const router = useRouter()
  const [patientId, setPatientId] = useState<string | null>(null)
  const [schedules, setSchedules] = useState<MedicationSchedule[]>([])
  const [pending, setPending] = useState<PendingDose[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    setPatientId(localStorage.getItem('pal_patient_id'))
  }, [router])

  const load = useCallback(async () => {
    if (!patientId) { setLoading(false); return }
    setLoading(true)
    try {
      const [sch, doses] = await Promise.all([listMedicationSchedules(patientId), pendingDoses(patientId)])
      setSchedules(sch); setPending(doses); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load reminders') }
    finally { setLoading(false) }
  }, [patientId])
  useEffect(() => { void load() }, [load])

  async function answer(doseId: string, value: DoseResponse) {
    setBusy(doseId)
    try { await respondToDose(doseId, value); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to respond') }
    finally { setBusy(null) }
  }

  const awaiting = pending.filter(d => d.status === 'awaiting_ack')
  const today = dosesForToday(schedules)
  const empty = !loading && patientId && awaiting.length === 0 && today.length === 0

  return (
    <AppShell active="meds" title="Notifications" medsBadge={awaiting.length}>
      <div className="page narrow">
        <h1 className="h">Reminders</h1>
        <p className="lede">Your medicine reminders appear here at their scheduled times.</p>

        {error && <div className="alertcard" style={{ marginTop: '1em' }}><Icon name="alert" /><div><b>Something went wrong</b><span className="muted small">{error}</span></div></div>}
        {loading && <div className="muted" style={{ marginTop: '1em' }}>Loading…</div>}

        {!loading && awaiting.length > 0 && (<>
          <h2 className="s">Needs your answer</h2>
          <div className="tl">
            {awaiting.map(d => (
              <article className="card due" key={d.id}>
                <div className="head">
                  <div className="pillico"><Icon name="pill" /></div>
                  <div>
                    <div className="when">{fmtTime(d.scheduled_time || '')}{d.scheduled_date ? ` · ${d.scheduled_date}` : ''}</div>
                    <div className="what">Did you take your medicine?</div>
                  </div>
                </div>
                <div className="acts">
                  <div className="two">
                    {ACK.map(opt => (
                      <button key={opt.value} className={`btn ${opt.primary ? 'pri' : 'sec'}`} disabled={busy === d.id} onClick={() => void answer(d.id, opt.value)}>{opt.label}</button>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>)}

        {!loading && today.length > 0 && (<>
          <h2 className="s">Today</h2>
          <div className="list">
            {today.map(d => (
              <div className="li" key={d.key}>
                <span className="ic rx"><Icon name="pill" /></span>
                <span className="tx"><b>{d.medicine}</b><span>{[d.dosage, fmtTime(d.time)].filter(Boolean).join(' · ')}</span></span>
              </div>
            ))}
          </div>
        </>)}

        {empty && (
          <article className="card" style={{ marginTop: '1em', textAlign: 'center' }}>
            <div className="pillico" style={{ margin: '0 auto .6em' }}><Icon name="bell" /></div>
            <b>No reminders right now</b>
            <p className="muted small" style={{ margin: '.3em 0 1em' }}>Medicine reminders will appear here at their scheduled times.</p>
            <button className="btn pri" onClick={() => router.push('/medications')}>Manage medicines</button>
          </article>
        )}

        {!loading && patientId && (awaiting.length > 0 || today.length > 0) && (
          <div className="row" style={{ marginTop: '1em', justifyContent: 'center' }}>
            <button className="btn sec" onClick={() => router.push('/medications')}>Manage schedules</button>
          </div>
        )}
      </div>
    </AppShell>
  )
}
