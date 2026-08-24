/**
 * PAL Health API client — Android.
 *
 * All requests go through apiFetch() which injects the stored auth token.
 * PHI gate: personal-scope queries are scope-flagged; the backend enforces
 * consent checks before accessing records. The mobile client never sends raw PHI.
 *
 * Confirm-token gate: booking and clinic messaging are handled server-side.
 * Chat proposes; the write gate is enforced by the backend confirm-token system.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const API_BASE = process.env.PAL_API_URL ?? 'http://10.0.2.2:8000'

// ── Auth storage ──────────────────────────────────────────────────────────────

export async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem('pal_auth_token')
}

export async function setAuthToken(token: string): Promise<void> {
  await AsyncStorage.setItem('pal_auth_token', token)
}

export async function clearAuthToken(): Promise<void> {
  await AsyncStorage.removeItem('pal_auth_token')
}

export async function getMemberId(): Promise<string | null> {
  return AsyncStorage.getItem('pal_member_id')
}

export async function getTenantId(): Promise<string | null> {
  return AsyncStorage.getItem('pal_tenant_id')
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken()
  return token ? {Authorization: `Bearer ${token}`} : {}
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = await authHeaders()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {...headers, ...(init.headers as Record<string, string>)},
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`PAL API ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string
  member_id: string
  tenant_id: string
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email, password}),
  })
  await AsyncStorage.multiSet([
    ['pal_auth_token', res.access_token],
    ['pal_member_id', res.member_id],
    ['pal_tenant_id', res.tenant_id],
  ])
  return res
}

export async function logout(): Promise<void> {
  await AsyncStorage.multiRemove(['pal_auth_token', 'pal_member_id', 'pal_tenant_id'])
}

// ── Health records ────────────────────────────────────────────────────────────

export interface HealthFact {
  id: string
  type: string
  key: string
  value: string
  unit?: string | null
  recorded_at?: string | null
  evidence_class?: string
}

export async function getHealthFacts(): Promise<HealthFact[]> {
  return apiFetch<HealthFact[]>('/records/facts')
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface Citation {
  title: string
  url?: string
  source?: string
}

export interface SearchResult {
  answer_text: string
  citations: Citation[]
  conversation_id?: string
  thread_summary_for_router?: string
}

export async function search(
  query: string,
  sessionId: string,
  opts: {conversationId?: string; onDeviceClassificationJson?: string} = {},
): Promise<SearchResult> {
  return apiFetch<SearchResult>('/api/v1/search', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      query,
      session_id: sessionId,
      conversation_id: opts.conversationId,
      on_device_classification_json: opts.onDeviceClassificationJson,
      stream: false,
    }),
  })
}

// ── Credits ───────────────────────────────────────────────────────────────────

export interface CreditBalance {
  balance: number
  refill_at: string
  free_credits_per_day: number
  pack_options: Array<{id: string; credits: number; price_inr: number}>
}

export async function getCreditBalance(): Promise<CreditBalance> {
  return apiFetch<CreditBalance>('/credits/balance')
}

// ── Medical document upload (MDT pipeline) ────────────────────────────────────
//
// Two-step flow:
//   1. uploadMedicalDocument() → returns pending_verification
//      User sees VerificationSheet with extracted lab values + name match badge.
//   2. confirmMedicalDocument() → persists HealthFact rows after user approval.
//
// PHI invariant: document bytes never leave the PAL tenant boundary.
//   The backend stores the file content-addressed and forwards it only to
//   the MDT container running on the same host/network.

export interface MedicalDocObservation {
  loinc_code?: string | null
  display: string
  value?: string | null
  unit?: string | null
  reference_range?: string | null
  recorded_at?: string | null
}

export type NameMatchStatus = 'match' | 'partial' | 'no_match'

export type MedicalDocVerifyResult =
  | {
      type: 'pending_verification'
      raw_source_id: string
      filename: string
      patient_name_on_doc: string | null
      patient_name_on_profile: string | null
      name_match_status: NameMatchStatus
      report_title: string | null
      report_date: string | null
      observations: MedicalDocObservation[]
    }
  | {
      type: 'document_accepted'
      raw_source_id: string
      filename: string
      mdt_enabled: boolean
      mdt_error?: string
      message: string
    }
  | {
      type: 'unsupported_format'
      message: string
    }

/**
 * Upload a medical document (PDF / JPEG / PNG) to the MDT pipeline.
 * Accepts a file object from react-native-document-picker or react-native-image-picker.
 */
export async function uploadMedicalDocument(opts: {
  uri: string
  name: string
  type: string
}): Promise<MedicalDocVerifyResult> {
  const [tenantId, memberId] = await Promise.all([getTenantId(), getMemberId()])
  if (!tenantId || !memberId) throw new Error('Not signed in')

  const form = new FormData()
  form.append('file', {uri: opts.uri, name: opts.name, type: opts.type} as any)
  form.append('tenant_id', tenantId)
  form.append('member_id', memberId)

  const headers = await authHeaders()
  const res = await fetch(`${API_BASE}/medical/upload`, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Upload failed ${res.status}: ${body}`)
  }
  return res.json()
}

/**
 * Persist the verified health facts after the user approves the VerificationSheet.
 * Only called when the user taps "Save to my record" or "Save anyway".
 */
export async function confirmMedicalDocument(params: {
  rawSourceId: string
  observations: MedicalDocObservation[]
  reportDate?: string | null
}): Promise<{status: string; facts_count: number}> {
  const [tenantId, memberId] = await Promise.all([getTenantId(), getMemberId()])
  if (!tenantId || !memberId) throw new Error('Not signed in')

  return apiFetch('/medical/confirm', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      raw_source_id: params.rawSourceId,
      tenant_id: tenantId,
      member_id: memberId,
      observations: params.observations,
      report_date: params.reportDate ?? null,
    }),
  })
}
