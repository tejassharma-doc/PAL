/**
 * SafetyBanner — full-screen overlay for emergency / crisis safety short-circuits.
 *
 * Shown when the Fugu Router fires a safety_short_circuit.
 * Content is non-clinical: urgent-care guidance + clinic contact only.
 * No agent answers are shown — the overlay blocks all chat content.
 */

import React from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native'
import type {SafetyCategory} from '@services/fuguRouter'

interface Props {
  visible: boolean
  category: SafetyCategory
  clinicPhone?: string
  onDismiss: () => void
}

const EMERGENCY_HELPLINE = '112'
const CRISIS_HELPLINE = 'iCall: 9152987821'

export function SafetyBanner({visible, category, clinicPhone, onDismiss}: Props): React.JSX.Element {
  const isEmergency = category === 'emergency'

  function callNumber(phone: string): void {
    Linking.openURL(`tel:${phone.replace(/\D/g, '')}`)
  }

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, isEmergency ? styles.emergency : styles.crisis]}>
          <Text style={styles.icon}>{isEmergency ? '🚨' : '💙'}</Text>

          {isEmergency ? (
            <>
              <Text style={styles.title}>This sounds like an emergency</Text>
              <Text style={styles.body}>
                Please call emergency services immediately or go to your nearest hospital
                emergency room. Do not rely on this app for emergency medical care.
              </Text>
              <TouchableOpacity
                style={styles.primary}
                onPress={() => callNumber(EMERGENCY_HELPLINE)}
              >
                <Text style={styles.primaryLabel}>Call {EMERGENCY_HELPLINE} — Emergency</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>Your wellbeing matters</Text>
              <Text style={styles.body}>
                If you're having thoughts of hurting yourself, please reach out to a crisis
                helpline. You are not alone.
              </Text>
              <TouchableOpacity
                style={styles.primary}
                onPress={() => callNumber(CRISIS_HELPLINE)}
              >
                <Text style={styles.primaryLabel}>Contact {CRISIS_HELPLINE}</Text>
              </TouchableOpacity>
            </>
          )}

          {clinicPhone && (
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => callNumber(clinicPhone)}
            >
              <Text style={styles.secondaryLabel}>Call your clinic: {clinicPhone}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.dismiss} onPress={onDismiss}>
            <Text style={styles.dismissLabel}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  emergency: {
    backgroundColor: '#fff1f0',
    borderWidth: 2,
    borderColor: '#ff4d4f',
  },
  crisis: {
    backgroundColor: '#f0f5ff',
    borderWidth: 2,
    borderColor: '#2f54eb',
  },
  icon: {fontSize: 40, marginBottom: 12},
  title: {fontSize: 20, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', marginBottom: 10},
  body: {fontSize: 15, color: '#444', textAlign: 'center', lineHeight: 22, marginBottom: 20},
  primary: {
    backgroundColor: '#ff4d4f',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryLabel: {color: '#fff', fontWeight: '700', fontSize: 16},
  secondary: {
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryLabel: {color: '#1a1a1a', fontWeight: '600', fontSize: 15},
  dismiss: {marginTop: 8, paddingVertical: 8},
  dismissLabel: {color: '#888', fontSize: 14},
})
