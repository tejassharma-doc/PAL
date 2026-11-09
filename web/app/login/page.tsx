'use client'

/**
 * Sign in — redesigned onto the pal-app.html `S.signin` + `S.otp` screens
 * (brandside + formside, 6-box OTP). All auth logic preserved: phone OTP with
 * dev_otp autofill + resend timer, verify routing (onboarding/pricing/home),
 * and the email/password fallback.
 */
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PalEmblem } from '../../components/PalEmblem'
import { Icon } from '../../components/ui/Icon'
import { markSignedIn } from '../../lib/sessionCookie'
import { loginWithPassword, requestLoginOTP, verifyLoginOTP } from '../../lib/api-auth'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('pal_token')) {
      markSignedIn(); router.push('/')
    }
  }, [router])

  const [mode, setMode] = useState<'phone' | 'email'>('phone')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [phone, setPhone] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [resend, setResend] = useState(0)
  const [foundEhr, setFoundEhr] = useState(false)
  const otpRefs = Array.from({ length: 6 }, () => useRef<HTMLInputElement>(null))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (resend <= 0) return
    const t = setTimeout(() => setResend(resend - 1), 1000)
    return () => clearTimeout(t)
  }, [resend])

  async function sendOtp() {
    if (!phone || phone.replace(/\D/g, '').length < 10) { setError('Enter a valid 10-digit mobile number'); return }
    setError(''); setLoading(true)
    try {
      const r = await requestLoginOTP({ phone })
      if (r.dev_otp) { setOtp(r.dev_otp.split('')); setTimeout(() => otpRefs[0].current?.focus(), 100) }
      setFoundEhr(Boolean((r as Record<string, unknown>).has_ehr))
      setOtpSent(true); setResend(24)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to send code') }
    finally { setLoading(false) }
  }

  async function verify() {
    const code = otp.join('')
    if (code.length < 6) { setError('Enter the complete 6-digit code'); return }
    setError(''); setLoading(true)
    try {
      const r = await verifyLoginOTP(phone, code)
      if (r.has_subscription === false) { router.push('/pricing'); return }
      if (r.requires_onboarding || !r.user.patient_id) { router.push('/onboarding'); return }
      router.push('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code')
      setOtp(['', '', '', '', '', '']); otpRefs[0].current?.focus()
    } finally { setLoading(false) }
  }

  function onOtpChange(i: number, v: string) {
    const d = v.replace(/\D/g, '').slice(-1)
    setOtp(prev => prev.map((x, j) => j === i ? d : x))
    if (d && i < 5) otpRefs[i + 1].current?.focus()
  }
  function onOtpKey(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs[i - 1].current?.focus()
  }

  async function passwordLogin() {
    if (!email || !password) { setError('Enter both email and password'); return }
    setError(''); setLoading(true)
    try {
      await loginWithPassword(email, password)
      await new Promise(r => setTimeout(r, 100))
      router.push(localStorage.getItem('pal_patient_id') ? '/' : '/profile/create')
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid email or password') }
    finally { setLoading(false) }
  }

  const BrandSide = (
    <div className="brandside">
      <button className="logo" onClick={() => router.push('/')} style={{ padding: 0 }} aria-label="PAL home">
        <PalEmblem width="5.6em" color="var(--jade)" />
      </button>
      <h2>Five elements of care. Anchored by your doctor.</h2>
      <ul>
        <li><Icon name="check" />Your reports and prescriptions in one place</li>
        <li><Icon name="check" />Ask questions by voice, in your language</li>
        <li><Icon name="check" />Look after your family&apos;s health together</li>
      </ul>
      <p className="foot">PAL by LocumPro Health, Mumbai</p>
    </div>
  )

  return (
    <div className="palui">
      <div className="signin">
        {BrandSide}
        <div className="formside">
          {mode === 'phone' && !otpSent && (
            <>
              <h1>Sign in</h1>
              <p className="muted" style={{ marginTop: '.3em' }}>We&apos;ll send a 6-digit code to your phone.</p>
              <label htmlFor="ph" style={{ fontWeight: 600, marginTop: '1.4em', display: 'block' }}>Mobile number</label>
              <div className="phone">
                <span>+91</span>
                <input id="ph" inputMode="numeric" maxLength={10} value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => { if (e.key === 'Enter') void sendOtp() }} placeholder="98765 43210" />
              </div>
              {error && <p className="small" style={{ color: 'var(--rose-deep)', marginTop: '.6em' }}>{error}</p>}
              <button className="btn pri big full" style={{ marginTop: '1em' }} disabled={loading} onClick={() => void sendOtp()}>{loading ? 'Sending…' : 'Send code'}</button>
              <p className="alt">Prefer email? <a href="#" onClick={e => { e.preventDefault(); setMode('email'); setError('') }}>Sign in with email</a></p>
            </>
          )}

          {mode === 'phone' && otpSent && (
            <>
              <button className="btn ghost" style={{ padding: 0, alignSelf: 'flex-start' }} onClick={() => { setOtpSent(false); setOtp(['', '', '', '', '', '']); setError('') }}><Icon name="left" /> Change number</button>
              <h1 style={{ marginTop: '.3em' }}>Enter your code</h1>
              <p className="muted" style={{ marginTop: '.3em' }}>We sent a 6-digit code by SMS to <b style={{ color: 'var(--jade-deep)' }}>+91 {phone}</b>.</p>
              <div className="otp" role="group" aria-label="6-digit code">
                {otp.map((d, i) => (
                  <input key={i} ref={otpRefs[i]} className={d ? 'f' : ''} inputMode="numeric" maxLength={1} value={d}
                    aria-label={`Digit ${i + 1}`} onChange={e => onOtpChange(i, e.target.value)} onKeyDown={e => onOtpKey(i, e)} />
                ))}
              </div>
              {error && <p className="small" style={{ color: 'var(--rose-deep)', marginTop: '.6em' }}>{error}</p>}
              <button className="btn pri big full" style={{ marginTop: '1em' }} disabled={loading} onClick={() => void verify()}>{loading ? 'Verifying…' : 'Sign in'}</button>
              <p className="alt">{resend > 0 ? `Didn't get it? Send again in 0:${String(resend).padStart(2, '0')}` : <a href="#" onClick={e => { e.preventDefault(); void sendOtp() }}>Resend code</a>}</p>
              {foundEhr && <div className="found"><Icon name="check" /><div><b>Health record found</b><div className="small muted">Your clinic records will be ready once you sign in.</div></div></div>}
            </>
          )}

          {mode === 'email' && (
            <>
              <button className="btn ghost" style={{ padding: 0, alignSelf: 'flex-start' }} onClick={() => { setMode('phone'); setError('') }}><Icon name="left" /> Back to phone</button>
              <h1 style={{ marginTop: '.3em' }}>Sign in with email</h1>
              <label style={{ fontWeight: 600, marginTop: '1.2em', display: 'block' }}>Email</label>
              <input className="field-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"
                style={{ width: '100%', font: 'inherit', border: '1.5px solid var(--line-2)', borderRadius: '.8em', padding: '.7em .9em', marginTop: '.3em' }} />
              <label style={{ fontWeight: 600, marginTop: '1em', display: 'block' }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password"
                onKeyDown={e => { if (e.key === 'Enter') void passwordLogin() }}
                style={{ width: '100%', font: 'inherit', border: '1.5px solid var(--line-2)', borderRadius: '.8em', padding: '.7em .9em', marginTop: '.3em' }} />
              {error && <p className="small" style={{ color: 'var(--rose-deep)', marginTop: '.6em' }}>{error}</p>}
              <button className="btn pri big full" style={{ marginTop: '1em' }} disabled={loading} onClick={() => void passwordLogin()}>{loading ? 'Signing in…' : 'Sign in'}</button>
            </>
          )}

          <div className="langpick" role="group" aria-label="Language">
            <button aria-pressed>English</button><button aria-pressed={false}>हिंदी</button><button aria-pressed={false}>मराठी</button>
          </div>
        </div>
      </div>
    </div>
  )
}
