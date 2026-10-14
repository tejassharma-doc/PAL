/**
 * Shown when the signed-in account has no patient profile yet.
 * POST /patients requires every field below (server-side validation).
 */
import React, { useState } from 'react'
import { KeyboardAvoidingView, ScrollView, Text, Platform, View } from 'react-native'
import { Button, Chips, ErrorBox, Field, Header, PageTitle, SectionTitle, ui } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import * as api from '../lib/api'
import { loadSession, updateSession } from '../lib/session'

export default function CreateProfileScreen() {
  const { session, setSession, signOut } = useAuth()
  const [f, setF] = useState({
    full_name: session?.displayName?.startsWith('+91') ? '' : session?.displayName ?? '',
    phone: session?.phone ?? '',
    date_of_birth: '',
    gender: 'prefer_not_to_say' as (typeof api.GENDERS)[number],
    blood_group: 'unknown' as (typeof api.BLOOD_GROUPS)[number],
    address: '',
    allergies: 'NA',
    chronic_conditions: 'None',
    current_medications: 'None',
    ec_name: '',
    ec_relationship: '',
    ec_phone: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (v: string) => setF(p => ({ ...p, [k]: v }))

  const submit = async () => {
    setError(null)
    const digits = (x: string) => x.replace(/\D/g, '')
    const problems: string[] = []
    if (!f.full_name.trim()) problems.push('Full name is required.')
    if (digits(f.phone).length < 10 || digits(f.phone).length > 15) problems.push('Mobile number must be 10–15 digits.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date_of_birth) || isNaN(Date.parse(f.date_of_birth)))
      problems.push('Date of birth must be YYYY-MM-DD.')
    if (!f.address.trim()) problems.push('Address is required.')
    if (!f.ec_name.trim() || !f.ec_relationship.trim()) problems.push('Emergency contact name and relationship are required.')
    if (digits(f.ec_phone).length < 10 || digits(f.ec_phone).length > 15)
      problems.push('Emergency contact phone must be 10–15 digits.')
    if (problems.length) {
      setError(problems.join('\n'))
      return
    }
    setBusy(true)
    try {
      // A previous attempt may have timed out after the server saved it. A second
      // patient would break phone sign-in (server expects exactly one), so check first.
      const existing = await api.getProfile().then(p => p.patient).catch(() => null)
      if (existing?.id) {
        await updateSession({ patientId: existing.id, displayName: existing.full_name })
        setSession(await loadSession())
        return
      }
      await api.createPatient({
        full_name: f.full_name.trim(),
        phone: digits(f.phone),
        date_of_birth: f.date_of_birth,
        gender: f.gender,
        blood_group: f.blood_group,
        address: f.address.trim(),
        allergies: f.allergies.trim() || 'NA',
        chronic_conditions: f.chronic_conditions.trim() || 'None',
        current_medications: f.current_medications.trim() || 'None',
        emergency_contact: {
          name: f.ec_name.trim(),
          relationship: f.ec_relationship.trim(),
          phone: digits(f.ec_phone),
        },
        ...(session?.email ? { email: session.email } : {}),
      })
      // session was updated with the new patient id inside createPatient
      setSession(await loadSession())
    } catch (e: any) {
      setError(e?.message ?? 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={ui.screen}>
      <Header title="Welcome to PAL" subtitle="one-time setup" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={ui.scroll} keyboardShouldPersistTaps="handled">
          <PageTitle title="Your health profile" lead="PAL needs a few details before it can show your records." />
          {error ? <ErrorBox message={error} /> : null}
          <SectionTitle>About you</SectionTitle>
          <Field label="FULL NAME" value={f.full_name} onChangeText={set('full_name')} autoComplete="name" />
          <Field label="MOBILE NUMBER" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
          <Field
            label="Date of birth"
            value={f.date_of_birth}
            onChangeText={set('date_of_birth')}
            placeholder="1985-07-24"
            hint="Format: YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
          />
          <Chips label="GENDER" options={api.GENDERS} value={f.gender} onChange={v => setF(p => ({ ...p, gender: v }))} />
          <Chips
            label="BLOOD GROUP"
            options={api.BLOOD_GROUPS}
            value={f.blood_group}
            onChange={v => setF(p => ({ ...p, blood_group: v }))}
          />
          <Field label="ADDRESS" value={f.address} onChangeText={set('address')} multiline />

          <SectionTitle>Health background</SectionTitle>
          <Field label="ALLERGIES" value={f.allergies} onChangeText={set('allergies')} hint='Write "NA" if none.' />
          <Field label="LONG-TERM CONDITIONS" value={f.chronic_conditions} onChangeText={set('chronic_conditions')} />
          <Field label="CURRENT MEDICINES" value={f.current_medications} onChangeText={set('current_medications')} />

          <SectionTitle>Emergency contact</SectionTitle>
          <Field label="NAME" value={f.ec_name} onChangeText={set('ec_name')} />
          <Field label="RELATIONSHIP" value={f.ec_relationship} onChangeText={set('ec_relationship')} placeholder="Spouse" />
          <Field label="PHONE" value={f.ec_phone} onChangeText={set('ec_phone')} keyboardType="phone-pad" />

          <Button title="Save profile" onPress={submit} loading={busy} />
          <Button title="Sign out" kind="outline" onPress={signOut} style={{ marginTop: 8 }} />
          <Text style={ui.muted}>Your profile is stored on the PAL server and only visible to you.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}
