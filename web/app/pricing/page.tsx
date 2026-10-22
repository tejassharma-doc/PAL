'use client';

/**
 * /pricing — subscription paywall.
 *
 * Shown after OTP when the user has no active subscription. Starts a Razorpay
 * recurring subscription (backend /subscription/create), opens Razorpay Checkout,
 * then polls /subscription/status until it's active and enters the app.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export default function PricingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // If already subscribed (or not logged in), leave this page.
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

  async function subscribe() {
    setBusy(true);
    setError(null);
    const t = token();
    try {
      const res = await fetch('/api/subscription/create', {
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
        description: 'PAL membership',
        theme: { color: '#37b59b' },
        handler: () => { setBusy(true); void pollActive(); },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on('payment.failed', () => { setError('Payment failed. Please try again.'); setBusy(false); });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#fbf9f4',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: 'Georgia, serif', color: '#0d1f24',
    }}>
      {checking ? (
        <div style={{ opacity: 0.6 }}>Loading…</div>
      ) : (
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#1f7d6b', marginBottom: 10 }}>PAL Membership</div>
          <h1 style={{ fontSize: '1.7rem', fontWeight: 300, marginBottom: 10 }}>Unlock your PAL</h1>
          <p style={{ fontSize: '0.92rem', opacity: 0.7, marginBottom: 22, lineHeight: 1.5 }}>
            Subscribe to access your records, medication reminders, visits and the PAL assistant.
          </p>

          <div style={{ background: '#fff', border: '1px solid rgba(13,31,36,.12)', borderRadius: 16, padding: 20, marginBottom: 18, textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 10 }}>Everything in PAL</div>
            {['Your full medical records & lab results', 'Prescriptions & medication reminders', 'Visits, pre-visit & care summaries', 'PAL AI assistant', 'Family care hub'].map((f) => (
              <div key={f} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 8, fontSize: '0.88rem' }}>
                <span style={{ color: '#37b59b', fontWeight: 700 }}>✓</span>
                <span>{f}</span>
              </div>
            ))}
          </div>

          {error && (
            <div style={{ color: '#b4433a', fontSize: '0.85rem', marginBottom: 12 }}>{error}</div>
          )}

          <button
            onClick={() => void subscribe()}
            disabled={busy}
            style={{
              width: '100%', padding: '15px 0', borderRadius: 14, border: 'none',
              background: 'linear-gradient(150deg,#37b59b,#2a9d85)', color: '#fff',
              fontSize: '1.05rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Opening payment…' : 'Subscribe'}
          </button>

          <button
            onClick={() => { localStorage.removeItem('pal_token'); router.push('/login'); }}
            style={{ width: '100%', background: 'none', border: 'none', color: '#4a5a5f', fontSize: '0.85rem', marginTop: 14, cursor: 'pointer' }}
          >
            Use a different number
          </button>
        </div>
      )}
    </div>
  );
}
