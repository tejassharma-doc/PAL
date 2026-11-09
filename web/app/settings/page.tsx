'use client'

/**
 * Settings — redesigned onto AppShell (pal-app.html `S.settings`).
 * Membership (subscription-api), reading prefs (useUiPrefs: text size / high
 * contrast / read-aloud), language (updateProfile), privacy toggles
 * (localStorage), and account (sign out). Data wired to real clients.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import { useUiPrefs, TEXT_SCALES } from '@/lib/useUiPrefs'
import { SUPPORTED_LANGUAGES } from '@/lib/languages'
import { useTranslation } from '@/lib/useTranslation'
import { updateProfile, clearAuth } from '@/lib/api-auth'
import { markSignedOut } from '@/lib/sessionCookie'
import { getSubscriptionStatus, subscriptionAction, type SubscriptionStatus } from '@/lib/subscription-api'

const SIZE_LABELS = ['Standard', 'Large', 'Largest']

export default function SettingsPage() {
  const router = useRouter()
  const { lang } = useTranslation()
  const { scale, setScale, hc, setHc, readAloud, setReadAloud } = useUiPrefs()
  const [sub, setSub] = useState<SubscriptionStatus | null>(null)
  const [subBusy, setSubBusy] = useState(false)
  const [showAllLangs, setShowAllLangs] = useState(false)
  const [signOut, setSignOut] = useState(false)
  const [phone, setPhone] = useState('')
  const [consentAlways, setConsentAlways] = useState(false)
  const [analytics, setAnalytics] = useState(true)
  const [curLang, setCurLang] = useState('en')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    setPhone(localStorage.getItem('pal_phone') || '')
    setConsentAlways(localStorage.getItem('pal_consent_always') === '1')
    setAnalytics(localStorage.getItem('pal_usage_analytics') !== '0')
    setCurLang(localStorage.getItem('pal_preferred_lang') || lang || 'en')
    void getSubscriptionStatus().then(setSub)
  }, [router, lang])

  async function act(a: 'pause' | 'resume' | 'cancel') {
    setSubBusy(true)
    try { setSub(await subscriptionAction(a)) }
    catch { /* keep prior */ }
    finally { setSubBusy(false) }
  }

  function chooseLang(code: string) {
    setCurLang(code)
    localStorage.setItem('pal_preferred_lang', code)
    window.dispatchEvent(new Event('storage'))
    void updateProfile({ preferred_language: code }).catch(() => {})
  }
  function togglePref(key: string, cur: boolean, set: (v: boolean) => void) {
    const v = !cur; set(v); localStorage.setItem(key, v ? '1' : '0')
  }
  function doSignOut() {
    clearAuth(); markSignedOut(); window.location.replace('/')
  }

  const langs = showAllLangs ? SUPPORTED_LANGUAGES : SUPPORTED_LANGUAGES.slice(0, 8)

  const subState = !sub || !sub.status ? (sub?.active ? 'active' : 'none')
    : sub.status === 'paused' ? 'paused' : sub.status === 'cancelled' ? 'cancelled' : (sub.active ? 'active' : 'none')

  return (
    <AppShell active="settings" title="Settings">
      <div className="page narrow">
        <h1 className="h">Settings</h1>

        <h2 className="s">Membership</h2>
        <div className="card hl subcard">
          {subState === 'none' ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: '1.1em' }}>No active plan</b></div>
              <div className="muted">Choose a plan to unlock PAL for you or your family.</div>
              <div className="row" style={{ marginTop: '.6em' }}><button className="btn pri" onClick={() => router.push('/pricing')}>Choose a plan</button></div>
            </>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b style={{ fontSize: '1.1em' }}>{sub?.plan === 'family' ? 'Family plan' : sub?.plan === 'individual' ? 'Individual plan' : 'PAL membership'}</b>
                {subState === 'active' && <span className="tag ok"><Icon name="check" /> Active</span>}
                {subState === 'paused' && <span className="tag warn">Paused</span>}
                {subState === 'cancelled' && <span className="tag bad">Cancelled</span>}
              </div>
              {sub?.amount_display && <div className="muted">{sub.amount_display}{sub.renews_at ? `. Renews on ${new Date(sub.renews_at).toLocaleDateString()}` : ''}</div>}
              <div className="row" style={{ marginTop: '.6em' }}>
                {subState === 'active' && <>
                  <button className="btn sec" disabled={subBusy} onClick={() => void act('pause')}><Icon name="pause" /> Pause membership</button>
                  <button className="btn ghost" style={{ color: 'var(--rose-deep)' }} disabled={subBusy} onClick={() => void act('cancel')}>Cancel membership</button>
                </>}
                {subState === 'paused' && <button className="btn pri" disabled={subBusy} onClick={() => void act('resume')}>Resume membership</button>}
                {subState === 'cancelled' && <button className="btn pri" onClick={() => router.push('/pricing')}>Renew membership</button>}
              </div>
            </>
          )}
        </div>

        <h2 className="s">Reading</h2>
        <div className="set">
          <div className="it" style={{ display: 'block' }}>
            <div className="tx"><b>Text size</b><span>Makes every screen larger or smaller</span></div>
            <div className="sizes" role="group" aria-label="Text size">
              {TEXT_SCALES.map((s, i) => (
                <button key={s} aria-pressed={Math.abs(scale - s) < 0.001} onClick={() => setScale(s)}>
                  <span style={{ fontSize: `${17 * s}px` }}>Aa</span><small>{SIZE_LABELS[i]}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="it"><div className="tx"><b>High contrast</b><span>Stronger colours and borders</span></div>
            <button className="sw2" role="switch" aria-checked={hc} aria-label="High contrast" onClick={() => setHc(!hc)} /></div>
          <div className="it"><div className="tx"><b>Read answers aloud</b><span>PAL speaks each answer automatically</span></div>
            <button className="sw2" role="switch" aria-checked={readAloud} aria-label="Read answers aloud" onClick={() => setReadAloud(!readAloud)} /></div>
        </div>

        <h2 className="s">Language</h2>
        <div className="langs" role="group" aria-label="Language">
          {langs.map(l => (
            <button key={l.code} aria-pressed={curLang === l.code} onClick={() => chooseLang(l.code)}>
              {l.native}<small>{l.name}</small>
            </button>
          ))}
        </div>
        {!showAllLangs && <button className="btn ghost" style={{ padding: 0 }} onClick={() => setShowAllLangs(true)}>Show all {SUPPORTED_LANGUAGES.length} languages</button>}

        <h2 className="s">Privacy</h2>
        <div className="set">
          <div className="it"><div className="tx"><b>Use my record without asking</b><span>Skip the permission question in Ask</span></div>
            <button className="sw2" role="switch" aria-checked={consentAlways} aria-label="Use my record without asking" onClick={() => togglePref('pal_consent_always', consentAlways, setConsentAlways)} /></div>
          <div className="it"><div className="tx"><b>Who can see my record</b><span>Manage family access and consents</span></div>
            <button className="iconbtn" aria-label="Manage access" onClick={() => router.push('/family')}><Icon name="right" /></button></div>
          <div className="it"><div className="tx"><b>Help improve PAL</b><span>Share anonymous usage data</span></div>
            <button className="sw2" role="switch" aria-checked={analytics} aria-label="Share usage data" onClick={() => togglePref('pal_usage_analytics', analytics, setAnalytics)} /></div>
          <div className="it"><div className="tx"><b>Download my data</b><span>A copy of everything PAL holds — coming soon</span></div>
            <button className="iconbtn" aria-label="Download my data" disabled style={{ opacity: .5 }}><Icon name="dl" /></button></div>
        </div>

        <h2 className="s">Account</h2>
        <div className="set">
          <div className="it"><div className="tx"><b>Profile and emergency contact</b><span>Name, photo, blood group, ABHA ID</span></div>
            <button className="iconbtn" aria-label="Open profile" onClick={() => router.push('/profile')}><Icon name="right" /></button></div>
          {phone && <div className="it"><div className="tx"><b>Mobile number</b><span>{phone}</span></div></div>}
          <div className="it"><button className="btn sec" style={{ color: 'var(--rose-deep)' }} onClick={() => setSignOut(true)}>Sign out</button></div>
        </div>
      </div>

      <div className={`overlay${signOut ? ' on' : ''}`} role="dialog" aria-modal="true" aria-label="Sign out" onClick={e => { if (e.target === e.currentTarget) setSignOut(false) }}>
        <div className="sheet">
          <h3>Sign out of PAL?</h3>
          <p className="muted" style={{ marginTop: '.3em' }}>You can sign back in any time with your mobile number.</p>
          <div className="stack2">
            <button className="btn danger" onClick={doSignOut}>Sign out</button>
            <button className="btn sec" onClick={() => setSignOut(false)}>Stay signed in</button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
