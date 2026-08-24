/**
 * AgentStreamCard — displays a streaming partial result from one cloud agent.
 *
 * The card shows:
 *   - Agent label + icon
 *   - Streaming text (appended as chunks arrive via SSE or WebSocket)
 *   - Citation list (evidence agent only)
 *   - Loading shimmer while awaiting first chunk
 *   - Error state if the agent fails
 */

import React, {useRef, useEffect} from 'react'
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Animated,
} from 'react-native'
import type {AgentName} from '@services/fuguRouter'

export type AgentCardStatus = 'loading' | 'streaming' | 'done' | 'error'

export interface Citation {
  title: string
  url?: string
}

interface Props {
  agent: AgentName
  status: AgentCardStatus
  text: string
  citations?: Citation[]
  errorMessage?: string
}

const AGENT_META: Record<AgentName, {label: string; icon: string; color: string}> = {
  records:     {label: 'Health Records',  icon: '📋', color: '#4CAF50'},
  medication:  {label: 'Medication',      icon: '💊', color: '#2196F3'},
  appointment: {label: 'Appointments',   icon: '📅', color: '#FF9800'},
  diet:        {label: 'Nutrition',       icon: '🥗', color: '#8BC34A'},
  evidence:    {label: 'Research',        icon: '🔬', color: '#9C27B0'},
}

export function AgentStreamCard({agent, status, text, citations, errorMessage}: Props): React.JSX.Element {
  const meta = AGENT_META[agent]
  const shimmerAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (status !== 'loading') return
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {toValue: 1, duration: 800, useNativeDriver: true}),
        Animated.timing(shimmerAnim, {toValue: 0, duration: 800, useNativeDriver: true}),
      ])
    ).start()
  }, [status, shimmerAnim])

  const shimmerOpacity = shimmerAnim.interpolate({inputRange: [0, 1], outputRange: [0.3, 0.7]})

  return (
    <View style={[styles.card, {borderLeftColor: meta.color}]}>
      <View style={styles.header}>
        <Text style={styles.icon}>{meta.icon}</Text>
        <Text style={[styles.label, {color: meta.color}]}>{meta.label}</Text>
        {status === 'loading' && <ActivityIndicator size="small" color={meta.color} style={styles.spinner} />}
        {status === 'done' && <Text style={styles.done}>✓</Text>}
        {status === 'error' && <Text style={styles.errorBadge}>!</Text>}
      </View>

      {status === 'loading' && (
        <Animated.View style={[styles.shimmer, {opacity: shimmerOpacity}]} />
      )}

      {(status === 'streaming' || status === 'done') && text ? (
        <Text style={styles.body}>{text}</Text>
      ) : null}

      {status === 'error' && (
        <Text style={styles.errorText}>{errorMessage ?? 'Something went wrong. Please try again.'}</Text>
      )}

      {citations && citations.length > 0 && (
        <View style={styles.citations}>
          <Text style={styles.citationsHeader}>Sources</Text>
          {citations.map((c, i) => (
            <Text key={i} style={styles.citationItem}>
              {i + 1}. {c.title}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 2},
    elevation: 2,
  },
  header: {flexDirection: 'row', alignItems: 'center', marginBottom: 8},
  icon: {fontSize: 16, marginRight: 6},
  label: {fontWeight: '700', fontSize: 13, flex: 1},
  spinner: {marginLeft: 4},
  done: {color: '#4CAF50', fontWeight: '700', fontSize: 14},
  errorBadge: {
    color: '#fff', backgroundColor: '#ff4d4f', borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2, fontSize: 12, fontWeight: '700',
  },
  shimmer: {
    height: 12, borderRadius: 6, backgroundColor: '#e0e0e0', marginBottom: 6,
  },
  body: {fontSize: 14, color: '#1a1a1a', lineHeight: 21},
  errorText: {fontSize: 13, color: '#ff4d4f'},
  citations: {marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0'},
  citationsHeader: {fontSize: 11, color: '#888', fontWeight: '600', marginBottom: 4},
  citationItem: {fontSize: 12, color: '#555', marginBottom: 2},
})
