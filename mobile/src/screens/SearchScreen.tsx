/**
 * SearchScreen — conversational health search wired to FuguRouter.
 *
 * Flow per turn:
 *   1. User types query → SearchBar.onSubmit
 *   2. FuguRouter.route() — one ONNX forward pass (on-device, ~50 ms)
 *   3a. depth === 'on_device': render trivial answer locally, zero API calls
 *   3b. depth === 'one'|'many'|'launch_hermes': POST classification JSON to
 *       /api/v1/search with agents_to_invoke — backend streams results via SSE
 *   4. AgentStreamCard per agent renders streamed chunks as they arrive
 *   5. SafetyBanner for emergency/crisis short-circuits
 *   6. API response carries thread_summary_for_router → updateThreadSummary()
 *
 * PHI gate: personal-scope queries pass through api/phi/ egress gate on the
 *   backend. The mobile client never sends raw PHI — it sends a scope flag
 *   and the backend enforces consent checks before accessing records.
 *
 * Confirm-token gate: booking/messaging depth=launch_hermes results in a
 *   confirm-token prompt in the UI before any write action is dispatched.
 */

import React, {useCallback, useEffect, useRef, useState} from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {useRoute, useNavigation, RouteProp} from '@react-navigation/native'

import {SearchBar} from '@components/SearchBar'
import {AgentStreamCard, AgentCardStatus, Citation} from '@components/AgentStreamCard'
import {SafetyBanner} from '@components/SafetyBanner'

import {route as fuguRoute, updateThreadSummary, initFuguRouter} from '@services/fuguRouter'
import type {AgentName, RouterDecision, OnDeviceClassificationJson} from '@services/fuguRouter'

import {RootStackParamList} from '@navigation/AppNavigator'

// ── Types ──────────────────────────────────────────────────────────────────

type SearchRouteProps = RouteProp<RootStackParamList, 'Search'>

interface AgentResult {
  id: string
  agent: AgentName
  status: AgentCardStatus
  text: string
  citations: Citation[]
  errorMessage?: string
}

