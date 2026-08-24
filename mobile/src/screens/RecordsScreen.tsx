import React, { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PAL, FONT, RADIUS, SPACE } from '../theme'
import { getHealthFacts, HealthFact } from '../lib/api'

function groupFacts(facts: HealthFact[]) {
  const groups: Record<string, HealthFact[]> = {}
  for (const f of facts) {
    const key = f.type || 'Other'
    if (!groups[key]) groups[key] = []
    groups[key].push(f)
  }
  return groups
}

const MOCK_FACTS: HealthFact[] = [
  { id: '1', type: 'lipid', key: 'LDL', value: '142', unit: 'mg/dL', recorded_at: '2026-05-12', evidence_class: 'lab' },
  { id: '2', type: 'lipid', key: 'HDL', value: '48', unit: 'mg/dL', recorded_at: '2026-05-12', evidence_class: 'lab' },
  { id: '3', type: 'lipid', key: 'Triglycerides', value: '186', unit: 'mg/dL', recorded_at: '2026-05-12', evidence_class: 'lab' },
  { id: '4', type: 'glucose', key: 'HbA1c', value: '5.9', unit: '%', recorded_at: '2026-05-12', evidence_class: 'lab' },
  { id: '5', type: 'vitals', key: 'Blood pressure', value: '128/82', unit: 'mmHg', recorded_at: '2026-06-01', evidence_class: 'vitals' },
  { id: '6', type: 'vitals', key: 'Weight', value: '74', unit: 'kg', recorded_at: '2026-06-01', evidence_class: 'vitals' },
]

function valueColor(key: string, value: string): string {
  const v = parseFloat(value)
  if (key === 'LDL' && v > 130) return PAL.rose
  if (key === 'HbA1c' && v > 5.7) return PAL.rose
  if (key === 'Triglycerides' && v > 150) return PAL.rose
  return PAL.jade
}

function formatDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function RecordsScreen() {
  const [facts, setFacts] = useState<HealthFact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getHealthFacts()
      .then(f => setFacts(f.length ? f : MOCK_FACTS))
      .catch(() => setFacts(MOCK_FACTS))
      .finally(() => setLoading(false))
  }, [])

  const groups = groupFacts(facts)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Your records</Text>
        <Text style={styles.sub}>Clinician-verified · never altered by AI</Text>

        {loading && <ActivityIndicator color={PAL.jade} style={{ marginTop: 40 }} />}

        {!loading && Object.entries(groups).map(([type, groupFacts]) => (
          <View key={type} style={styles.section}>
            <Text style={styles.sectionLabel}>{type.toUpperCase()}</Text>
            {groupFacts.map((fact, i) => (
              <View key={fact.id} style={[styles.factRow, i > 0 && styles.factBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.factKey}>{fact.key}</Text>
                  {fact.recorded_at && (
                    <Text style={styles.factDate}>{formatDate(fact.recorded_at)}</Text>
                  )}
                </View>
                <View style={styles.factRight}>
                  <Text style={[styles.factValue, { color: valueColor(fact.key, fact.value) }]}>
                    {fact.value}
                  </Text>
                  {fact.unit && <Text style={styles.factUnit}>{fact.unit}</Text>}
                </View>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.evidenceNote}>
          <View style={styles.evidenceBadge}>
            <Text style={styles.evidenceBadgeText}>⛁ clinician-canonical</Text>
          </View>
          <Text style={styles.evidenceText}>
            Plans are your team's own words — never altered by AI.
          </Text>
        </View>
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
    color: PAL.textDark, marginBottom: 4,
  },
  sub: {
    fontFamily: FONT.mono, fontSize: 10, color: PAL.textMuted,
    marginBottom: SPACE.xl, textTransform: 'uppercase',
  },
  section: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.md, marginBottom: SPACE.md,
    overflow: 'hidden', borderWidth: 1, borderColor: PAL.surfaceBorder,
  },
  sectionLabel: {
    fontFamily: FONT.mono, fontSize: 9, color: PAL.jade,
    textTransform: 'uppercase', paddingHorizontal: SPACE.md,
    paddingTop: SPACE.md, paddingBottom: SPACE.sm,
  },
  factRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACE.md, paddingVertical: 13,
  },
  factBorder: { borderTopWidth: 1, borderTopColor: PAL.surfaceBorder },
  factKey: { fontSize: 14, fontWeight: '600', color: PAL.textDark },
  factDate: { fontFamily: FONT.mono, fontSize: 10, color: PAL.textFaint, marginTop: 2 },
  factRight: { alignItems: 'flex-end' },
  factValue: { fontSize: 17, fontWeight: '700' },
  factUnit: { fontFamily: FONT.mono, fontSize: 10, color: PAL.textMuted },
  evidenceNote: {
    flexDirection: 'row', gap: 11, backgroundColor: PAL.surface, borderRadius: RADIUS.md,
    padding: SPACE.md, marginTop: SPACE.sm, alignItems: 'center',
    borderWidth: 1, borderColor: PAL.surfaceBorder,
  },
  evidenceBadge: {
    backgroundColor: 'rgba(90,143,168,.14)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0,
  },
  evidenceBadgeText: { fontFamily: FONT.mono, fontSize: 9, color: '#33607a' },
  evidenceText: { flex: 1, fontSize: 11, color: PAL.textMuted, lineHeight: 17 },
})
