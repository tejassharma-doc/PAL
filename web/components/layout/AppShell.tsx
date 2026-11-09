'use client'

/**
 * PAL redesign app shell — ported from pal-app.html `shell()`.
 * Left sidebar (desktop) + top bar + bottom nav (mobile). Nav items are real
 * Next.js routes. Wrap a redesigned screen:
 *   <AppShell active="ask" title="Ask PAL"><div className="page">…</div></AppShell>
 * `active` is optional — derived from the pathname when omitted.
 */
import React, { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { PalEmblem, PalRosette } from '../PalEmblem'
import { Icon, type IconName } from '../ui/Icon'
import { useNotificationBadge } from '../../lib/useNotificationBadge'
import { useUiPrefs } from '../../lib/useUiPrefs'

type NavId = 'home' | 'ask' | 'meds' | 'visits' | 'records' | 'family' | 'settings'
type NavItem = { id: NavId; label: string; icon: IconName; href: string; sideOnly?: boolean }

const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', href: '/' },
  { id: 'ask', label: 'Ask', icon: 'ask', href: '/ask' },
  { id: 'meds', label: 'Medicines', icon: 'pill', href: '/medications' },
  { id: 'visits', label: 'Visits', icon: 'cal', href: '/visits' },
  { id: 'records', label: 'Records', icon: 'rec', href: '/records' },
  { id: 'family', label: 'Family', icon: 'fam', href: '/family', sideOnly: true },
]

function deriveActive(pathname: string): NavId {
  if (pathname === '/' ) return 'home'
  if (pathname.startsWith('/ask') || pathname.startsWith('/history') || pathname.startsWith('/search')) return 'ask'
  if (pathname.startsWith('/medications') || pathname.startsWith('/reminders')) return 'meds'
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

  const [userName, setUserName] = useState('You')
  useEffect(() => {
    if (typeof window === 'undefined') return
    setUserName(localStorage.getItem('pal_full_name') || localStorage.getItem('pal_user_name') || 'You')
  }, [])
  const initial = (userName || 'Y').trim().charAt(0).toUpperCase()

  const go = (href: string) => router.push(href)

  return (
    <div className={`palui${hc ? ' hc' : ''}`}>
      <div className="app" style={{ ['--scale' as string]: scale } as React.CSSProperties}>
        <aside className="side" aria-label="Main">
          <button className="logo" onClick={() => go('/')} aria-label="PAL home">
            <span className="logo-full"><PalEmblem width="5.6em" color="var(--jade)" /></span>
            <span className="logo-ros"><PalRosette size={30} color="var(--jade)" /></span>
            <span>PAL<small>doctor-anchored care</small></span>
          </button>
          <button className="who" onClick={() => go('/profile')}>
            <span className="av a">{initial}</span>
            <span>{userName}<small>Viewing your record</small></span>
            <Icon name="down" />
          </button>
          {NAV.map(n => (
            <button key={n.id} className="navi" aria-current={cur === n.id ? 'page' : undefined} onClick={() => go(n.href)}>
              <Icon name={n.icon} /><span>{n.label}</span>
              {n.id === 'meds' && medsBadge ? <span className="badge">{medsBadge}</span> : null}
            </button>
          ))}
          <div className="spacer" />
          <button className="navi" aria-current={cur === 'settings' ? 'page' : undefined} onClick={() => go('/settings')}>
            <Icon name="set" /><span>Settings</span>
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
          {title ? <div className="ptitle">{title}</div> : null}
          <div className="tools">
            <button className="tbtn size" aria-label="Text size" onClick={cycleScale}>
              <span style={{ fontSize: '1.1em' }}>Aa</span>
            </button>
            <button className="tbtn gear" aria-label="Settings" onClick={() => go('/settings')}>
              <Icon name="set" />
            </button>
            <button className="tbtn" aria-label={`Notifications${bell ? `, ${bell} new` : ''}`} onClick={() => go('/notifications')}>
              <Icon name="bell" />
              {bell ? <span className="dot">{bell}</span> : null}
            </button>
          </div>
        </header>

        <main className="main">{children}</main>

        <nav className="bottom" aria-label="Main">
          {NAV.filter(n => !n.sideOnly).map(n => (
            <button key={n.id} aria-current={cur === n.id ? 'page' : undefined} onClick={() => go(n.href)}>
              <span className="pill"><Icon name={n.icon} /></span>{n.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

export default AppShell
