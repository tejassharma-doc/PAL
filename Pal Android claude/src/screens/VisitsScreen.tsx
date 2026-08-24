import React from 'react'
import {View, Text, StyleSheet, ScrollView, Pressable, Linking} from 'react-native'
import {SafeAreaView} from 'react-native-safe-area-context'
import {PAL, FONT, RADIUS, SPACE} from '../theme'

interface Visit {
  id: string
  clinic: string
  doctor: string
  date: string
  type: 'consultation' | 'followup' | 'lab'
  phone?: string
}

const MOCK_VISITS: Visit[] = [
  {id: '1', clinic: 'Apollo Clinic, Koramangala', doctor: 'Dr. Priya Nair', date: '2026-07-15', type: 'followup', phone: '+918041234567'},
  {id: '2', clinic: 'Metropolis Lab, Indiranagar', doctor: 'Lab Collection', date: '2026-07-10', type: 'lab'},
  {id: '3', clinic: 'Apollo Clinic, Koramangala', doctor: 'Dr. Priya Nair', date: '2026-06-12', type: 'consultation', phone: '+918041234567'},
]

const TYPE_LABEL: Record<Visit['type'], string> = {
  consultation: 'Consultation',
  followup: 'Follow-up',
  lab: 'Lab visit',
}

export default function VisitsScreen() {
  const upcoming = MOCK_VISITS.filter(v => new Date(v.date) >= new Date())
  const past     = MOCK_VISITS.filter(v => new Date(v.date) <  new Date())

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    })
  }

  function VisitCard({v}: {v: Visit}) {
    return (
      <View style={styles.card}>
        <View style={styles.cardLeft}>
          <Text style={styles.visitType}>{TYPE_LABEL[v.type]}</Text>
          <Text style={styles.clinic}>{v.clinic}</Text>
          <Text style={styles.doctor}>{v.doctor}</Text>
          <Text style={styles.date}>{formatDate(v.date)}</Text>
        </View>
        {v.phone && (
          <Pressable
            style={styles.callBtn}
            onPress={() => Linking.openURL(`tel:${v.phone}`)}
            accessibilityLabel={`Call ${v.clinic}`}
          >
            <Text style={styles.callIcon}>📞</Text>
          </Pressable>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Visits</Text>
        <Text style={styles.sub}>Upcoming appointments &amp; past clinic visits</Text>

        {upcoming.length > 0 && (
          <>
            <Text style={styles.groupLabel}>UPCOMING</Text>
            {upcoming.map(v => <VisitCard key={v.id} v={v} />)}
          </>
        )}

        {past.length > 0 && (
          <>
            <Text style={[styles.groupLabel, {marginTop: SPACE.lg}]}>PAST</Text>
            {past.map(v => <VisitCard key={v.id} v={v} />)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:    {flex: 1, backgroundColor: PAL.bg},
  scroll:  {flex: 1},
  content: {padding: SPACE.lg, paddingBottom: 100},
  heading: {
    fontFamily: FONT.serif, fontSize: 26, fontWeight: '300',
    color: PAL.textDark, marginBottom: 4,
  },
  sub: {
    fontFamily: FONT.mono, fontSize: 10, color: PAL.textMuted,
    marginBottom: SPACE.xl, textTransform: 'uppercase',
  },
  groupLabel: {
    fontFamily: FONT.mono, fontSize: 9, color: PAL.jade,
    textTransform: 'uppercase', marginBottom: SPACE.sm,
  },
  card: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: PAL.surfaceBorder,
    padding: SPACE.md, marginBottom: SPACE.sm,
    flexDirection: 'row', alignItems: 'center',
  },
  cardLeft:  {flex: 1},
  visitType: {fontFamily: FONT.mono, fontSize: 9, color: PAL.jade, textTransform: 'uppercase', marginBottom: 4},
  clinic:    {fontSize: 14, fontWeight: '600', color: PAL.textDark},
  doctor:    {fontSize: 13, color: PAL.textMuted, marginTop: 2},
  date:      {fontFamily: FONT.mono, fontSize: 10, color: PAL.textFaint, marginTop: 4},
  callBtn:   {paddingLeft: SPACE.md},
  callIcon:  {fontSize: 24},
})
