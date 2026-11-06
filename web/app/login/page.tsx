'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PalEmblem } from '../../components/PalEmblem'
import { Icon } from '../../components/pal/Icon'
import { markSignedIn } from '../../lib/sessionCookie'
import {
  loginWithPassword,
  requestLoginOTP,
  verifyLoginOTP,
} from '../../lib/api-auth'

type LoginMode = 'phone' | 'email'

export default function LoginPage() {
  const router = useRouter()

  // Already authenticated → straight into the app.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('pal_token')
      if (token) { markSignedIn(); router.push('/') }
    }
  }, [router])

  const [loginMode, setLoginMode] = useState<LoginMode>('phone')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Phone OTP (primary)
  const [phone, setPhone] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [resendCountdown, setResendCountdown] = useState(0)
  const otpRefs = [
    useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
  ]

  // Email/password (secondary)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (resendCountdown <= 0) return
    const t = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCountdown])

  async function handleRequestOTP(e: React.FormEvent) {
    e.preventDefault()
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      setError('Please enter a valid 10-digit phone number'); return
    }
    setError(''); setLoading(true)
    try {
      const response = await requestLoginOTP({ phone })
      if (response.dev_otp) {
        setOtp(response.dev_otp.split(''))
        setTimeout(() => otpRefs[0].current?.focus(), 100)
      }
      setOtpSent(true); setResendCountdown(60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP. Please try again.')
    } finally { setLoading(false) }
  }

  async function handleVerifyOTP(e: React.FormEvent) {
    e.preventDefault()
    const code = otp.join('')
    if (code.length < 6) { setError('Please enter the complete 6-digit code'); return }
    setError(''); setLoading(true)
    try {
      const response = await verifyLoginOTP(phone, code)
      if (response.has_subscription === false) { router.push('/pricing'); return }
      if (response.requires_onboarding || !response.user.patient_id) router.push('/onboarding')
      else router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Please try again.')
      setOtp(['', '', '', '', '', '']); otpRefs[0].current?.focus()
    } finally { setLoading(false) }
  }

  function handleOtpChange(idx: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1)
    const next = [...otp]; next[idx] = digit; setOtp(next)
    if (digit && idx < 5) otpRefs[idx + 1].current?.focus()
  }
  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) otpRefs[idx - 1].current?.focus()
  }
  async function handleResendOTP() {
    if (resendCountdown > 0) return
    setError(''); setLoading(true)
    try {
      const response = await requestLoginOTP({ phone })
      if (response.dev_otp) setOtp(response.dev_otp.split(''))
      setResendCountdown(60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code')
    } finally { setLoading(false) }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) { setError('Please enter both email and password'); return }
    setError(''); setLoading(true)
    try {
      await loginWithPassword(email, password)
      await new Promise(r => setTimeout(r, 100))
      router.push(localStorage.getItem('pal_patient_id') ? '/' : '/profile/create')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password')
    } finally { setLoading(false) }
  }

  const errorBox = error ? (
    <div className="small" role="alert" style={{ color: 'var(--rose-deep)', background: 'var(--rose-tint)', borderRadius: '.7em', padding: '.6em .8em', marginTop: '.8em' }}>
      {error}
    </div>
  ) : null

  return (
    <div className="pal signin">
      <div className="brandside">
        <button className="logo" style={{ padding: 0 }} aria-label="PAL" onClick={() => router.push('/')}>
          <PalEmblem width={150} color="var(--jade)" />
        </button>
        <h2>Five elements of care. Anchored by your doctor.</h2>
        <ul>
          <li><Icon name="check" />Your reports and prescriptions in one place</li>
          <li><Icon name="check" />Ask questions by voice, in your language</li>
          <li><Icon name="check" />Look after your family’s health together</li>
        </ul>
        <p className="foot" style={{ marginTop: 'auto', paddingTop: '2em', fontSize: '.85em', color: '#8fa6a1' }}>PAL by LocumPro Health, Mumbai</p>
      </div>

      <div className="formside">
        {loginMode === 'phone' && !otpSent && (
          <form onSubmit={handleRequestOTP}>
            <h1>Sign in</h1>
            <p className="muted" style={{ marginTop: '.3em' }}>We’ll send a 6-digit code to your phone.</p>
            <label htmlFor="ph" style={{ fontWeight: 600, marginTop: '1.4em', display: 'block' }}>Mobile number</label>
            <div className="phone">
              <span>+91</span>
              <input id="ph" inputMode="numeric" maxLength={10} value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="98765 43210" autoComplete="tel" />
            </div>
            {errorBox}
            <button className="btn pri big full" style={{ marginTop: '1em' }} type="submit" disabled={loading || !phone}>
              {loading ? 'Sending…' : 'Send code'}
            </button>
            <p className="alt">Prefer email? <a onClick={() => { setLoginMode('email'); setError('') }}>Sign in with email</a></p>
            <p className="alt" style={{ marginTop: '.5em' }}>New to PAL? <a onClick={() => router.push('/signup')}>Create an account</a></p>
          </form>
        )}

        {loginMode === 'phone' && otpSent && (
          <form onSubmit={handleVerifyOTP}>
            <button type="button" className="btn ghost" style={{ padding: 0, alignSelf: 'flex-start' }}
              onClick={() => { setOtpSent(false); setOtp(['', '', '', '', '', '']); setError('') }}>
              <Icon name="left" /> Change number
            </button>
            <h1 style={{ marginTop: '.3em' }}>Enter your code</h1>
            <p className="muted" style={{ marginTop: '.3em' }}>
              We sent a 6-digit code by SMS to <b style={{ color: 'var(--jade-deep)' }}>+91 {phone}</b>.
            </p>
            <div className="otp" role="group" aria-label="6-digit code">
              {otp.map((digit, idx) => (
                <input key={idx} ref={otpRefs[idx]} className={digit ? 'f' : ''} inputMode="numeric" maxLength={1}
                  value={digit} aria-label={`Digit ${idx + 1}`}
                  onChange={e => handleOtpChange(idx, e.target.value)} onKeyDown={e => handleOtpKeyDown(idx, e)} />
              ))}
            </div>
            {errorBox}
            <button className="btn pri big full" style={{ marginTop: '1em' }} type="submit" disabled={loading || otp.join('').length < 6}>
              {loading ? 'Verifying…' : 'Sign in'}
            </button>
            <p className="alt">
              {resendCountdown > 0
                ? `Didn’t get it? Send again in 0:${String(resendCountdown).padStart(2, '0')}`
                : <a onClick={handleResendOTP}>Didn’t get it? Send again</a>}
            </p>
          </form>
        )}

        {loginMode === 'email' && (
          <form onSubmit={handlePasswordLogin}>
            <h1>Sign in</h1>
            <p className="muted" style={{ marginTop: '.3em' }}>With your email and password.</p>
            <label htmlFor="em" style={{ fontWeight: 600, marginTop: '1.2em', display: 'block' }}>Email</label>
            <div className="phone"><input id="em" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" style={{ color: 'var(--ink)' }} /></div>
            <label htmlFor="pw" style={{ fontWeight: 600, marginTop: '.9em', display: 'block' }}>Password</label>
            <div className="phone">
              <input id="pw" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" style={{ color: 'var(--ink)' }} />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(s => !s)} style={{ background: 'none', border: 0, padding: '0 .8em', color: 'var(--ink-3)' }}><Icon name="eye" /></button>
            </div>
            {errorBox}
            <button className="btn pri big full" style={{ marginTop: '1em' }} type="submit" disabled={loading || !email || !password}>
              {loading ? 'Signing in…' : 'Sign in with email'}
            </button>
            <p className="alt"><a onClick={() => { setLoginMode('phone'); setError('') }}>← Back to phone sign in</a></p>
          </form>
        )}
      </div>
    </div>
  )
}
