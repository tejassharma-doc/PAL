'use client'

/**
 * / — redesigned Home (new shell). Greets the user, hands the ask box off to the
 * streaming /ask screen, and routes into Medicines / Visits / Records / Family.
 * (Live widgets — due doses, latest readings, next visit — are wired in the next pass.)
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '../components/pal/AppShell'
import { Icon } from '../components/pal/Icon'

export default function HomePage() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('pal_token')
    if (!token) { router.replace('/login'); return }
    if (!localStorage.getItem('pal_patient_id')) { router.replace('/onboarding'); return }
    setName((localStorage.getItem('pal_full_name') || localStorage.getItem('pal_user_name') || '').split(' ')[0])
  }, [router])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  function goAsk(text?: string) {
    const query = (text ?? q).trim()
    if (query) sessionStorage.setItem('pal_pending_q', query)
    router.push('/ask')
  }

  return (
    <AppShell active="home" title="Home">
      <div className="page">
        <h1 className="h">{greeting}{name ? `, ${name}` : ''}.</h1>
        <p className="lede">Ask about your health, check your medicines and visits, and keep your records in one place.</p>

        <div className="askbox" role="search">
          <button className="attach" aria-label="Add a report" onClick={() => router.push('/upload')}><Icon name="cam" /></button>
          <input aria-label="Ask PAL" placeholder="Ask about your health, in any language"
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') goAsk() }} />
          <button className="mic" aria-label="Ask" onClick={() => goAsk()}><Icon name="ask" /></button>
        </div>
        <div className="suggest">
          <button onClick={() => goAsk('Is my cholesterol okay?')}>Is my cholesterol okay?</button>
          <button onClick={() => goAsk('Do my medicines interact?')}>Do my medicines interact?</button>
          <button onClick={() => router.push('/visits')}>Book a follow-up</button>
        </div>

        <div className="homegrid">
          <div>
            <h2 className="s">Quick access</h2>
            <div className="list">
              <button className="li" onClick={() => router.push('/medications')}>
                <span className="ic rx"><Icon name="pill" /></span>
                <span className="tx"><b>Medicines</b><span>Today’s doses and reminders</span></span>
                <Icon name="right" className="ico chev" />
              </button>
              <button className="li" onClick={() => router.push('/visits')}>
                <span className="ic"><Icon name="cal" /></span>
                <span className="tx"><b>Visits</b><span>Appointments and care plans</span></span>
                <Icon name="right" className="ico chev" />
              </button>
              <button className="li" onClick={() => router.push('/records')}>
                <span className="ic lab"><Icon name="rec" /></span>
                <span className="tx"><b>Health records</b><span>Reports and prescriptions</span></span>
                <Icon name="right" className="ico chev" />
              </button>
            </div>
          </div>

          <div>
            <h2 className="s">Add a report</h2>
            <article className="card">
              <p className="muted">Photograph a prescription or lab report. PAL reads it and you check it before it’s saved.</p>
              <div className="row" style={{ marginTop: '.8em' }}>
                <button className="btn pri" onClick={() => router.push('/upload')}><Icon name="cam" /> Take a photo</button>
                <button className="btn sec" onClick={() => router.push('/upload')}><Icon name="up" /> Choose a file</button>
              </div>
            </article>

            <h2 className="s">Family</h2>
            <article className="card">
              <div className="fam">
                <div className="stack"><span className="av p">P</span><span className="av m">M</span><span className="av r">R</span></div>
                <div style={{ flex: 1 }}><b>Your family care</b><div className="muted small">Groups, access and the care room</div></div>
                <button className="btn sec" onClick={() => router.push('/family')}>Open</button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
