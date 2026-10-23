'use client';

/**
 * /pricing — subscription paywall shown after OTP for unsubscribed users.
 *
 * Choosing a plan calls /subscription/create?plan=<tier> and opens Razorpay
 * Checkout for the logged-in phone user (no signup), then polls
 * /subscription/status until active and enters the app.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Tier = 'individual' | 'family';

function token(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('pal_token');
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if ((window as any).Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const FEATURES = [
  ['Ask PAL anything', 'Type or speak in your own Indian language — clear answers with references.'],
  ['Your record, only with your consent', 'PAL reads your health record only after you allow it for that conversation.'],
  ['All your medical records in one place', 'Lab tests, prescriptions, visit notes and documents, organised for you.'],
  ['Upload lab reports', 'PAL reads the values; you check them before anything is saved.'],
  ['Visits & your doctor’s care plan', 'Appointments, pre-visit interview and care summaries in one place.'],
  ['Medication reminders', 'Timely reminders for every medicine, the way it was prescribed.'],
];

export default function PricingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<Tier | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = token();
    if (!t) { router.push('/login'); return; }
    (async () => {
      try {
        const r = await fetch('/api/subscription/status', { headers: { Authorization: `Bearer ${t}` } });
        const d = await r.json();
        if (d.active) { router.push('/'); return; }
      } catch { /* show pricing */ }
      setChecking(false);
    })();
  }, [router]);

  const pollActive = useCallback(async () => {
    const t = token();
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch('/api/subscription/status', { headers: { Authorization: `Bearer ${t}` } });
        const d = await r.json();
        if (d.active) { router.push('/'); return; }
      } catch { /* retry */ }
      await new Promise((res) => setTimeout(res, 2000));
    }
    setError('Payment received — activation is taking a moment. Please reload shortly.');
  }, [router]);

  async function subscribe(tier: Tier) {
    setBusy(tier);
    setError(null);
    const t = token();
    try {
      const res = await fetch(`/api/subscription/create?plan=${tier}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || 'Could not start subscription');
      }
      const { subscription_id, razorpay_key_id } = await res.json();
      const ok = await loadRazorpay();
      if (!ok) throw new Error('Could not load the payment window. Check your connection.');

      const rzp = new (window as any).Razorpay({
        key: razorpay_key_id,
        subscription_id,
        name: 'PAL',
        description: tier === 'family' ? 'PAL Family membership' : 'PAL Individual membership',
        theme: { color: '#37b59b' },
        handler: () => { setBusy(tier); void pollActive(); },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.on('payment.failed', () => { setError('Payment failed. Please try again.'); setBusy(null); });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(null);
    }
  }

  const card: React.CSSProperties = {
    background: '#fbf9f4', borderRadius: 18, padding: 22, flex: 1, minWidth: 280, maxWidth: 420,
    border: '1px solid rgba(13,31,36,.08)', color: '#0d1f24',
  };

  function PlanCard({ tier, title, who, price, highlight }: { tier: Tier; title: string; who: string; price: number; highlight?: boolean }) {
    return (
      <div style={{ ...card, boxShadow: highlight ? '0 20px 50px -24px rgba(0,0,0,.5)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(55,181,155,.16)', color: '#1f7d6b', display: 'grid', placeItems: 'center', fontSize: '1rem' }}>⚕</span>
          <h2 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: '1.4rem' }}>{title}</h2>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(13,31,36,.05)', borderRadius: 9, padding: '5px 11px', fontSize: '.8rem', marginBottom: 16 }}>
          👥 {who}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontSize: '1rem', verticalAlign: 'top' }}>₹</span>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '2.6rem', fontWeight: 400 }}>{price}</span>
          <span style={{ fontSize: '.95rem', opacity: .6 }}> / month</span>
        </div>
        <div style={{ fontSize: '.8rem', opacity: .55, marginBottom: 16 }}>Inclusive of all taxes</div>
        <button
          onClick={() => void subscribe(tier)}
          disabled={busy !== null}
          style={{
            width: '100%', padding: '13px 0', borderRadius: 12,
            border: highlight ? 'none' : '1px solid rgba(13,31,36,.2)',
            background: highlight ? '#37b59b' : 'transparent',
            color: highlight ? '#fff' : '#0d1f24',
            fontWeight: 600, fontSize: '.95rem', cursor: busy ? 'default' : 'pointer', opacity: busy === tier ? 0.6 : 1,
          }}
        >
          {busy === tier ? 'Opening payment…' : `Choose ${title} →`}
        </button>
        <div style={{ fontFamily: 'monospace', fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase', opacity: .45, margin: '20px 0 10px' }}>What’s included</div>
        {tier === 'family' && (
          <Feature title="For up to 3 people" sub="Everything below for each of up to 3 people in one family group" />
        )}
        {tier === 'individual' && (
          <Feature title="For 1 person" sub="Everything below for you" />
        )}
        {FEATURES.map(([t, s]) => <Feature key={t} title={t} sub={s} />)}
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, overflowY: 'auto',
      background: 'radial-gradient(120% 80% at 50% -10%, #18454e 0%, #13343b 40%, #0c2429 100%)',
      padding: '28px 16px 48px', fontFamily: 'Georgia, serif',
    }}>
      {checking ? (
        <div style={{ color: '#f6f3ec', textAlign: 'center', marginTop: 80, opacity: .7 }}>Loading…</div>
      ) : (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 22, color: '#f6f3ec' }}>
            <div style={{ fontFamily: 'monospace', fontSize: '.62rem', letterSpacing: '.2em', color: '#37b59b', marginBottom: 6 }}>PAL MEMBERSHIP</div>
            <h1 style={{ fontWeight: 300, fontSize: '1.7rem' }}>Choose your plan</h1>
          </div>
          {error && (
            <div style={{ maxWidth: 420, margin: '0 auto 16px', background: 'rgba(180,67,58,.15)', border: '1px solid rgba(180,67,58,.4)', color: '#ffd9d3', borderRadius: 12, padding: '10px 13px', fontSize: '.85rem', textAlign: 'center' }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
            <PlanCard tier="individual" title="Individual" who="For 1 person" price={41} />
            <PlanCard tier="family" title="Family" who="For up to 3 people" price={99} highlight />
          </div>
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button
              onClick={() => { localStorage.removeItem('pal_token'); router.push('/login'); }}
              style={{ background: 'none', border: 'none', color: 'rgba(246,243,236,.7)', fontSize: '.82rem', cursor: 'pointer' }}
            >
              Use a different number
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Feature({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 11 }}>
      <span style={{ color: '#37b59b', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
      <div>
        <div style={{ fontSize: '.86rem', fontWeight: 600, color: '#0d1f24' }}>{title}</div>
        <div style={{ fontSize: '.78rem', opacity: .6, lineHeight: 1.45 }}>{sub}</div>
      </div>
    </div>
  );
}
