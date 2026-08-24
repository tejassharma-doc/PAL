export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('pal_token')
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function getMemberId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('pal_user_id')
}

// ── Search ─────────────────────────────────────────────────────────────────────

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

export async function search(
  query: string,
  sessionId: string,
  opts: {
    consentBasis?: string
    memberId?: string
    conversationId?: string
    onDeviceClassificationJson?: string
  } = {},
): Promise<SearchResult> {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      query,
      tenant_id: DEFAULT_TENANT_ID,
      member_id: opts.memberId || undefined,
      session_id: sessionId,
      consent_basis: opts.consentBasis || null,
      conversation_id: opts.conversationId || null,
      on_device_classification_json: opts.onDeviceClassificationJson || null,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Search error ${res.status}`)
  }

  const data = await res.json()
  if (data.type === 'answer') {
    return {
      ...(data.answer as SearchResult),
      conversation_id: data.conversation_id ?? null,
      thread_summary_for_router: data.thread_summary_for_router ?? null,
    }
  }
  throw new Error('Unexpected response from search endpoint')
}

export async function secondOpinion(
  query: string,
  sessionId: string,
  conversationId: string | null,
  opts: { memberId?: string } = {},
): Promise<SearchResult> {
  const res = await fetch('/api/search/second-opinion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      query,
      tenant_id: DEFAULT_TENANT_ID,
      member_id: opts.memberId || undefined,
      session_id: sessionId,
      conversation_id: conversationId || null,
      is_second_opinion: true,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Second opinion error ${res.status}`)
  }
  const data = await res.json()
  if (data.type === 'answer') {
    return {
      ...(data.answer as SearchResult),
      conversation_id: data.conversation_id ?? null,
      thread_summary_for_router: data.thread_summary_for_router ?? null,
    }
  }
  throw new Error('Unexpected response from second-opinion endpoint')
}

// ── Confirm action ─────────────────────────────────────────────────────────────

export interface ConfirmActionPayload {
  actionType: string
  actionPayload: Record<string, unknown>
  confirmToken: string
  sessionId: string
}

export interface ConfirmResult {
  status: string
  appointment_request_id?: string
  message?: string
}

export async function confirmAction(req: ConfirmActionPayload): Promise<ConfirmResult> {
  const memberId = getMemberId()
  const res = await fetch('/api/search/confirm-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId || undefined,
      session_id: req.sessionId,
      action_type: req.actionType,
      action_payload: req.actionPayload,
      confirm_token: req.confirmToken,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Confirm error ${res.status}`)
  }
  return res.json()
}

// ── Conversations ──────────────────────────────────────────────────────────────

export interface ConversationSummary {
  id: string
  title: string | null
  scope_tag: string | null
  created_at: string
  updated_at: string
}

export interface ConversationTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  scope: string | null
  contains_phi: boolean
  created_at: string
  citations?: Array<{ title: string; source: string; url?: string }> | null
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const memberId = getMemberId()
  if (!memberId) return []
  const res = await fetch(`/api/conversations/${DEFAULT_TENANT_ID}/${memberId}`, {
    headers: authHeaders(),
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.conversations || []) as ConversationSummary[]
}

export async function getConversationTurns(conversationId: string): Promise<ConversationTurn[]> {
  const memberId = getMemberId()
  if (!memberId) return []
  const res = await fetch(
    `/api/conversations/${DEFAULT_TENANT_ID}/${memberId}/${conversationId}/turns`,
    { headers: authHeaders() },
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data.turns || []) as ConversationTurn[]
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const memberId = getMemberId()
  if (!memberId) return
  await fetch(
    `/api/conversations/${DEFAULT_TENANT_ID}/${memberId}/${conversationId}`,
    { method: 'DELETE', headers: authHeaders() },
  )
}

// ── Upload (generic) ───────────────────────────────────────────────────────────

export interface UploadResult {
  type: 'document_accepted' | 'imaging_declined' | 'unsupported_format'
  raw_source_id?: string
  filename?: string
  message: string
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const memberId = getMemberId() || ''
  const form = new FormData()
  form.append('file', file)
  form.append('tenant_id', DEFAULT_TENANT_ID)
  form.append('member_id', memberId)
  const res = await fetch('/api/records/upload', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Upload error ${res.status}`)
  }
  return res.json()
}

// ── Medical document — MDT FHIR extraction ─────────────────────────────────────

export interface MedicalDocObservation {
  loinc_code: string | null
  display: string
  value: string | null
  unit: string | null
  reference_range: string | null
  recorded_at: string | null
}

export interface MedicalDocVerifyResult {
  type: 'pending_verification' | 'document_accepted' | 'unsupported_format'
  raw_source_id?: string
  filename?: string
  patient_name_on_doc?: string | null
  patient_name_on_profile?: string | null
  name_match_status?: 'match' | 'partial' | 'no_match'
  report_title?: string | null
  report_date?: string | null
  observations?: MedicalDocObservation[]
  mdt_enabled?: boolean
  message?: string
}

export async function uploadMedicalDocument(file: File): Promise<MedicalDocVerifyResult> {
  const memberId = getMemberId() || ''
  const form = new FormData()
  form.append('file', file)
  form.append('tenant_id', DEFAULT_TENANT_ID)
  form.append('member_id', memberId)
  const res = await fetch('/api/medical/upload', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Medical upload error ${res.status}`)
  }
  return res.json()
}

export async function confirmMedicalDocument(params: {
  rawSourceId: string
  observations: MedicalDocObservation[]
  reportDate: string | null
  reportTitle?: string | null
  fhirBundle?: any | null
}): Promise<{ status: string; facts_count: number; lab_test_id?: string }> {
  const memberId = getMemberId() || ''
  const res = await fetch('/api/medical/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      raw_source_id: params.rawSourceId,
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId,
      observations: params.observations,
      report_date: params.reportDate,
      report_title: params.reportTitle,
      fhir_bundle: params.fhirBundle,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Confirm error ${res.status}`)
  }
  return res.json()
}

