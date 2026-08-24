/**
 * PAL mobile API client.
 * Mirrors web/lib/api.ts — AsyncStorage instead of localStorage,
 * base URL points to Android-emulator localhost (10.0.2.2) in dev.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

// Android emulator → host localhost.  Change to your LAN IP for device testing.
const API_BASE = __DEV__ ? 'http://10.0.2.2:8000' : 'https://api.palhealth.app'

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('pal_token')
}
async function getMemberId(): Promise<string | null> {
  return AsyncStorage.getItem('pal_user_id')
}
async function getLang(): Promise<string> {
  return (await AsyncStorage.getItem('pal_lang')) ?? 'en'
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = await authHeaders()
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  })
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AppointmentSlot {
  slot_id: string
  doctor_id: string
  doctor_name: string
  clinic: string
  datetime: string
  duration_minutes: number
  available: boolean
}

export interface CallSession {
  session_id: string
  status: 'ringing' | 'active' | 'ended' | 'missed'
  hermes_response?: string
  call_state: string
  call_ended: boolean
  available_slots?: AppointmentSlot[]
  appointment_agreed?: boolean
  slot_id?: string | null
  booking_done?: boolean
}

export interface SearchResult {
  answer_text: string
  citations: Array<{ title: string; source: string; url?: string }>
  provenance_summary: string
  pending_actions?: Array<{
    type: string
    description: string
    confirm_token_required: boolean
    confirm_token?: string
    action_payload?: Record<string, unknown>
  }>
  clinical_disagreement?: string | null
  conversation_id?: string | null
  thread_summary_for_router?: string | null
}

export interface HealthFact {
  id: string
  type: string
  key: string
  value: string
  unit: string | null
  recorded_at: string | null
  evidence_class: string
}

export interface ConversationSummary {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

// ── Calls ──────────────────────────────────────────────────────────────────────

export async function initiateCall(params: {
  doctorId: string
  doctorName: string
  patientName?: string
  appointmentReason?: string
}): Promise<CallSession> {
  const memberId = (await getMemberId()) ?? DEFAULT_TENANT_ID
  const res = await apiFetch('/calls/initiate', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId,
      doctor_id: params.doctorId,
      doctor_name: params.doctorName,
      patient_name: params.patientName,
      appointment_reason: params.appointmentReason ?? null,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail ?? `Call error ${res.status}`)
  }
  return res.json()
}

export async function sendCallTurn(
  sessionId: string,
  patientInput: string,
): Promise<CallSession> {
  const memberId = (await getMemberId()) ?? DEFAULT_TENANT_ID
  const res = await apiFetch(`/calls/${sessionId}/turn`, {
    method: 'POST',
    body: JSON.stringify({
      patient_input: patientInput,
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail ?? `Turn error ${res.status}`)
  }
  return res.json()
}

export async function endCall(sessionId: string): Promise<void> {
  const memberId = (await getMemberId()) ?? DEFAULT_TENANT_ID
  await apiFetch(
    `/calls/${sessionId}/end?tenant_id=${DEFAULT_TENANT_ID}&member_id=${memberId}`,
    { method: 'POST' },
  ).catch(() => {})
}

// ── Search ─────────────────────────────────────────────────────────────────────

export async function search(
  query: string,
  sessionId: string,
  opts: { conversationId?: string; onDeviceClassificationJson?: string } = {},
): Promise<SearchResult> {
  const memberId = await getMemberId()
  const res = await apiFetch('/search', {
    method: 'POST',
    body: JSON.stringify({
      query,
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId ?? undefined,
      session_id: sessionId,
      conversation_id: opts.conversationId ?? null,
      on_device_classification_json: opts.onDeviceClassificationJson ?? null,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail ?? `Search error ${res.status}`)
  }
  const data = await res.json()
  if (data.type === 'answer') {
    return { ...data.answer, conversation_id: data.conversation_id ?? null }
  }
  throw new Error('Unexpected search response')
}

// ── Records ────────────────────────────────────────────────────────────────────

export async function getHealthFacts(): Promise<HealthFact[]> {
  const memberId = await getMemberId()
  if (!memberId) return []
  const res = await apiFetch(`/records/${DEFAULT_TENANT_ID}/${memberId}/facts`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.facts ?? []) as HealthFact[]
}

// ── Conversations ──────────────────────────────────────────────────────────────

export async function listConversations(): Promise<ConversationSummary[]> {
  const memberId = await getMemberId()
  if (!memberId) return []
  const res = await apiFetch(`/conversations/${DEFAULT_TENANT_ID}/${memberId}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.conversations ?? []) as ConversationSummary[]
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export async function signIn(params: {
  email?: string
  phone?: string
  password: string
}): Promise<{ token: string; user_id: string }> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error('Login failed')
  const data = await res.json()
  await AsyncStorage.multiSet([
    ['pal_token', data.token],
    ['pal_user_id', data.user_id],
  ])
  return data
}

export async function signOut(): Promise<void> {
  await AsyncStorage.multiRemove(['pal_token', 'pal_user_id'])
}

export { getLang }
