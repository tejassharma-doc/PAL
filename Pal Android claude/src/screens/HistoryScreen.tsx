import React from 'react'
import {View, Text, StyleSheet, ScrollView} from 'react-native'
import {SafeAreaView} from 'react-native-safe-area-context'
import {PAL, FONT, RADIUS, SPACE} from '../theme'

interface HistoryItem {
  id: string
  query: string
  date: string
  summary: string
}

const MOCK_HISTORY: HistoryItem[] = [
  {id: '1', query: 'What is my LDL?', date: '2026-06-30', summary: 'LDL is 142 mg/dL — borderline high. Consider statin therapy review with your cardiologist.'},
  {id: '2', query: 'Lipid panel interpretation', date: '2026-06-15', summary: 'HDL 48, Triglycerides 186. Overall cardiovascular risk moderate based on Framingham score.'},
  {id: '3', query: 'Prepare for lipid blood test', date: '2026-06-01', summary: 'Fast 9–12 hours before the test. Avoid strenuous exercise the day before.'},
]

export default function HistoryScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>History</Text>
        <Text style={styles.sub}>Your past PAL conversations</Text>

        {MOCK_HISTORY.map(item => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.query} numberOfLines={1}>{item.query}</Text>
              <Text style={styles.date}>
                {new Date(item.date).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'})}
              </Text>
            </View>
            <Text style={styles.summary} numberOfLines={3}>{item.summary}</Text>
          </View>
        ))}

        <Text style={styles.note}>
          Showing last 30 days. Older conversations are deleted for privacy.
        </Text>
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
  card: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: PAL.surfaceBorder,
    padding: SPACE.md, marginBottom: SPACE.sm,
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACE.sm,
  },
  query: {flex: 1, fontSize: 14, fontWeight: '600', color: PAL.textDark, marginRight: SPACE.sm},
  date:  {fontFamily: FONT.mono, fontSize: 10, color: PAL.textFaint},
  summary: {fontSize: 13, color: PAL.textMuted, lineHeight: 20},
  note: {
    fontFamily: FONT.mono, fontSize: 10, color: PAL.textFaint,
    textAlign: 'center', marginTop: SPACE.lg,
  },
})
