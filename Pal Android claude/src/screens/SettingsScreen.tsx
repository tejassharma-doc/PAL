import React, {useEffect, useState} from 'react'
import {View, Text, StyleSheet, ScrollView, Pressable, Alert} from 'react-native'
import {SafeAreaView} from 'react-native-safe-area-context'
import {PAL, FONT, RADIUS, SPACE} from '../theme'
import {getCreditBalance, logout, CreditBalance} from '../lib/api'

export default function SettingsScreen({navigation}: any) {
  const [credits, setCredits] = useState<CreditBalance | null>(null)

  useEffect(() => {
    getCreditBalance().then(setCredits).catch(() => {})
  }, [])

  function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Sign out', style: 'destructive',
        onPress: async () => {
          await logout()
          navigation?.replace?.('Login')
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Credits section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>LLM Credits</Text>
          {credits ? (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>Balance</Text>
                <Text style={styles.value}>{credits.balance} credits</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Free per day</Text>
                <Text style={styles.value}>{credits.free_credits_per_day}</Text>
              </View>
              <View style={[styles.row, {borderBottomWidth: 0}]}>
                <Text style={styles.label}>Refills at</Text>
                <Text style={styles.value}>
                  {new Date(credits.refill_at).toLocaleTimeString('en-IN', {
                    hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.emptyText}>Sign in to see credit balance.</Text>
          )}
        </View>

        {/* Privacy section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>
          <View style={styles.row}>
            <Text style={styles.label}>PHI storage</Text>
            <Text style={styles.value}>Encrypted · on-server</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>AI access</Text>
            <Text style={styles.value}>Consent-gated</Text>
          </View>
          <View style={[styles.row, {borderBottomWidth: 0}]}>
            <Text style={styles.label}>Document upload</Text>
            <Text style={styles.value}>MDT · local network</Text>
          </View>
        </View>

        {/* Sign out */}
        <Pressable style={styles.signOutBtn} onPress={handleLogout}>
          <Text style={styles.signOutLabel}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>PAL Health v1.0.0 · Android</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:    {flex: 1, backgroundColor: PAL.bg},
  scroll:  {flex: 1},
  content: {padding: SPACE.lg, paddingBottom: 100},
  section: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: PAL.surfaceBorder,
    marginBottom: SPACE.md, overflow: 'hidden',
  },
  sectionTitle: {
    fontFamily: FONT.mono, fontSize: 9, color: PAL.jade,
    textTransform: 'uppercase',
    paddingHorizontal: SPACE.md, paddingTop: SPACE.md, paddingBottom: SPACE.sm,
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACE.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: PAL.surfaceBorder,
  },
  label: {fontSize: 14, color: PAL.textDark},
  value: {fontSize: 13, color: PAL.textMuted, fontFamily: FONT.mono},
  emptyText: {
    fontFamily: FONT.mono, fontSize: 11, color: PAL.textFaint,
    padding: SPACE.md,
  },
  signOutBtn: {
    borderRadius: RADIUS.md, paddingVertical: 13, alignItems: 'center',
    borderWidth: 1, borderColor: PAL.roseBorder, marginBottom: SPACE.md,
    backgroundColor: PAL.roseFaint,
  },
  signOutLabel: {color: PAL.rose, fontWeight: '700', fontSize: 14},
  version: {
    fontFamily: FONT.mono, fontSize: 10, color: PAL.textFaint,
    textAlign: 'center', marginTop: SPACE.sm,
  },
})
