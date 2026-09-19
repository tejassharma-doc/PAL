'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// Design tokens (matching login page)
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

export default function SignupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!formData.username || !formData.email || !formData.password) {
      setError('Please fill in all fields')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/v3/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: formData.username,
          email: formData.email,
          password: formData.password,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || 'Signup failed')
      }

      // Signup successful - redirect to login page
      router.push('/login?signup=success')
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
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
          Create your account
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
          Sign up to get started
        </p>

        <form onSubmit={handleSubmit}>
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
              Username
            </label>
            <input
              type="text"
              name="username"
              value={formData.username}
              onChange={handleChange}
              placeholder="Choose a username"
              autoComplete="username"
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
              Email Address
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
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
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Create a password"
                autoComplete="new-password"
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
              Confirm Password
            </label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Confirm your password"
              autoComplete="new-password"
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
            disabled={loading}
            style={{
              width: '100%',
              background: loading ? 'rgba(13,31,36,.12)' : c.jade,
              color: loading ? 'rgba(13,31,36,.35)' : '#fff',
              border: 'none',
              fontFamily: sans,
              fontWeight: 600,
              fontSize: '.9rem',
              padding: 14,
              borderRadius: 13,
              cursor: loading ? 'default' : 'pointer',
              transition: 'background .2s',
            }}
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        {/* Sign In Link */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <p style={{ fontFamily: sans, fontSize: '.82rem', color: c.ink, opacity: 0.6 }}>
            Already have an account?{' '}
            <Link
              href="/login"
              style={{
                color: c.jade,
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <p
        style={{
          fontFamily: mono,
          fontSize: '.55rem',
          color: 'rgba(255,255,255,.3)',
          marginTop: 24,
          textAlign: 'center',
        }}
      >
        By continuing, you agree to our Terms of Service and Privacy Policy
      </p>
    </div>
  )
}
