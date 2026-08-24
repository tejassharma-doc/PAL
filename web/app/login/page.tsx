'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  loginWithPassword,
  requestLoginOTP,
  verifyLoginOTP,
} from '../../lib/api-auth'

// Design tokens
const c = {
  ink: '#0d1f24',
  deep: '#13343b',
  paper: '#f6f3ec',
  soft: '#fbf9f4',
  jade: '#37b59b',
  jadeD: '#1f7d6b',
  rose: '#c2675e',
}
const mono = "'Space Mono', monospace"
const serif = "'Newsreader', serif"
const sans = "'Space Grotesk', sans-serif"

type LoginMode = 'phone' | 'email'

export default function LoginPage() {
  const router = useRouter()

  // Check if already authenticated
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('pal_token')
      if (token) {
        router.push('/')
      }
    }
  }, [router])

  // State
  const [loginMode, setLoginMode] = useState<LoginMode>('phone')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Phone OTP Login (PRIMARY)
  const [phone, setPhone] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [resendCountdown, setResendCountdown] = useState(0)

  const otpRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]

  // Email/Password Login (SECONDARY)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCountdown])

  // Phone OTP Request Handler
  async function handleRequestOTP(e: React.FormEvent) {
    e.preventDefault()

    if (!phone || phone.replace(/\D/g, '').length < 10) {
      setError('Please enter a valid 10-digit phone number')
      return
    }

    setError('')
    setLoading(true)

    try {
      const response = await requestLoginOTP({ phone })

      // Auto-fill OTP in dev mode
      if (response.dev_otp) {
        const otpDigits = response.dev_otp.split('')
        setOtp(otpDigits)
        // Auto-focus first OTP input
        setTimeout(() => otpRefs[0].current?.focus(), 100)
      }

      setOtpSent(true)
      setResendCountdown(60)
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Phone OTP Verify Handler
  async function handleVerifyOTP(e: React.FormEvent) {
    e.preventDefault()

    const code = otp.join('')
    if (code.length < 6) {
      setError('Please enter the complete 6-digit OTP')
      return
    }

    setError('')
    setLoading(true)

    try {
      const response = await verifyLoginOTP(phone, code)

      // Successfully logged in - redirect to home
      console.log('Phone login successful')
      router.push('/')
    } catch (err: any) {
      setError(err.message || 'Invalid OTP. Please try again.')
      // Clear OTP on error
      setOtp(['', '', '', '', '', ''])
      otpRefs[0].current?.focus()
    } finally {
      setLoading(false)
    }
  }

  function handleOtpChange(idx: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1)
    const newOtp = [...otp]
    newOtp[idx] = digit
    setOtp(newOtp)

    if (digit && idx < 5) {
      otpRefs[idx + 1].current?.focus()
    }
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs[idx - 1].current?.focus()
    }
  }

  async function handleResendOTP() {
    if (resendCountdown > 0) return

    setError('')
    setLoading(true)

    try {
      const response = await requestLoginOTP({ phone })

      if (response.dev_otp) {
        const otpDigits = response.dev_otp.split('')
        setOtp(otpDigits)
      }

      setResendCountdown(60)
    } catch (err: any) {
      setError(err.message || 'Failed to resend OTP')
    } finally {
      setLoading(false)
    }
  }

  // Email/Password Login Handler
  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()

    if (!email || !password) {
      setError('Please enter both email and password')
      return
    }

    setError('')
    setLoading(true)

    try {
      const response = await loginWithPassword(email, password)

      console.log('Email login successful')
      await new Promise(resolve => setTimeout(resolve, 100))

      const patientId = localStorage.getItem('pal_patient_id')

      if (!patientId) {
        router.push('/profile/create')
      } else {
        router.push('/')
      }
    } catch (err: any) {
      console.error('Login error:', err)
      setError(err.message || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(120% 80% at 50% -10%, #18454e 0%, #13343b 38%, #0c2429 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: '.62rem',
          letterSpacing: '.2em',
          textTransform: 'uppercase',
          color: c.jade,
          marginBottom: 20,
        }}
      >
        PAL
      </div>

      <div
        style={{
          width: 420,
          maxWidth: '100%',
          background: c.soft,
          borderRadius: 24,
          padding: '32px 28px',
          boxShadow: '0 1px 2px rgba(13,31,36,.06), 0 30px 70px -22px rgba(0,0,0,.6)',
        }}
      >
        <h1
          style={{
            fontFamily: serif,
            fontWeight: 300,
            fontSize: '1.8rem',
            lineHeight: 1.2,
            color: c.ink,
            marginBottom: 8,
          }}
        >
          Welcome back
        </h1>
        <p
          style={{
            fontFamily: mono,
            fontSize: '.6rem',
            opacity: 0.5,
            marginBottom: 28,
            letterSpacing: '.04em',
          }}
        >
          Login to access your health records
        </p>

        {/* Phone OTP Login Form (PRIMARY) */}
        {loginMode === 'phone' && !otpSent && (
          <form onSubmit={handleRequestOTP}>
            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  fontFamily: mono,
                  fontSize: '.57rem',
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: c.ink,
                  opacity: 0.5,
                  marginBottom: 8,
                  display: 'block',
                }}
              >
                Phone Number
              </label>
              <div style={{ position: 'relative' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 14,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontFamily: sans,
                    fontSize: '.9rem',
                    color: c.ink,
                    opacity: 0.5,
                  }}
                >
                  +91
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="1234567890"
                  autoComplete="tel"
                  maxLength={10}
                  style={{
                    width: '100%',
                    padding: '14px 14px 14px 50px',
                    fontFamily: sans,
                    fontSize: '1rem',
                    color: c.ink,
                    background: '#fff',
                    border: `2px solid ${error ? c.rose : c.jade}`,
                    borderRadius: 12,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {error && (
              <div
                style={{
                  fontFamily: mono,
                  fontSize: '.6rem',
                  color: c.rose,
                  marginBottom: 16,
                  textAlign: 'center',
                  padding: '8px 12px',
                  background: 'rgba(194,103,94,.08)',
                  borderRadius: 8,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !phone}
              style={{
                width: '100%',
                padding: '14px',
                fontFamily: sans,
                fontSize: '.95rem',
                fontWeight: 600,
                color: '#fff',
                background: loading || !phone ? '#ccc' : c.jade,
                border: 'none',
                borderRadius: 12,
                cursor: loading || !phone ? 'not-allowed' : 'pointer',
                marginBottom: 20,
              }}
            >
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>

            {/* Switch to Email Login */}
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button
                type="button"
                onClick={() => {
                  setLoginMode('email')
                  setError('')
                }}
                style={{
                  fontFamily: mono,
                  fontSize: '.6rem',
                  color: c.ink,
                  opacity: 0.5,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Use Email & Password instead
              </button>
            </div>
          </form>
        )}

        {/* OTP Verification Form */}
        {loginMode === 'phone' && otpSent && (
          <form onSubmit={handleVerifyOTP}>
            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  fontFamily: mono,
                  fontSize: '.57rem',
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: c.ink,
                  opacity: 0.5,
                  marginBottom: 8,
                  display: 'block',
                }}
              >
                Enter 6-Digit OTP
              </label>
              <p
                style={{
                  fontFamily: sans,
                  fontSize: '.75rem',
                  color: c.ink,
                  opacity: 0.6,
                  marginBottom: 16,
                }}
              >
                Sent to +91 {phone}
              </p>

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={otpRefs[idx]}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    style={{
                      width: 48,
                      height: 56,
                      fontFamily: mono,
                      fontSize: '1.5rem',
                      textAlign: 'center',
                      color: c.ink,
                      background: '#fff',
                      border: `2px solid ${digit ? c.jade : 'rgba(13,31,36,.16)'}`,
                      borderRadius: 12,
                      outline: 'none',
                    }}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div
                style={{
                  fontFamily: mono,
                  fontSize: '.6rem',
                  color: c.rose,
                  marginBottom: 16,
                  textAlign: 'center',
                  padding: '8px 12px',
                  background: 'rgba(194,103,94,.08)',
                  borderRadius: 8,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || otp.join('').length < 6}
              style={{
                width: '100%',
                padding: '14px',
                fontFamily: sans,
                fontSize: '.95rem',
                fontWeight: 600,
                color: '#fff',
                background: loading || otp.join('').length < 6 ? '#ccc' : c.jade,
                border: 'none',
                borderRadius: 12,
                cursor: loading || otp.join('').length < 6 ? 'not-allowed' : 'pointer',
                marginBottom: 16,
              }}
            >
              {loading ? 'Verifying...' : 'Verify & Login'}
            </button>

            {/* Resend OTP */}
            <div style={{ textAlign: 'center' }}>
              {resendCountdown > 0 ? (
                <p
                  style={{
                    fontFamily: mono,
                    fontSize: '.6rem',
                    color: c.ink,
                    opacity: 0.5,
                  }}
                >
                  Resend OTP in {resendCountdown}s
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleResendOTP}
                  disabled={loading}
                  style={{
                    fontFamily: mono,
                    fontSize: '.6rem',
                    color: c.jade,
                    background: 'none',
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Resend OTP
                </button>
              )}
            </div>

            {/* Change Phone Number */}
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false)
                  setOtp(['', '', '', '', '', ''])
                  setError('')
                }}
                style={{
                  fontFamily: mono,
                  fontSize: '.6rem',
                  color: c.ink,
                  opacity: 0.5,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Change phone number
              </button>
            </div>
          </form>
        )}

        {/* Email/Password Login Form (SECONDARY) */}
        {loginMode === 'email' && (
          <form onSubmit={handlePasswordLogin}>
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  fontFamily: mono,
                  fontSize: '.57rem',
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: c.ink,
                  opacity: 0.5,
                  marginBottom: 6,
                  display: 'block',
                }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontFamily: sans,
                  fontSize: '.9rem',
                  color: c.ink,
                  background: '#fff',
                  border: `1px solid ${error ? c.rose : 'rgba(13,31,36,.16)'}`,
                  borderRadius: 11,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  fontFamily: mono,
                  fontSize: '.57rem',
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: c.ink,
                  opacity: 0.5,
                  marginBottom: 6,
                  display: 'block',
                }}
              >
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    paddingRight: '45px',
                    fontFamily: sans,
                    fontSize: '.9rem',
                    color: c.ink,
                    background: '#fff',
                    border: `1px solid ${error ? c.rose : 'rgba(13,31,36,.16)'}`,
                    borderRadius: 11,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: mono,
                    fontSize: '.65rem',
                    color: c.ink,
                    opacity: 0.4,
                  }}
                >
                  {showPassword ? 'hide' : 'show'}
                </button>
              </div>
            </div>

            {error && (
              <div
                style={{
                  fontFamily: mono,
                  fontSize: '.6rem',
                  color: c.rose,
                  marginBottom: 12,
                  textAlign: 'center',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              style={{
                width: '100%',
                padding: '14px',
                fontFamily: sans,
                fontSize: '.95rem',
                fontWeight: 600,
                color: '#fff',
                background: loading || !email || !password ? '#ccc' : c.jadeD,
                border: 'none',
                borderRadius: 12,
                cursor: loading || !email || !password ? 'not-allowed' : 'pointer',
                marginBottom: 20,
              }}
            >
              {loading ? 'Logging in...' : 'Login with Email'}
            </button>

            {/* Switch to Phone Login */}
            <div style={{ textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  setLoginMode('phone')
                  setError('')
                }}
                style={{
                  fontFamily: mono,
                  fontSize: '.6rem',
                  color: c.jade,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontWeight: 600,
                }}
              >
                ← Back to Phone Login
              </button>
            </div>
          </form>
        )}

        {/* Sign Up Link */}
        <div
          style={{
            textAlign: 'center',
            marginTop: 24,
            paddingTop: 20,
            borderTop: '1px solid rgba(13,31,36,.08)',
          }}
        >
          <p
            style={{
              fontFamily: sans,
              fontSize: '.8rem',
              color: c.ink,
              opacity: 0.6,
            }}
          >
            Don't have an account?{' '}
            <Link
              href="/signup"
              style={{
                color: c.jade,
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