interface TurnMessage {
  id: string
  role: 'user' | 'assistant'
  // user turn
  query?: string
  // assistant turn
  agents?: AgentResult[]
  onDeviceAnswer?: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const API_BASE = process.env.PAL_API_URL ?? 'http://localhost:8000'
const UNIVERSAL_SEARCH = process.env.UNIVERSAL_SEARCH === 'true'

// ── Screen ─────────────────────────────────────────────────────────────────

export function SearchScreen(): React.JSX.Element {
  const route = useRoute<SearchRouteProps>()
  const navigation = useNavigation()

  const conversationId = useRef<string | undefined>(route.params?.conversationId)
  const [turns, setTurns] = useState<TurnMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [routerReady, setRouterReady] = useState(false)
  const [safetyVisible, setSafetyVisible] = useState(false)
  const [safetyCategory, setSafetyCategory] = useState<'emergency' | 'crisis'>('emergency')
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    initFuguRouter().then(() => setRouterReady(true))
  }, [])

  function addUserTurn(query: string): string {
    const id = `user_${Date.now()}`
    setTurns(prev => [...prev, {id, role: 'user', query}])
    return id
  }

  function addAssistantTurn(agents: AgentResult[], onDeviceAnswer?: string): string {
    const id = `assistant_${Date.now()}`
    setTurns(prev => [...prev, {id, role: 'assistant', agents, onDeviceAnswer}])
    return id
  }

  function updateAgentResult(turnId: string, agentId: string, patch: Partial<AgentResult>): void {
    setTurns(prev => prev.map(t => {
      if (t.id !== turnId || !t.agents) return t
      return {
        ...t,
        agents: t.agents.map(a => a.id === agentId ? {...a, ...patch} : a),
      }
    }))
  }

  async function streamAgentResults(
    turnId: string,
    agentResults: AgentResult[],
    classJson: OnDeviceClassificationJson,
    query: string,
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/api/v1/search`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        query,
        conversation_id: conversationId.current,
        on_device_classification_json: classJson,
        agents_to_invoke: classJson.needs_action ? [] : agentResults.map(a => a.agent),
        stream: true,
      }),
    })

    if (!res.ok || !res.body) {
      agentResults.forEach(a => {
        updateAgentResult(turnId, a.id, {status: 'error', errorMessage: 'Server error. Please try again.'})
      })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      buffer += decoder.decode(value, {stream: true})
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const data = JSON.parse(line.slice(6))

          if (data.type === 'agent_chunk') {
            const agent = agentResults.find(a => a.agent === data.agent)
            if (agent) {
              updateAgentResult(turnId, agent.id, {
                status: 'streaming',
                text: agent.text + data.chunk,
              })
            }
          }

          if (data.type === 'agent_done') {
            const agent = agentResults.find(a => a.agent === data.agent)
            if (agent) {
              updateAgentResult(turnId, agent.id, {
                status: 'done',
                citations: data.citations ?? [],
              })
            }
          }

          if (data.type === 'conversation_id' && data.conversation_id) {
            conversationId.current = data.conversation_id
          }

          if (data.type === 'thread_summary' && data.thread_summary_for_router) {
            if (conversationId.current) {
              updateThreadSummary(conversationId.current, data.thread_summary_for_router)
            }
          }

          if (data.type === 'done') {
            // Mark any still-loading agents as done
            agentResults.forEach(a => {
              updateAgentResult(turnId, a.id, {status: 'done'})
            })
          }

          if (data.type === 'error') {
            agentResults.forEach(a => {
              updateAgentResult(turnId, a.id, {
                status: 'error',
                errorMessage: data.message ?? 'An error occurred.',
              })
            })
          }
        } catch {
          // Malformed SSE line — skip
        }
      }
    }
  }

  const handleSubmit = useCallback(async (query: string) => {
    if (!routerReady || isLoading || !UNIVERSAL_SEARCH) return
    setIsLoading(true)
    addUserTurn(query)

    try {
      const decision: RouterDecision = await fuguRoute(
        {query, thread_summary: '', session_id: 'session', conversation_id: conversationId.current},
      )

      // Safety short-circuit
      if (decision.safety_short_circuit) {
        setSafetyCategory(decision.classification.safety_category as 'emergency' | 'crisis')
        setSafetyVisible(true)
        setIsLoading(false)
        return
      }

      // Trivial on-device answer — no API call
      if (decision.depth === 'on_device') {
        addAssistantTurn([], decision.on_device_answer)
        setIsLoading(false)
        return
      }

      // Disambiguation required
      if (decision.requires_disambiguation) {
        addAssistantTurn([{
          id: `disambig_${Date.now()}`,
          agent: 'evidence',
          status: 'done',
          text: 'Are you asking about your own health records, or general health information?',
          citations: [],
        }])
        setIsLoading(false)
        return
      }

      // Cloud dispatch — build agent cards in loading state
      const agentResults: AgentResult[] = decision.agents_to_invoke.map(agent => ({
        id: `${agent}_${Date.now()}`,
        agent,
        status: 'loading',
        text: '',
        citations: [],
      }))

      const turnId = addAssistantTurn(agentResults)

      const classJson: OnDeviceClassificationJson = {
        intents: decision.classification.intents,
        scope: decision.classification.scope,
        scope_confidence: decision.classification.scope_confidence,
        complexity: decision.classification.complexity,
        needs_action: decision.classification.needs_action,
        safety_category: decision.classification.safety_category,
        multilingual_lang: decision.classification.multilingual_lang,
      }

      await streamAgentResults(turnId, agentResults, classJson, query)
    } catch (err) {
      addAssistantTurn([{
        id: `err_${Date.now()}`,
        agent: 'evidence',
        status: 'error',
        text: '',
        citations: [],
        errorMessage: 'Could not reach PAL. Please check your connection.',
      }])
    } finally {
      setIsLoading(false)
      listRef.current?.scrollToEnd({animated: true})
    }
  }, [routerReady, isLoading])

  function renderTurn({item}: {item: TurnMessage}): React.JSX.Element {
    if (item.role === 'user') {
      return (
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{item.query}</Text>
        </View>
      )
    }
    if (item.onDeviceAnswer) {
      return (
        <View style={styles.onDeviceBubble}>
          <Text style={styles.onDeviceText}>{item.onDeviceAnswer}</Text>
        </View>
      )
    }
    return (
      <View>
        {item.agents?.map(a => (
          <AgentStreamCard
            key={a.id}
            agent={a.agent}
            status={a.status}
            text={a.text}
            citations={a.citations}
            errorMessage={a.errorMessage}
          />
        ))}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        {!routerReady && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Loading on-device model…</Text>
          </View>
        )}

        {!UNIVERSAL_SEARCH && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Universal Search is disabled. Set UNIVERSAL_SEARCH=true to enable.
            </Text>
          </View>
        )}

        <FlatList
          ref={listRef}
          data={turns}
          keyExtractor={t => t.id}
          renderItem={renderTurn}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
        />

        <SearchBar
          onSubmit={handleSubmit}
          isLoading={isLoading || !routerReady}
          placeholder="Ask about your health…"
        />
      </KeyboardAvoidingView>

      <SafetyBanner
        visible={safetyVisible}
        category={safetyCategory}
        onDismiss={() => setSafetyVisible(false)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fafafa'},
  flex: {flex: 1},
  list: {padding: 16, paddingBottom: 8},
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#1677ff',
    borderRadius: 14,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    maxWidth: '80%',
  },
  userText: {color: '#fff', fontSize: 15},
  onDeviceBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  onDeviceText: {color: '#1a1a1a', fontSize: 15},
  banner: {
    backgroundColor: '#fff7e6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ffe58f',
  },
  bannerText: {fontSize: 13, color: '#ad6800'},
})