// ── Appointment / Voice booking ────────────────────────────────────────────────

export interface AppointmentSlot {
  slot_id: string
  doctor_id: string
  doctor_name: string
  clinic: string
  datetime: string
  duration_minutes: number
  available: boolean
}

export interface VoiceBookingResult {
  proposed_actions: Array<{
    type: string
    description: string
    confirm_token_required: boolean
    confirm_token?: string
    action_payload?: Record<string, unknown>
  }>
  available_slots: AppointmentSlot[]
  agent_output?: string
}

export async function voiceBooking(
  transcript: string,
  sessionId: string,
  preferredLang?: string,
): Promise<VoiceBookingResult> {
  const memberId = getMemberId()
  const res = await fetch('/api/appointment/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      transcript,
      session_id: sessionId,
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId || undefined,
      preferred_lang: preferredLang || null,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Voice booking error ${res.status}`)
  }
  return res.json()
}

export async function bookAppointment(params: {
  slotId: string
  reason: string
  confirmToken: string
  sessionId: string
}): Promise<{ message: string; booking?: Record<string, unknown> }> {
  const memberId = getMemberId()
  const res = await fetch('/api/appointment/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      slot_id: params.slotId,
      reason: params.reason,
      confirm_token: params.confirmToken,
      session_id: params.sessionId,
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId || undefined,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Booking error ${res.status}`)
  }
  return res.json()
}

export async function sendClinicMessage(params: {
  doctorId: string
  messageText: string
  confirmToken: string
  sessionId: string
}): Promise<{ message: string }> {
  const memberId = getMemberId()
  const res = await fetch('/api/appointment/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      doctor_id: params.doctorId,
      message_text: params.messageText,
      confirm_token: params.confirmToken,
      session_id: params.sessionId,
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId || undefined,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Message error ${res.status}`)
  }
  return res.json()
}

// ── Hermes Voice Call (A2A multi-agent) ───────────────────────────────────────

export interface CallTurn {
  role: 'hermes' | 'patient'
  content: string
  docehr_queries?: Array<{
    query_type: string
    params: Record<string, unknown>
    response: string
  }>
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
  docehr_queries?: CallTurn['docehr_queries']
}

export async function initiateCall(params: {
  doctorId: string
  doctorName: string
  patientName?: string
  appointmentReason?: string
}): Promise<CallSession> {
  const memberId = getMemberId() || ''
  const res = await fetch('/api/calls/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId || DEFAULT_TENANT_ID,
      doctor_id: params.doctorId,
      doctor_name: params.doctorName,
      patient_name: params.patientName,
      appointment_reason: params.appointmentReason ?? null,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Call initiate error ${res.status}`)
  }
  return res.json()
}

export async function sendCallTurn(
  sessionId: string,
  patientInput: string,
): Promise<CallSession> {
  const memberId = getMemberId() || ''
  const res = await fetch(`/api/calls/${sessionId}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      patient_input: patientInput,
      tenant_id: DEFAULT_TENANT_ID,
      member_id: memberId || DEFAULT_TENANT_ID,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Call turn error ${res.status}`)
  }
  return res.json()
}

export async function endCall(sessionId: string): Promise<{ status: string }> {
  const memberId = getMemberId() || ''
  const res = await fetch(
    `/api/calls/${sessionId}/end?tenant_id=${DEFAULT_TENANT_ID}&member_id=${memberId || DEFAULT_TENANT_ID}`,
    { method: 'POST', headers: authHeaders() },
  )
  if (!res.ok) return { status: 'error' }
  return res.json()
}

// ── Consent + Family ──────────────────────────────────────────────────────────

export interface FamilyMember {
  user_id: string
  name: string
  relation: string
  scope: string | null
  grant_id: string | null
}

export async function listFamilyMembers(): Promise<FamilyMember[]> {
  const res = await fetch('/api/consent/family', { headers: authHeaders() })
  if (!res.ok) return []
  const data = await res.json()
  return (data.members || []) as FamilyMember[]
}

export async function grantConsent(params: {
  grantee_user_id: string
  scope: string
  basis: string
  expires_at?: string
}): Promise<{ id: string; granted_at: string }> {
  const res = await fetch('/api/consent/grant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `Consent grant error ${res.status}`)
  }
  return res.json()
}

export async function revokeConsent(grantId: string): Promise<void> {
  await fetch(`/api/consent/grants/${grantId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
}

// ── Auth permissions ───────────────────────────────────────────────────────────

export async function getMyPermissions(): Promise<string[]> {
  const res = await fetch('/api/auth/permissions', { headers: authHeaders() })
  if (!res.ok) return []
  const data = await res.json()
  return (data.permissions || []) as string[]
}

// ── Health facts ───────────────────────────────────────────────────────────────

export interface HealthFact {
  id: string
  type: string
  key: string
  value: string
  unit: string | null
  recorded_at: string | null
  evidence_class: string
}

export async function getHealthFacts(memberId: string): Promise<HealthFact[]> {
  const res = await fetch(
    `/api/records/${DEFAULT_TENANT_ID}/${memberId}/facts`,
    { headers: authHeaders() },
  )
  if (!res.ok) throw new Error(`Records error ${res.status}`)
  const data = await res.json()
  return (data.facts || []) as HealthFact[]
}

export async function updateProfile(params: {
  full_name?: string;
  preferred_language?: string;
}): Promise<void> {
  const token = getToken();
  if (!token) return;
  await fetch('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
}
