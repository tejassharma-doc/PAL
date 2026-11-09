'use client'

/**
 * Pricing — redesigned onto the pal-app.html `S.pricing` screen.
 * Chooses a plan → createSubscription → Razorpay Checkout → poll status → app.
 * Served at /pricing by the React route (the static-html rewrite was removed so
 * this authenticated, Razorpay-wired page is reachable). COOP/COEP stays
 * excluded for /pricing in next.config.js so Razorpay's iframe can load.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PalRosette } from '../../components/PalEmblem'
import { Icon } from '../../components/ui/Icon'
import { getSubscriptionStatus, createSubscription } from '../../lib/subscription-api'

type Tier = 'individual' | 'family'

function token(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('pal_token')
}
function loadRazorpay(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window === 'undefined') return resolve(false)
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve(true)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true); s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

const INDIVIDUAL = ['Ask PAL anything, by voice or text, in your language', 'All your records in one place', 'Upload reports, visits and medicine reminders', 'Your record opens only with your consent']
const FAMILY = ['Everything in Individual, for each person', 'One family group with a shared care room', 'Look after a parent or child’s health', 'Pay for each other’s visits']

export default function PricingPage() {
  const router = useRouter()
  const [busy, setBusy] = useState<Tier | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token()) { router.push('/login'); return }
    ;(async () => {
      const s = await getSubscriptionStatus()
      if (s.active) { router.push('/'); return }
      setChecking(false)
    })()
  }, [router])

  const pollActive = useCallback(async () => {
    for (let i = 0; i < 20; i++) {
      const s = await getSubscriptionStatus()
      if (s.active) { router.push('/'); return }
      await new Promise(r => setTimeout(r, 2000))
    }
    setError('Payment received — activation is taking a moment. Please reload shortly.')
  }, [router])

  async function subscribe(tier: Tier) {
    setBusy(tier); setError(null)
    try {
      const { subscription_id, razorpay_key_id } = await createSubscription(tier)
      const ok = await loadRazorpay()
      if (!ok) throw new Error('Could not load the payment window. Check your connection.')
      const rzp = new (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: () => void) => void } }).Razorpay({
        key: razorpay_key_id,
        subscription_id,
        name: 'PAL',
        description: tier === 'family' ? 'PAL Family membership' : 'PAL Individual membership',
        theme: { color: '#37b59b' },
        handler: () => { setBusy(tier); void pollActive() },
        modal: { ondismiss: () => setBusy(null) },
      })
      rzp.on('payment.failed', () => { setError('Payment failed. Please try again.'); setBusy(null) })
      rzp.open()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong'); setBusy(null)
    }
  }

  return (
    <div className="palui">
      <div className="signin" style={{ gridTemplateColumns: 'minmax(0,1fr)', gridTemplateRows: 'auto 1fr' }}>
        <div style={{ background: 'var(--soft)', borderBottom: '1px solid var(--line)', padding: '1em 1.4em', display: 'flex', alignItems: 'center', gap: '.6em' }}>
          <button className="logo" onClick={() => router.push('/')} style={{ padding: 0, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '.5em' }} aria-label="PAL home">
            <PalRosette size={28} color="var(--jade-deep)" /><b>PAL</b>
          </button>
          <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => { localStorage.removeItem('pal_token'); router.push('/login') }}>Use a different number</button>
        </div>
        <div style={{ padding: '1.6em 1.4em 2.4em', maxWidth: '52em', margin: '0 auto', width: '100%' }}>
          <h1 className="h" style={{ fontSize: '2.1em' }}>Choose your plan</h1>
          <p className="lede">One price, everything included. Inclusive of all taxes. Cancel any time.</p>
          {error && <div className="alertcard" style={{ marginTop: '1em' }}><Icon name="alert" /><div><b>Payment</b><span className="muted small">{error}</span></div></div>}
          {checking ? <div className="muted" style={{ marginTop: '1.4em' }}>Loading…</div> : (
            <div className="plans">
              <div className="plan2">
                <h3>Individual</h3><p className="muted small">For 1 person</p>
                <div className="price">₹41 <small>a month</small></div>
                <ul>{INDIVIDUAL.map(f => <li key={f}><Icon name="check" /> {f}</li>)}</ul>
                <button className="btn sec full big" disabled={busy !== null} onClick={() => void subscribe('individual')}>{busy === 'individual' ? 'Opening payment…' : 'Choose Individual'}</button>
              </div>
              <div className="plan2 best">
                <span className="ribbon">Best for families</span>
                <h3>Family</h3><p className="muted small">For up to 3 people</p>
                <div className="price">₹99 <small>a month</small></div>
                <ul>{FAMILY.map(f => <li key={f}><Icon name="check" /> {f}</li>)}</ul>
                <button className="btn pri full big" disabled={busy !== null} onClick={() => void subscribe('family')}>{busy === 'family' ? 'Opening payment…' : 'Choose Family'}</button>
              </div>
            </div>
          )}
          <p className="small muted" style={{ marginTop: '1.2em', textAlign: 'center' }}>Payment by UPI or card through Razorpay.</p>
        </div>
      </div>
    </div>
  )
}
