/**
 * Login — the website's /login page: dark radial backdrop, "PAL" in mono jade,
 * a paper card with "Welcome back", phone OTP first, email & password as the
 * alternative, sign-up link at the bottom.
 */
import React, { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { C, F, T } from '../theme'
import { Button, ErrorBox, Field } from '../components/ui'
import { DeepBackdrop } from '../components/icons'
import { PalEmblem } from '../components/PalEmblem'
import { useAuth } from '../context/AuthContext'
import * as api from '../lib/api'
import { API_BASE, DEV_TEST_LOGIN } from '../config'

type Mode = 'phone' | 'email' | 'signup'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const { setSession, notice, clearNotice } = useAuth()
  // Debug builds open on email so the pre-filled test account is one tap away.
  const [mode, setMode] = useState<Mode>(__DEV__ ? 'email' : 'phone')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [username, setUsername] = useState(DEV_TEST_LOGIN.username)
  const [password, setPassword] = useState(DEV_TEST_LOGIN.password)
  const [showPw, setShowPw] = useState(false)
  const [suUser, setSuUser] = useState('')
  const [suEmail, setSuEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)

  const switchTo = (m: Mode) => {
    setMode(m)
    setError(null)
    setInfo(null)
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setInfo(null)
    clearNotice()
    try {
      await fn()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const doEmailLogin = () =>
    run(async () => {
      if (!username.trim() || !password) throw new Error('Enter your email (or username) and password.')
      setSession(await api.loginWithPassword(username, password))
    })

  const doSignup = () =>
    run(async () => {
      if (suUser.trim().length < 3) throw new Error('Username must be at least 3 characters.')
      if (!/^\S+@\S+\.\S+$/.test(suEmail.trim())) throw new Error('Enter a valid email address.')
      if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))
        throw new Error('Password needs 8+ characters with an uppercase letter, a lowercase letter and a number.')
      await api.signup(suUser, suEmail, password)
      setSession(await api.loginWithPassword(suUser, password))
    })

  const doRequestOtp = () =>
    run(async () => {
      if (api.normalisePhone(phone).length !== 10) throw new Error('Enter a 10-digit mobile number.')
      const r = await api.requestOtp(phone)
      setOtpSent(true)
      setInfo(r.dev_otp ? `Code sent. (Development server code: ${r.dev_otp})` : 'We sent a 6-digit code by SMS.')
    })

  const doVerifyOtp = () =>
    run(async () => {
      if (!/^\d{4,8}$/.test(otp.trim())) throw new Error('Enter the code you received.')
      setSession(await api.verifyOtp(phone, otp))
    })

  const phoneReady = api.normalisePhone(phone).length === 10
  const emailReady = !!username.trim() && !!password

  return (
    <View style={{ flex: 1, backgroundColor: C.deep2 }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <DeepBackdrop />
      <View style={s.watermark} pointerEvents="none">
        <PalEmblem width={760} color={C.jade} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.wrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand lockup, as on palcare.life: jade emblem, PAL, doctor-anchored care */}
          <View style={s.lockup} accessible accessibilityLabel="PAL — doctor-anchored care">
            <PalEmblem width={230} color={C.jade} />
            <Text style={s.wordmark}>PAL</Text>
            <Text style={s.tagline}>DOCTOR-ANCHORED CARE</Text>
          </View>

          <View style={s.card}>
            <Text style={s.h}>{mode === 'signup' ? 'Create account' : 'Welcome back'}</Text>
            <Text style={s.sub}>{mode === 'signup' ? 'Your health record, in your hands' : 'Login to access your health records'}</Text>

            {notice ? <ErrorBox message={notice} /> : null}
            {error ? <ErrorBox message={error} /> : null}
            {info ? <Text style={s.info}>{info}</Text> : null}

            {mode === 'phone' && (
              <>
                <Text style={s.label}>PHONE NUMBER</Text>
                <View style={[s.phoneBox, phone ? { borderColor: C.jade, borderWidth: 2 } : null]}>
                  <Text style={s.cc}>+91</Text>
                  <TextInput
                    accessibilityLabel="Phone number"
                    value={phone}
                    onChangeText={t => {
                      setPhone(t)
                      setOtpSent(false)
                    }}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    placeholder="1234567890"
                    placeholderTextColor="rgba(13,31,36,0.38)"
                    maxLength={14}
                    style={s.phoneInput}
                  />
                </View>
                {otpSent && (
                  <Field
                    label="ONE-TIME CODE"
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="number-pad"
                    autoComplete="sms-otp"
                    textContentType="oneTimeCode"
                    maxLength={8}
                    placeholder="000000"
                    onSubmitEditing={doVerifyOtp}
                  />
                )}
                {otpSent ? (
                  <>
                    <Button title="Verify & continue" onPress={doVerifyOtp} loading={busy} disabled={!otp.trim()} />
                    <Pressable onPress={doRequestOtp} disabled={busy} style={{ alignSelf: 'center', marginTop: 12 }}>
                      <Text style={s.link}>Send a new code</Text>
                    </Pressable>
                  </>
                ) : (
                  <Button title="Send OTP" onPress={doRequestOtp} loading={busy} disabled={!phoneReady} style={{ marginTop: 4 }} />
                )}
                <Pressable onPress={() => switchTo('email')} style={{ alignSelf: 'center', marginTop: 28 }}>
                  <Text style={s.link}>Use Email & Password instead</Text>
                </Pressable>
              </>
            )}

            {mode === 'email' && (
              <>
                <Field
                  label="EMAIL"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoComplete="email"
                  placeholder="name@example.com"
                />
                <Field
                  label="PASSWORD"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPw}
                  autoComplete="password"
                  placeholder="Enter your password"
                  onSubmitEditing={doEmailLogin}
                  right={
                    <Pressable onPress={() => setShowPw(v => !v)} hitSlop={8} accessibilityLabel={showPw ? 'Hide password' : 'Show password'}>
                      <Text style={[T.meta, { fontSize: 12.5 }]}>{showPw ? 'hide' : 'show'}</Text>
                    </Pressable>
                  }
                />
                <Button title="Login with Email" onPress={doEmailLogin} loading={busy} disabled={!emailReady} />
                <Pressable onPress={() => switchTo('phone')} style={{ alignSelf: 'center', marginTop: 24 }}>
                  <Text style={[s.link, s.linkJade]}>← Back to Phone Login</Text>
                </Pressable>
              </>
            )}

            {mode === 'signup' && (
              <>
                <Field label="USERNAME" value={suUser} onChangeText={setSuUser} autoCapitalize="none" autoCorrect={false} placeholder="yourname" />
                <Field
                  label="EMAIL"
                  value={suEmail}
                  onChangeText={setSuEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  placeholder="name@example.com"
                />
                <Field
                  label="PASSWORD"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPw}
                  placeholder="Create a password"
                  hint="8+ characters, with an uppercase letter, a lowercase letter and a number."
                />
                <Button title="Create account" onPress={doSignup} loading={busy} disabled={!suUser || !suEmail || !password} />
              </>
            )}

            <View style={s.divider} />
            {mode === 'signup' ? (
              <Text style={s.footer}>
                Already have an account?{' '}
                <Text style={s.footerLink} onPress={() => switchTo('email')}>
                  Log in
                </Text>
              </Text>
            ) : (
              <Text style={s.footer}>
                Don't have an account?{' '}
                <Text
                  style={s.footerLink}
                  onPress={() => {
                    setPassword('')
                    switchTo('signup')
                  }}
                >
                  Sign up
                </Text>
              </Text>
            )}
          </View>

          {__DEV__ ? <Text style={s.server}>server · {API_BASE}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const s = StyleSheet.create({
  lockup: { alignItems: 'center', marginBottom: 22 },
  wordmark: { fontFamily: F.sansBold, fontSize: 30, letterSpacing: 1, color: C.paper, marginTop: 10 },
  tagline: { fontFamily: F.mono, fontSize: 12, letterSpacing: 2.4, color: C.mist, marginTop: 4 },
  watermark: { position: 'absolute', top: 40, right: -300, opacity: 0.07 },
  wrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16 },
  brand: { fontFamily: F.mono, fontSize: 13.5, letterSpacing: 3.2, color: C.jade, textAlign: 'center', marginBottom: 22 },
  card: { backgroundColor: C.soft, borderRadius: 28, paddingHorizontal: 28, paddingVertical: 32 },
  h: { fontFamily: F.serif, fontSize: 30, color: C.ink, letterSpacing: -0.3 },
  sub: { fontFamily: F.mono, fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 26 },
  label: { fontFamily: F.mono, fontSize: 12, letterSpacing: 1.2, color: C.muted, marginBottom: 8 },
  phoneBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 54,
    marginBottom: 18,
  },
  cc: { fontFamily: F.sans, fontSize: 16.5, color: C.muted, marginRight: 12 },
  phoneInput: { flex: 1, fontFamily: F.sans, fontSize: 17, color: C.ink, paddingVertical: 12 },
  link: { fontFamily: F.mono, fontSize: 12, color: C.muted, textDecorationLine: 'underline' },
  linkJade: { color: C.jade, opacity: 1, fontFamily: F.monoBold },
  divider: { height: 1, backgroundColor: 'rgba(13,31,36,0.08)', marginTop: 28, marginBottom: 22 },
  footer: { fontFamily: F.sans, fontSize: 16, color: C.muted, textAlign: 'center' },
  footerLink: { color: C.jade, fontFamily: F.sansSemi },
  info: { fontFamily: F.sans, fontSize: 15, color: C.jadeD, marginBottom: 12 },
  server: { fontFamily: F.mono, fontSize: 12, color: C.mist, opacity: 0.75, textAlign: 'center', marginTop: 18 },
})
