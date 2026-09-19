import React, { useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, Animated } from 'react-native'
import { PAL, FONT, RADIUS, SPACE } from '../theme'

interface Props {
  visible: boolean
  doctorName: string
  appointmentLabel: string
  isConnecting: boolean
  onAccept: () => void
  onDecline: () => void
}

export default function HermesIncomingModal({
  visible, doctorName, appointmentLabel, isConnecting, onAccept, onDecline,
}: Props) {
  const dot1 = useRef(new Animated.Value(0)).current
  const dot2 = useRef(new Animated.Value(0)).current
  const dot3 = useRef(new Animated.Value(0)).current
  const ring = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) {
      dot1.setValue(0); dot2.setValue(0); dot3.setValue(0); ring.setValue(0)
      return
    }

    function bouncer(val: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 180, useNativeDriver: true }),
          Animated.delay(Math.max(0, 840 - delay * 2)),
        ]),
      )
    }
    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    )
    const a1 = bouncer(dot1, 0)
    const a2 = bouncer(dot2, 220)
    const a3 = bouncer(dot3, 440)
    a1.start(); a2.start(); a3.start(); ringLoop.start()
    return () => { a1.stop(); a2.stop(); a3.stop(); ringLoop.stop() }
  }, [visible])

  const dotStyle = (val: Animated.Value): object => ({
    transform: [{ translateY: val.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
  })

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* H badge with pulsing ring */}
          <View style={styles.badgeWrap}>
            <Animated.View style={[styles.ring, {
              opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
              transform: [{
                scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.65] }),
              }],
            }]} />
            <View style={styles.badge}>
              <Text style={styles.badgeH}>H</Text>
            </View>
          </View>

          <Text style={styles.callLabel}>Hermes is calling</Text>
          <View style={styles.dotsRow}>
            {[dot1, dot2, dot3].map((d, i) => (
              <Animated.Text key={i} style={[styles.dot, dotStyle(d)]}>.</Animated.Text>
            ))}
          </View>

          <Text style={styles.doctor}>{doctorName}</Text>
          <Text style={styles.appt}>{appointmentLabel}</Text>

          {isConnecting ? (
            <View style={styles.connectingWrap}>
              <Text style={styles.connectingText}>Connecting…</Text>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable style={styles.declineBtn} onPress={onDecline}>
                <Text style={styles.declineText}>Decline</Text>
              </Pressable>
              <Pressable style={styles.acceptBtn} onPress={onAccept}>
                <Text style={styles.acceptText}>Accept</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,36,41,0.88)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: PAL.navyMid,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: SPACE.xl,
    paddingBottom: 52,
    alignItems: 'center',
  },
  badgeWrap: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.lg,
  },
  ring: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: PAL.jade,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: PAL.jadeFaint,
    borderWidth: 1,
    borderColor: PAL.jadeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeH: {
    fontFamily: FONT.serif,
    fontSize: 26,
    color: PAL.jade,
    fontWeight: '700',
  },
  callLabel: {
    fontFamily: FONT.mono,
    fontSize: 16,
    fontWeight: '700',
    color: PAL.cream,
    letterSpacing: 0.3,
  },
  dotsRow: {
    flexDirection: 'row',
    marginBottom: SPACE.xl,
    height: 24,
    alignItems: 'flex-end',
  },
  dot: {
    fontFamily: FONT.mono,
    fontSize: 26,
    color: PAL.jade,
    lineHeight: 26,
  },
  doctor: {
    fontFamily: FONT.serif,
    fontSize: 22,
    color: PAL.cream,
    marginBottom: 4,
  },
  appt: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: PAL.creamMuted,
    marginBottom: SPACE.xl,
    textTransform: 'uppercase',
  },
  connectingWrap: { height: 52, justifyContent: 'center' },
  connectingText: {
    fontFamily: FONT.mono,
    fontSize: 13,
    color: PAL.jade,
  },
  actions: { flexDirection: 'row', gap: SPACE.md, width: '100%' },
  declineBtn: {
    flex: 1,
    backgroundColor: PAL.roseFaint,
    borderWidth: 1,
    borderColor: PAL.roseBorder,
    borderRadius: RADIUS.pill,
    paddingVertical: 17,
    alignItems: 'center',
  },
  declineText: { color: PAL.rose, fontWeight: '700', fontSize: 15 },
  acceptBtn: {
    flex: 1,
    backgroundColor: PAL.jade,
    borderRadius: RADIUS.pill,
    paddingVertical: 17,
    alignItems: 'center',
  },
  acceptText: { color: PAL.navyDeep, fontWeight: '700', fontSize: 15 },
})
