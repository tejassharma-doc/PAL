'use client'

/**
 * Home — redesigned onto AppShell (pal-app.html `S.home`). Replaces the former
 * 2792-line monolithic tabbed app (preserved in git history); every section now
 * lives in its own route (/ask, /medications, /visits, /records, /family, …).
 * Greeting, "needs attention" (due dose + abnormal reading), latest readings,
 * next visit, add-report and family cards — all wired to real data.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import { Reading, readingFromFact } from '@/components/ui/Reading'
import { getHealthFacts, type HealthFact } from '@/lib/api'
import { getPatientVisits, type Visit } from '@/lib/api-auth'
import { listMedicationSchedules, pendingDoses, respondToDose, type MedicationSchedule, type PendingDose, type DoseResponse } from '@/lib/medications-api'
import { chatUnreadCount } from '@/lib/family-api'

function fmtTime(t: string): string {
  const [h, m] = (t || '').split(':').map(Number)
  if (Number.isNaN(h)) return t
  const am = h < 12; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${am ? 'am' : 'pm'}`
}
function isDue(d: PendingDose): boolean {
  const r = (d.response || '').toLowerCase(); const s = (d.status || '').toLowerCase()
  return !(r === 'yes' || r === 'no' || s === 'taken' || s === 'skipped' || s === 'missed' || s === 'confirmed')
}

export default function HomePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [ready, setReady] = useState(false)

  const [facts, setFacts] = useState<HealthFact[]>([])
  const [schedules, setSchedules] = useState<MedicationSchedule[]>([])
  const [doses, setDoses] = useState<PendingDose[]>([])
  const [visit, setVisit] = useState<Visit | null>(null)
  const [unread, setUnread] = useState(0)
  const [busyDose, setBusyDose] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('pal_token')
    const pid = localStorage.getItem('pal_patient_id')
    if (!token) { router.replace('/login'); return }
    if (!pid) { router.replace('/onboarding'); return }
    setName((localStorage.getItem('pal_full_name') || localStorage.getItem('pal_user_name') || '').split(' ')[0])
    setReady(true)
    void (async () => {
      const [f, sch, ds, v, u] = await Promise.all([
        getHealthFacts(pid).catch(() => [] as HealthFact[]),
        listMedicationSchedules(pid).catch(() => [] as MedicationSchedule[]),
        pendingDoses(pid).catch(() => [] as PendingDose[]),
        getPatientVisits(pid).catch(() => ({ upcoming: [] as Visit[], past: [] as Visit[] })),
        chatUnreadCount().catch(() => 0),
      ])
      setFacts(f); setSchedules(sch); setDoses(ds); setVisit(v.upcoming?.[0] || null); setUnread(u)
    })()
  }, [router])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const due = useMemo(() => doses.filter(isDue).sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''))[0] || null, [doses])
  const dueSched = useMemo(() => due ? schedules.find(s => s.id === due.schedule_id) : null, [due, schedules])
  const abnormal = useMemo(() => facts.map(readingFromFact).find(r => r.status === 'warn'), [facts])
  const readings = useMemo(() => {
    const pri = ['ldl', 'blood pressure', 'bp', 'systolic', 'hba1c']
    const score = (f: HealthFact) => { const h = `${f.key} ${f.type}`.toLowerCase(); const i = pri.findIndex(p => h.includes(p)); return i === -1 ? 99 : i }
    return facts.slice().sort((a, b) => score(a) - score(b)).slice(0, 2)
  }, [facts])

  function goAsk(text?: string) {
    const query = (text ?? q).trim()
    router.push(query ? `/ask?q=${encodeURIComponent(query)}` : '/ask')
  }
  async function respond(r: DoseResponse) {
    if (!due) return
    setBusyDose(true)
    try { await respondToDose(due.id, r); setDoses(prev => prev.filter(d => d.id !== due.id)) }
    catch { /* ignore */ }
    finally { setBusyDose(false) }
  }

  if (!ready) return <AppShell active="home" title="Home"><div className="page"><p className="muted">Loading…</p></div></AppShell>

  return (
    <AppShell active="home" title="Home" medsBadge={doses.filter(isDue).length}>
      <div className="page">
        <h1 className="h">{greeting}{name ? `, ${name}` : ''}.</h1>
        <p className="lede">{due ? 'One medicine is due now.' : 'Everything is up to date.'} Ask about your health, check your medicines and visits, and keep your records in one place.</p>

        <div className="askbox" role="search">
          <button className="attach" aria-label="Add a report" onClick={() => router.push('/upload')}><Icon name="cam" /></button>
          <input aria-label="Ask PAL" placeholder="Ask about your health, in any language" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') goAsk() }} />
          <button className="mic" aria-label="Ask" onClick={() => goAsk()}><Icon name="ask" /></button>
        </div>
        <div className="suggest">
          <button onClick={() => goAsk('Is my cholesterol okay?')}>Is my cholesterol okay?</button>
          <button onClick={() => goAsk('Do my medicines interact?')}>Do my medicines interact?</button>
          <button onClick={() => router.push('/visits')}>Book a follow-up</button>
        </div>

        <div className="homegrid">
          <div>
            <h2 className="s">Needs your attention</h2>
            {due ? (
              <article className="card due" aria-label="Medicine due now">
                <div className="head">
                  <div className="pillico"><Icon name="pill" /></div>
                  <div>
                    <div className="when">Due now, {fmtTime(due.scheduled_time)}</div>
                    <div className="what">{dueSched?.medicine_name || 'Medicine'}</div>
                    {dueSched?.dosage && <div className="dhow">{dueSched.dosage}</div>}
                  </div>
                </div>
                <div className="acts">
                  <button className="btn pri" disabled={busyDose} onClick={() => void respond('yes')}><Icon name="check" /> Yes, I took it</button>
                  <div className="two">
                    <button className="btn sec" disabled={busyDose} onClick={() => void respond('snooze_10')}><Icon name="clock" /> In 10 minutes</button>
                    <button className="btn sec" disabled={busyDose} onClick={() => void respond('no')}>Skip this dose</button>
                  </div>
                </div>
              </article>
            ) : (
              <article className="card"><p className="muted">No medicines due right now. You&apos;re all caught up.</p></article>
            )}

            {abnormal && (
              <div className="alertcard" style={{ marginTop: '.8em' }}>
                <Icon name="info" />
                <div><b>{abnormal.name} is {abnormal.statusLabel?.toLowerCase()}</b>
                  <span className="muted small"> {abnormal.value}{abnormal.unit ? ` ${abnormal.unit}` : ''}{abnormal.date ? ` on ${abnormal.date}` : ''}.</span>
                  <div style={{ marginTop: '.5em' }}><button className="btn ghost" style={{ padding: 0, minHeight: '2.4em' }} onClick={() => goAsk(`What does my ${abnormal.name} mean for me?`)}>What does this mean for me?</button></div>
                </div>
              </div>
            )}

            {readings.length > 0 && (<>
              <h2 className="s">Latest readings <button className="more" onClick={() => router.push('/records')}>See all</button></h2>
              <div className="card">{readings.map(f => <Reading key={f.id} {...readingFromFact(f)} />)}</div>
            </>)}
          </div>

          <div>
            {visit && (<>
              <h2 className="s">Next visit</h2>
              <article className="card hl visitcard">
                {(() => { const d = new Date(visit.date); const ok = !Number.isNaN(d.getTime()); return (
                  <div className="datebig">
                    <div className="cal"><small>{ok ? d.toLocaleDateString(undefined, { weekday: 'short' }) : ''}</small><b>{ok ? d.getDate() : '—'}</b><span>{ok ? d.toLocaleDateString(undefined, { month: 'long' }) : ''}</span></div>
                    <div><div className="t">{visit.reason || 'Appointment'}</div><div className="m">{[fmtTime(visit.time || ''), visit.clinic_name].filter(Boolean).join(', ') || 'Time to be confirmed'}</div></div>
                  </div>
                )})()}
                <div className="acts">
                  <button className="btn pri" onClick={() => router.push('/visits')}>View visit details</button>
                  <button className="btn sec" onClick={() => goAsk('I want to change or cancel my appointment')}><Icon name="phone" /> Call to change or cancel</button>
                </div>
              </article>
            </>)}

            <h2 className="s">Add a report</h2>
            <article className="card">
              <p className="muted">Photograph a prescription or lab report. PAL reads it and you check it before it&apos;s saved.</p>
              <div className="row" style={{ marginTop: '.8em' }}>
                <button className="btn pri" onClick={() => router.push('/upload')}><Icon name="cam" /> Take a photo</button>
                <button className="btn sec" onClick={() => router.push('/upload')}><Icon name="up" /> Choose a file</button>
              </div>
            </article>

            <h2 className="s">Family</h2>
            <article className="card">
              <div className="fam">
                <div className="stack"><span className="av p">P</span><span className="av m">M</span><span className="av r">R</span></div>
                <div style={{ flex: 1 }}><b>{unread > 0 ? `${unread} new message${unread > 1 ? 's' : ''}` : 'Your family care'}</b><div className="muted small">{unread > 0 ? 'in your family care room' : 'Groups, access and the care room'}</div></div>
                <button className="btn sec" onClick={() => router.push('/family')}>Open</button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
