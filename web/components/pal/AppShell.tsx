'use client'

/**
 * PAL redesign app shell — sidebar (desktop) + top bar + bottom nav (mobile),
 * from the pal-app.html prototype. Wrap a redesigned screen:
 *   <AppShell active="ask" title="Ask PAL"><div className="page">…</div></AppShell>
 * Nav links route to the real section URLs; not-yet-redesigned sections still work
 * (they render the legacy app on their routes).
 */
import React from 'react'
import { useRouter } from 'next/navigation'
import { PalRosette } from '../PalEmblem'
import { Icon } from './Icon'

type NavItem = { id: string; label: string; icon: string; href: string; badge?: string; sideOnly?: boolean }

const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', href: '/' },
  { id: 'ask', label: 'Ask', icon: 'ask', href: '/ask' },
  { id: 'meds', label: 'Medicines', icon: 'pill', href: '/medications' },
  { id: 'visits', label: 'Visits', icon: 'cal', href: '/visits' },
  { id: 'records', label: 'Records', icon: 'rec', href: '/records' },
  { id: 'family', label: 'Family', icon: 'fam', href: '/family', sideOnly: true },
]

export function AppShell({
  active,
  title,
  children,
}: {
  active: string
  title?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const go = (href: string) => router.push(href)

  const userName = typeof window !== 'undefined'
    ? (localStorage.getItem('pal_full_name') || localStorage.getItem('pal_user_name') || 'You')
    : 'You'
  const initial = (userName || 'Y').trim().charAt(0).toUpperCase()

  return (
    <div className="pal">
      <aside className="side" aria-label="Main">
        <button className="logo" onClick={() => go('/')} aria-label="PAL home">
          <PalRosette size={34} color="var(--jade)" />
          <span>PAL<small>doctor-anchored care</small></span>
        </button>
        <button className="who" onClick={() => go('/profile')}>
          <span className="av a">{initial}</span>
          <span>{userName}<small>Viewing your record</small></span>
          <Icon name="down" />
        </button>
        {NAV.map(n => (
          <button key={n.id} className="navi" aria-current={active === n.id ? 'page' : undefined} onClick={() => go(n.href)}>
            <Icon name={n.icon} /><span>{n.label}</span>{n.badge ? <span className="badge">{n.badge}</span> : null}
          </button>
        ))}
        <div className="spacer" />
        <button className="navi" aria-current={active === 'settings' ? 'page' : undefined} onClick={() => go('/profile')}>
          <Icon name="set" /><span>Settings</span>
        </button>
        <p className="help">PAL gives health information, not a diagnosis. In an emergency call 112.</p>
      </aside>

      <header className="top">
        <button className="logo" onClick={() => go('/')} aria-label="PAL home"
          style={{ display: 'grid', placeItems: 'center', padding: 0, width: '3em' }}>
          <PalRosette size={30} color="var(--jade-deep)" />
        </button>
        <button className="who-m" onClick={() => go('/profile')} aria-label="Your record and settings">
          <span className="av a">{initial}</span>
          <span><b>{userName}</b><small>Your record ▾</small></span>
        </button>
        {title ? <div className="ptitle">{title}</div> : null}
        <div className="tools">
          <button className="tbtn" aria-label="Notifications" onClick={() => go('/notifications')}>
            <Icon name="bell" />
          </button>
        </div>
      </header>

      <main className="main">{children}</main>

      <nav className="bottom" aria-label="Main">
        {NAV.filter(n => !n.sideOnly).map(n => (
          <button key={n.id} aria-current={active === n.id ? 'page' : undefined} onClick={() => go(n.href)}>
            <span className="pill"><Icon name={n.icon} /></span>{n.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
