import React from 'react'
import {View, Text, TouchableOpacity, StyleSheet, Linking} from 'react-native'
import {PAL, FONT, RADIUS, SPACE} from '../theme'

interface Props {
  visible: boolean
  category: 'emergency' | 'crisis'
  onDismiss: () => void
}

const EMERGENCY_PHONE = '112'
const CRISIS_PHONE    = '9152987821' // iCall India

export function SafetyBanner({visible, category, onDismiss}: Props): React.JSX.Element | null {
  if (!visible) return null

  const isEmergency = category === 'emergency'

  return (
    <View style={[styles.banner, isEmergency ? styles.emergency : styles.crisis]}>
      <View style={styles.content}>
        <Text style={styles.icon}>{isEmergency ? '🚨' : '💙'}</Text>
        <View style={styles.text}>
          <Text style={styles.title}>
            {isEmergency ? 'Medical Emergency Detected' : 'Mental Health Support'}
          </Text>
          <Text style={styles.body}>
            {isEmergency
              ? 'Please call emergency services or go to the nearest hospital immediately.'
              : 'You don\'t have to go through this alone. A counsellor is available right now.'}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.callBtn, isEmergency ? styles.callEmergency : styles.callCrisis]}
          onPress={() => Linking.openURL(`tel:${isEmergency ? EMERGENCY_PHONE : CRISIS_PHONE}`)}
          accessibilityLabel={`Call ${isEmergency ? 'emergency services' : 'crisis helpline'}`}
        >
          <Text style={styles.callLabel}>
            {isEmergency ? 'Call 112' : 'Call iCall'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss}>
          <Text style={styles.dismissLabel}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    margin: SPACE.md,
    borderRadius: RADIUS.md,
    padding: SPACE.md,
    borderWidth: 1,
  },
  emergency: {
    backgroundColor: PAL.roseFaint,
    borderColor: PAL.roseBorder,
  },
  crisis: {
    backgroundColor: 'rgba(55,130,181,0.08)',
    borderColor: 'rgba(55,130,181,0.3)',
  },
  content: {flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm},
  icon: {fontSize: 24, marginTop: 2},
  text: {flex: 1},
  title: {fontWeight: '700', fontSize: 14, color: PAL.textDark, marginBottom: 4},
  body: {fontSize: 13, color: PAL.textMuted, lineHeight: 19},
  actions: {flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md},
  callBtn: {
    flex: 1, borderRadius: RADIUS.sm,
    paddingVertical: 10, alignItems: 'center',
  },
  callEmergency: {backgroundColor: PAL.rose},
  callCrisis:    {backgroundColor: '#3782b5'},
  callLabel:     {color: '#fff', fontWeight: '700', fontSize: 13},
  dismissBtn: {
    paddingHorizontal: SPACE.md, paddingVertical: 10,
    borderRadius: RADIUS.sm, borderWidth: 1, borderColor: PAL.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  dismissLabel: {fontFamily: FONT.mono, fontSize: 11, color: PAL.textMuted},
})
