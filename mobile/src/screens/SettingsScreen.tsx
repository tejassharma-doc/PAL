import React, { useState, useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { PAL, FONT, RADIUS, SPACE } from '../theme'
import { signOut } from '../lib/api'

const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
]

export default function SettingsScreen({ navigation }: any) {
  const [lang, setLang] = useState('en')

  useEffect(() => {
    AsyncStorage.getItem('pal_lang').then(l => { if (l) setLang(l) })
  }, [])

  async function selectLang(code: string) {
    setLang(code)
    await AsyncStorage.setItem('pal_lang', code)
  }

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut()
          // When auth is wired, navigate to login here.
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Settings</Text>

        {/* Profile */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Profile</Text>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>A</Text>
            </View>
            <View>
              <Text style={styles.profileName}>Anil</Text>
              <Text style={styles.profileSub}>anil@example.com · active member</Text>
            </View>
          </View>
        </View>

        {/* Language */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Language</Text>
          {LANGUAGES.map((l, i) => (
            <Pressable
              key={l.code}
              style={[styles.row, i > 0 && styles.rowBorder]}
              onPress={() => selectLang(l.code)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{l.label}</Text>
                <Text style={styles.rowNative}>{l.native}</Text>
              </View>
              {lang === l.code && (
                <View style={styles.check}>
                  <Text style={styles.checkText}>✓</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>About</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowValue}>1.0.0</Text>
          </View>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>Privacy policy</Text>
            <Text style={[styles.rowValue, { color: PAL.jade }]}>→</Text>
          </View>
        </View>

        {/* Sign out */}
        <Pressable style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAL.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.lg, paddingBottom: 100 },
  heading: {
    fontFamily: FONT.serif, fontSize: 26, fontWeight: '300',
    color: PAL.textDark, marginBottom: SPACE.xl,
  },
  section: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.md,
    marginBottom: SPACE.md, overflow: 'hidden',
    borderWidth: 1, borderColor: PAL.surfaceBorder,
  },
  sectionLabel: {
    fontFamily: FONT.mono, fontSize: 9, color: PAL.jade,
    textTransform: 'uppercase',
    paddingHorizontal: SPACE.md, paddingTop: SPACE.md, paddingBottom: SPACE.sm,
  },
  profileRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    padding: SPACE.md, paddingTop: SPACE.sm,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: PAL.jade, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: PAL.navyDeep, fontWeight: '700', fontSize: 18 },
  profileName: { fontSize: 16, fontWeight: '600', color: PAL.textDark },
  profileSub: { fontFamily: FONT.mono, fontSize: 10, color: PAL.textMuted, marginTop: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACE.md, paddingVertical: 14,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: PAL.surfaceBorder },
  rowLabel: { flex: 1, fontSize: 14, color: PAL.textDark, fontWeight: '500' },
  rowNative: { fontFamily: FONT.mono, fontSize: 11, color: PAL.textMuted, marginTop: 1 },
  rowValue: { fontFamily: FONT.mono, fontSize: 12, color: PAL.textMuted },
  check: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: PAL.jadeFaint, alignItems: 'center', justifyContent: 'center',
  },
  checkText: { color: PAL.jade, fontSize: 13, fontWeight: '700' },
  signOutBtn: {
    backgroundColor: PAL.roseFaint, borderRadius: RADIUS.md,
    padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: PAL.roseBorder,
  },
  signOutText: { color: PAL.rose, fontWeight: '700', fontSize: 14 },
})
