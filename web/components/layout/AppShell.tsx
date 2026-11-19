'use client'

/**
 * PAL redesign app shell — ported from pal-app.html `shell()`.
 * Left sidebar (desktop) + top bar + bottom nav (mobile). Nav items are real
 * Next.js routes. Wrap a redesigned screen:
 *   <AppShell active="ask" title="Ask PAL"><div className="page">…</div></AppShell>
 * `active` is optional — derived from the pathname when omitted.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { PalEmblem, PalRosette } from '../PalEmblem'
import { Icon, type IconName } from '../ui/Icon'
import { useNotificationBadge } from '../../lib/useNotificationBadge'
import { useUiPrefs } from '../../lib/useUiPrefs'
import { useUiT } from '../../lib/ui-i18n'
import { getSubscriptionStatus } from '../../lib/subscription-api'
import { getUserProfile } from '../../lib/api-auth'
import { pendingDoses, listMedicationSchedules, respondToDose, type DoseResponse } from '../../lib/medications-api'

type DueDose = { id: string; medicine: string; dosage: string | null; time: string }

function fmtDoseTime(t: string): string {
  const [h, m] = (t || '').split(':').map(Number)
  if (Number.isNaN(h)) return t
  const am = h < 12
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${am ? 'am' : 'pm'}`
}

type NavId = 'home' | 'ask' | 'meds' | 'nutrition' | 'visits' | 'records' | 'family' | 'settings'
type NavItem = { id: NavId; label: string; icon: IconName; href: string; sideOnly?: boolean }

const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', href: '/' },
  { id: 'ask', label: 'Ask', icon: 'ask', href: '/ask' },
  { id: 'meds', label: 'Medicines', icon: 'pill', href: '/medications' },
  { id: 'nutrition', label: 'Nutrition', icon: 'leaf', href: '/nutrition' },
  { id: 'visits', label: 'Visits', icon: 'cal', href: '/visits' },
  { id: 'records', label: 'Records', icon: 'rec', href: '/records' },
  { id: 'family', label: 'Family', icon: 'fam', href: '/family', sideOnly: true },
]

function deriveActive(pathname: string): NavId {
  if (pathname === '/' ) return 'home'
  if (pathname.startsWith('/ask') || pathname.startsWith('/history') || pathname.startsWith('/search')) return 'ask'
  if (pathname.startsWith('/medications') || pathname.startsWith('/reminders')) return 'meds'
  if (pathname.startsWith('/nutrition')) return 'nutrition'
  if (pathname.startsWith('/visits')) return 'visits'
  if (pathname.startsWith('/records') || pathname.startsWith('/upload') || pathname.startsWith('/lab-reports')) return 'records'
  if (pathname.startsWith('/family')) return 'family'
  if (pathname.startsWith('/settings') || pathname.startsWith('/profile')) return 'settings'
  return 'home'
}

export function AppShell({
  active,
  title,
  medsBadge,
  children,
}: {
  active?: NavId
  title?: string
  medsBadge?: number
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname() || '/'
  const cur = active ?? deriveActive(pathname)
  const bell = useNotificationBadge()
  const { scale, cycleScale, hc } = useUiPrefs()
  const { t } = useUiT()

  const [userName, setUserName] = useState('You')
  // Family section is only for the Family plan. Start from the cached plan to
  // avoid a flash, then confirm with the server.
  const [familyAllowed, setFamilyAllowed] = useState(
    typeof window !== 'undefined' && localStorage.getItem('pal_plan') === 'family',
  )

  // Medicine reminders the bell pops up: doses awaiting your answer, joined with
  // the schedule so we can show the medicine name + dose in the pop-up.
  const [due, setDue] = useState<DueDose[]>([])
  const [dueOpen, setDueOpen] = useState(false)
  const [dueBusy, setDueBusy] = useState<string | null>(null)

  const loadDue = useCallback(async (): Promise<number> => {
    const pid = typeof window === 'undefined' ? null : localStorage.getItem('pal_patient_id')
    if (!pid) { setDue([]); return 0 }
    try {
      const [doses, schedules] = await Promise.all([pendingDoses(pid), listMedicationSchedules(pid)])
      const byId = new Map(schedules.map(s => [s.id, s]))
      const awaiting = doses
        .filter(d => d.status === 'awaiting_ack')
        .map(d => {
          const s = byId.get(d.schedule_id)
          return { id: d.id, medicine: s?.medicine_name || 'Your medicine', dosage: s?.dosage || null, time: d.scheduled_time }
        })
      setDue(awaiting)
      return awaiting.length
    } catch {
      // Medication reminders may be disabled on the backend — fall back silently.
      setDue([])
      return 0
    }
  }, [])

  async function respondDue(id: string, value: DoseResponse) {
    setDueBusy(id)
    try {
      await respondToDose(id, value)
      const rest = due.filter(d => d.id !== id)
      setDue(rest)
      if (rest.length === 0) setDueOpen(false)
    } catch { /* leave the card up so they can retry */ }
    finally { setDueBusy(null) }
  }

  function onBellClick() {
    // If we already know a dose is due, pop it up immediately; otherwise check,
    // then either pop up or fall back to the full notifications page.
    if (due.length > 0) { setDueOpen(true); void loadDue(); return }
    void loadDue().then(n => { if (n > 0) setDueOpen(true); else go('/notifications') })
  }
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Cached name first (avoids a flash), but it can be stale — phone login never
    // sets a name — so confirm with the real patient record and refresh the cache.
    setUserName(localStorage.getItem('pal_full_name') || localStorage.getItem('pal_user_name') || 'You')
    void getUserProfile().then(p => {
      const real = p.patient?.full_name
      if (real) {
        localStorage.setItem('pal_full_name', real)
        localStorage.setItem('pal_user_name', real)
        setUserName(real)
      }
    }).catch(() => {})
    void getSubscriptionStatus().then(s => {
      const plan = String(s.plan || '')
      localStorage.setItem('pal_plan', plan)
      setFamilyAllowed(plan === 'family')
    }).catch(() => {})
    void loadDue()
  }, [loadDue])
  const initial = (userName || 'Y').trim().charAt(0).toUpperCase()

  const sideNav = NAV.filter(n => n.id !== 'family' || familyAllowed)
  const go = (href: string) => router.push(href)

  return (
    <div className={`palui${hc ? ' hc' : ''}`}>
      <div className="app" style={{ ['--scale' as string]: scale } as React.CSSProperties}>
        <aside className="side" aria-label="Main">
          <button className="logo" onClick={() => go('/')} aria-label="PAL home">
            <span className="logo-full"><PalEmblem width="5.6em" color="var(--jade)" /></span>
            <span className="logo-ros"><PalRosette size={30} color="var(--jade)" /></span>
            <span>PAL<small>{t('doctor-anchored care')}</small></span>
          </button>
          <button className="who" onClick={() => go('/profile')}>
            <span className="av a">{initial}</span>
            <span>{userName}<small>{t('Viewing your record')}</small></span>
            <Icon name="down" />
          </button>
          {sideNav.map(n => (
            <button key={n.id} className="navi" aria-current={cur === n.id ? 'page' : undefined} onClick={() => go(n.href)}>
              <Icon name={n.icon} /><span>{t(n.label)}</span>
              {n.id === 'meds' && medsBadge ? <span className="badge">{medsBadge}</span> : null}
            </button>
          ))}
          <div className="spacer" />
          <button className="navi" aria-current={cur === 'settings' ? 'page' : undefined} onClick={() => go('/settings')}>
            <Icon name="set" /><span>{t('Settings')}</span>
          </button>
          <p className="help">PAL gives health information, not a diagnosis. In an emergency call 112.</p>
        </aside>

        <header className="top">
          <button className="toplogo" onClick={() => go('/')} aria-label="PAL home">
            <PalRosette size={30} color="var(--jade-deep)" />
          </button>
          <button className="who-m" onClick={() => go('/profile')} aria-label="Your record and settings">
            <span className="av a">{initial}</span>
            <span><b>{userName}</b><small>Your record ▾</small></span>
          </button>
          {title ? <div className="ptitle">{t(title)}</div> : null}
          <div className="tools">
            <button className="tbtn size" aria-label="Text size" onClick={cycleScale}>
              <span style={{ fontSize: '1.1em' }}>Aa</span>
            </button>
            <button className="tbtn gear" aria-label="Settings" onClick={() => go('/settings')}>
              <Icon name="set" />
            </button>
            <button className="tbtn" aria-label={`Notifications${bell + due.length ? `, ${bell + due.length} new` : ''}`} onClick={onBellClick}>
              <Icon name="bell" />
              {bell + due.length ? <span className="dot">{bell + due.length}</span> : null}
            </button>
          </div>
        </header>

        <main className="main">{children}</main>

        <nav className="bottom" aria-label="Main">
          {NAV.filter(n => !n.sideOnly).map(n => (
            <button key={n.id} aria-current={cur === n.id ? 'page' : undefined} onClick={() => go(n.href)}>
              <span className="pill"><Icon name={n.icon} /></span>{t(n.label)}
            </button>
          ))}
        </nav>
      </div>

      {/* Medicine reminder pop-up — opened from the bell when a dose is due. */}
      {dueOpen && (
        <div className="overlay on" onClick={e => { if (e.target === e.currentTarget) setDueOpen(false) }}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Medicine reminder">
            <h3>{t('Time for your medicine')}</h3>
            <p className="muted small" style={{ margin: '.3em 0 0' }}>
              {due.length > 1 ? `You have ${due.length} medicines to take.` : 'Let PAL know if you took it.'}
            </p>
            {due.map(d => (
              <article className="card due" key={d.id} style={{ marginTop: '.9em' }}>
                <div className="head">
                  <div className="pillico"><Icon name="pill" /></div>
                  <div>
                    <div className="when">{t('Due now')}{d.time ? `, ${fmtDoseTime(d.time)}` : ''}</div>
                    <div className="what">{d.medicine}</div>
                    {d.dosage ? <div className="dhow">{d.dosage}</div> : null}
                  </div>
                </div>
                <div className="acts">
                  <button className="btn pri" disabled={dueBusy === d.id} onClick={() => void respondDue(d.id, 'yes')}>
                    <Icon name="check" /> {t('Yes, I took it')}
                  </button>
                  <div className="two">
                    <button className="btn sec" disabled={dueBusy === d.id} onClick={() => void respondDue(d.id, 'snooze_10')}>
                      <Icon name="clock" /> {t('In 10 minutes')}
                    </button>
                    <button className="btn sec" disabled={dueBusy === d.id} onClick={() => void respondDue(d.id, 'no')}>
                      {t('Skip this dose')}
                    </button>
                  </div>
                </div>
              </article>
            ))}
            <div className="stack2" style={{ marginTop: '1em' }}>
              <button className="btn ghost" onClick={() => { setDueOpen(false); go('/medications') }}>{t('Manage medicines')}</button>
              <button className="btn sec" onClick={() => setDueOpen(false)}>{t('Close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AppShell
