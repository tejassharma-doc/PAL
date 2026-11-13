'use client'

/**
 * Visits — redesigned onto AppShell (pal-app.html `S.visits`).
 * Upcoming + past visits with a detail panel. The doctor's SOAP note is shown
 * only inside the gated "clinical notes" disclosure; patients see the plain-
 * language summary + plan + prescription by default. Data: getPatientVisits.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import VoiceCall from '@/components/VoiceCall'
import { getPatientVisits, type Visit } from '@/lib/api-auth'

function cal(dateStr: string) {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return { dow: '', day: dateStr, mon: '' }
  return {
    dow: d.toLocaleDateString(undefined, { weekday: 'short' }),
    day: String(d.getDate()),
    mon: d.toLocaleDateString(undefined, { month: 'long' }),
  }
}
/** Format the backend's "HH:MM" slot time as "9:00 am". */
function fmtClock(t?: string): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h)) return t
  const am = h < 12; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${am ? 'am' : 'pm'}`
}
const isRx = (name: string) => name.toLowerCase().startsWith('prescription')

export default function VisitsPage() {
  const router = useRouter()
  const [patientId, setPatientId] = useState<string | null>(null)
  const [upcoming, setUpcoming] = useState<Visit[]>([])
  const [past, setPast] = useState<Visit[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [calling, setCalling] = useState(false)

  function openPrevisit(v: Visit) {
    if (v.previsit_url) window.open(v.previsit_url, '_blank', 'noopener')
    else router.push(`/ask?q=${encodeURIComponent('Help me prepare for my upcoming visit')}`)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    setPatientId(localStorage.getItem('pal_patient_id'))
  }, [router])

  useEffect(() => {
    if (!patientId) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const data = await getPatientVisits(patientId)
        if (cancelled) return
        setUpcoming(data.upcoming || [])
        setPast(data.past || [])
        setSelId((data.upcoming || [])[0]?.id || (data.past || [])[0]?.id || null)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load visits')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [patientId])

  const all = useMemo(() => [...upcoming, ...past], [upcoming, past])
  const sel = useMemo(() => all.find(v => v.id === selId) || null, [all, selId])

  return (
    <AppShell active="visits" title="Visits">
      <div className="page">
        <h1 className="h">Your visits</h1>
        <p className="lede">Appointments, care plans and prescriptions from your doctors.</p>

        {error && <div className="alertcard" style={{ marginTop: '1em' }}><Icon name="alert" /><div><b>Couldn&apos;t load visits</b><span className="muted small">{error}</span></div></div>}

        <div className="vgrid" style={{ marginTop: '1.4em' }}>
          <div>
            {upcoming.length > 0 && <h2 className="s" style={{ marginTop: 0 }}>Coming up{upcoming.length > 1 ? ` · ${upcoming.length}` : ''}</h2>}
            {upcoming.map((v, i) => { const c = cal(v.date); return (
              <article key={v.id} className={`card ${v.id === selId ? 'hl' : ''} visitcard`} style={{ cursor: 'pointer', marginBottom: '.8em' }} onClick={() => setSelId(v.id)}>
                {i === 0 && <div className="k">Next appointment</div>}
                <div className="datebig" style={{ marginTop: i === 0 ? '.5em' : 0 }}>
                  <div className="cal"><small>{c.dow}</small><b>{c.day}</b><span>{c.mon}</span></div>
                  <div><div className="t">{v.reason || 'Appointment'}</div><div className="m">{[fmtClock(v.time), v.clinic_name].filter(Boolean).join(', ') || 'Time to be confirmed'}</div></div>
                </div>
                <div className="acts">
                  <button className="btn pri" onClick={(e) => { e.stopPropagation(); openPrevisit(v) }}>Answer pre-visit questions</button>
                  <button className="btn sec" onClick={(e) => { e.stopPropagation(); setCalling(true) }}><Icon name="phone" /> Call to book, change or cancel</button>
                </div>
              </article>
            )})}

            {!loading && upcoming.length === 0 && (
              <article className="card"><p className="muted">No upcoming visits.</p><div className="row" style={{ marginTop: '.8em' }}><button className="btn pri" onClick={() => setCalling(true)}><Icon name="phone" /> Call to book an appointment</button></div></article>
            )}

            <h2 className="s">Past visits{past.length > 1 ? ` · ${past.length}` : ''}</h2>
            {loading ? <div className="muted">Loading…</div> : past.length === 0 ? (
              <article className="card"><p className="muted">No past visits yet.</p></article>
            ) : (
              <div className="list">
                {past.map(v => {
                  const c = cal(v.date)
                  return (
                    <button key={v.id} className="li" aria-current={v.id === selId ? 'true' : undefined}
                      style={v.id === selId ? { background: 'var(--jade-tint)' } : undefined}
                      onClick={() => setSelId(v.id)}>
                      <span className="ic"><Icon name="cal" /></span>
                      <span className="tx"><b>{v.reason || 'Visit'}</b><span>{[fmtClock(v.time), v.clinic_name].filter(Boolean).join(', ')}</span></span>
                      <span className="right">{c.day} {c.mon.slice(0, 3)}</span>
                      <Icon name="right" className="ico chev" />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {sel && (() => { const c = cal(sel.date); const rx = sel.lab_tests.filter(t => isRx(t.test_name)); const tests = sel.lab_tests.filter(t => !isRx(t.test_name)); return (
            <article className="card detail">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="tag info">{c.day} {c.mon}</span>
              </div>
              <h3 style={{ marginTop: '.4em' }}>{sel.reason || 'Visit'}</h3>
              {sel.patient_summary && (<>
                <h2 className="s" style={{ marginTop: '1.2em' }}>What the doctor said</h2>
                <div className="plantext">{sel.patient_summary}</div>
                <div className="canon"><Icon name="shield" /><span>These are your care team&apos;s own words. PAL never changes them.</span></div>
              </>)}
              {sel.management_plan && (<>
                <h2 className="s">Care plan</h2>
                <div className="plantext">{sel.management_plan}</div>
              </>)}
              {sel.soap_note && (
                <details className="soap">
                  <summary>Doctor&apos;s clinical notes <Icon name="down" /></summary>
                  <div><p style={{ whiteSpace: 'pre-wrap' }}>{sel.soap_note}</p></div>
                </details>
              )}
              {rx.length > 0 && (<>
                <h2 className="s">Prescription</h2>
                <div className="rx">
                  {rx.map(t => (
                    <div className="rxi" key={t.id}><b>{t.test_name.replace(/^prescription[:\s-]*/i, '')}</b>{t.interpretation && <div className="muted small" style={{ marginTop: 4 }}>{t.interpretation}</div>}</div>
                  ))}
                </div>
              </>)}
              {tests.length > 0 && (<>
                <h2 className="s">Tests ordered</h2>
                <div className="list">
                  {tests.map(t => (
                    <div className="li" key={t.id}><span className="ic lab"><Icon name="rec" /></span><span className="tx"><b>{t.test_name}</b>{t.interpretation && <span>{t.interpretation}</span>}</span>{t.abnormal_flag && <span className="tag warn">Check</span>}</div>
                  ))}
                </div>
              </>)}
              <div className="row" style={{ marginTop: '1em' }}>
                <button className="btn sec" onClick={() => router.push('/medications')}><Icon name="bell" /> Reminders</button>
                <button className="btn sec" onClick={() => router.push(`/ask?q=${encodeURIComponent(`Tell me about my visit on ${c.day} ${c.mon}`)}`)}>Ask about this visit</button>
              </div>
            </article>
          )})()}
        </div>
      </div>
      {calling && patientId && <VoiceCall patientId={patientId} onClose={() => setCalling(false)} />}
    </AppShell>
  )
}
