/**
 * PAL backend API — every call the Android app makes, typed against the
 * FastAPI routers in api/routers/. Paths are FastAPI paths; API_BASE adds
 * the /api prefix in production.
 */
import { DEFAULT_TENANT_ID, CHAT_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from '../config'
import { ApiError, filePart, request } from './http'
import { AuthType, Session, jwtExpiry, loadSession, saveSession, clearSession } from './session'

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

interface PatientBrief {
  id: string
  full_name: string
  phone?: string | null
  email?: string | null
}

/** POST /v3/auth/login — username OR email + password. */
export async function loginWithPassword(username: string, password: string): Promise<Session> {
  const r = await request<{
    access_token: string
    user: { id: string; username: string; email: string }
    patient: PatientBrief | null
  }>('/v3/auth/login', {
    method: 'POST',
    body: { username: username.trim(), password },
    auth: false,
  })
  const s: Session = {
    token: r.access_token,
    authType: 'email',
    userId: r.user.id,
    patientId: r.patient?.id ?? null,
    displayName: r.patient?.full_name || r.user.username,
    username: r.user.username,
    email: r.user.email,
    expiresAt: jwtExpiry(r.access_token),
  }
  await saveSession(s)
  return s
}

/** POST /v3/auth/signup — creates the account only; caller logs in next. */
export async function signup(username: string, email: string, password: string): Promise<void> {
  await request('/v3/auth/signup', {
    method: 'POST',
    body: { username: username.trim(), email: email.trim(), password },
    auth: false,
  })
}

/** Strip to the 10-digit form the backend stores. */
export function normalisePhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  return d
}

/** POST /phone/auth/request — sends (or, in dev, returns) a one-time code. */
export async function requestOtp(phone: string): Promise<{ message: string; dev_otp?: string }> {
  return request('/phone/auth/request', {
    method: 'POST',
    body: { phone: normalisePhone(phone), delivery_channel: 'sms' },
    auth: false,
  })
}

/** POST /phone/auth/verify */
export async function verifyOtp(phone: string, otp: string): Promise<Session> {
  const digits = normalisePhone(phone)
  const r = await request<{
    access_token: string
    user: { id: string; phone_number: string }
    patient_id: string | null
    patient?: PatientBrief
  }>('/phone/auth/verify', {
    method: 'POST',
    body: { phone: digits, otp_code: otp.trim() },
    auth: false,
  })
  const s: Session = {
    token: r.access_token,
    authType: 'phone',
    userId: r.user.id,
    patientId: r.patient_id ?? r.patient?.id ?? null,
    displayName: r.patient?.full_name || `+91 ${r.user.phone_number}`,
    phone: r.user.phone_number,
    expiresAt: jwtExpiry(r.access_token),
  }
  await saveSession(s)
  return s
}

/** Best-effort server logout (the JWT itself stays valid until expiry), then local clear. */
export async function signOut(): Promise<void> {
  try {
    const s = await loadSession()
    if (s) await request('/v2/auth/logout', { method: 'POST', timeoutMs: 5000, expireOn401: false })
  } catch {
    /* offline or already expired — clearing locally is what matters */
  }
  await clearSession()
}

export async function requireSession(): Promise<Session> {
  const s = await loadSession()
  if (!s) throw new ApiError(401, 'Please sign in.')
  return s
}

export async function requirePatientId(): Promise<string> {
  const s = await requireSession()
  if (!s.patientId) throw new ApiError(409, 'Create your health profile first.')
  return s.patientId
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export interface EmergencyContact {
  name: string
  relationship: string
  phone: string
  email?: string | null
}

export interface PatientProfile {
  id: string
  mrn?: string | null
  abha_id?: string | null
  abha_address?: string | null
  full_name: string
  date_of_birth?: string | null
  gender?: string | null
  phone?: string | null
  email?: string | null
  blood_group?: string | null
  address?: string | null
  allergies?: string | null
  chronic_conditions?: string | null
  current_medications?: string | null
  emergency_contact?: EmergencyContact | null
  photo_url?: string | null
}

export interface Credits {
  balance: number
  total_purchased: number
  total_used: number
  last_refill_date: string | null
}

export interface UserProfile {
  user: {
    id: string
    auth_type: AuthType
    username?: string
    email?: string
    phone_number?: string
    is_active: boolean
    created_at?: string
  }
  patient: PatientProfile | null
  credits: Credits
}

/** GET /user/profile — account + linked patient + credits. */
export function getProfile(): Promise<UserProfile> {
  return request('/user/profile')
}

export function getCredits(): Promise<Credits> {
  return request('/user/credits')
}

export const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'] as const
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'] as const

export interface PatientCreate {
  full_name: string
  phone: string
  date_of_birth: string // YYYY-MM-DD
  gender: (typeof GENDERS)[number]
  blood_group: (typeof BLOOD_GROUPS)[number]
  address: string
  allergies: string
  chronic_conditions: string
  current_medications: string
  emergency_contact: EmergencyContact
  email?: string
}

/** POST /patients — every field in PatientCreate is required by the server. */
export async function createPatient(p: PatientCreate): Promise<{ id: string; full_name: string }> {
  const r = await request<{ id: string; full_name: string }>('/patients', { method: 'POST', body: p })
  const s = await loadSession()
  if (s) await saveSession({ ...s, patientId: r.id, displayName: r.full_name })
  return r
}

// ─────────────────────────────────────────────────────────────────────────────
// Ask PAL — /hermes/chat (record-aware assistant) and /search (universal search)
// ─────────────────────────────────────────────────────────────────────────────

export interface Citation {
  title: string
  source?: string
  url?: string
}

export type AskResult =
  | {
      kind: 'answer'
      text: string
      citations: Citation[]
      conversationId: string | null
      pendingActions: PendingAction[]
      provenance?: string
      via: 'hermes' | 'search'
    }
  | { kind: 'disambiguation'; question: string }
  | { kind: 'safety'; category: 'emergency' | 'crisis'; message: string }
  | { kind: 'referral'; message: string }
  | { kind: 'on_device'; reason: string; conversationId: string | null }

export interface PendingAction {
  type: string
  description: string
  confirm_token_required: boolean
  confirm_token?: string
  action_payload?: Record<string, unknown>
}

/** POST /hermes/chat — works for accounts that own the patient (phone login today). */
export async function hermesChat(query: string, patientId: string, conversationId?: string | null) {
  const r = await request<{ answer: string; conversation_id: string; sources?: Citation[] }>(
    '/hermes/chat',
    {
      method: 'POST',
      body: { query, patient_id: patientId, conversation_id: conversationId ?? undefined },
      timeoutMs: CHAT_TIMEOUT_MS,
    },
  )
  return r
}

/** POST /search — universal search (needs UNIVERSAL_SEARCH=true on the server). */
export async function universalSearch(params: {
  query: string
  sessionId: string
  conversationId?: string | null
  consentBasis?: 'per_query' | 'session'
  onDeviceClassificationJson?: string | null
}): Promise<AskResult> {
  const s = await requireSession()
  const data = await request<any>('/search', {
    method: 'POST',
    timeoutMs: CHAT_TIMEOUT_MS,
    body: {
      query: params.query,
      tenant_id: DEFAULT_TENANT_ID,
      // patients.id — conversations are listed per patient, so threads show in History
      member_id: s.patientId ?? undefined,
      session_id: params.sessionId,
      conversation_id: params.conversationId ?? null,
      on_device_classification_json: params.onDeviceClassificationJson ?? null,
      consent_basis: params.consentBasis ?? null,
    },
  })
  switch (data?.type) {
    case 'answer':
      return {
        kind: 'answer',
        text: data.answer?.answer_text ?? '',
        citations: data.answer?.citations ?? [],
        conversationId: data.conversation_id ?? null,
        pendingActions: data.answer?.pending_actions ?? [],
        provenance: data.answer?.provenance_summary,
        via: 'search',
      }
    case 'disambiguation_required':
      return { kind: 'disambiguation', question: data.question }
    case 'safety':
      return { kind: 'safety', category: data.category === 'crisis' ? 'crisis' : 'emergency', message: data.message }
    case 'referral':
      return { kind: 'referral', message: data.message }
    case 'on_device':
      return { kind: 'on_device', reason: data.reason, conversationId: data.conversation_id ?? null }
    default:
      throw new ApiError(500, 'PAL returned a response this app does not understand yet.', data)
  }
}

/**
 * One entry point for the Ask tab.
 *
 * Phone-login accounts own their patient through patients.phone_user_id, which
 * is what /hermes/chat checks, so they go to Hermes first. Email accounts are
 * refused by /hermes/chat (403 — deliberate server policy), so they go to
 * /search first. Each falls back to the other when its first route is disabled
 * or refused.
 */
export async function ask(params: {
  query: string
  sessionId: string
  conversationId?: string | null
  consentBasis?: 'per_query' | 'session'
  onDeviceClassificationJson?: string | null
}): Promise<AskResult> {
  const s = await requireSession()

  const viaHermes = async (): Promise<AskResult> => {
    if (!s.patientId) throw new ApiError(409, 'Create your health profile first to chat about your records.')
    const r = await hermesChat(params.query, s.patientId, params.conversationId)
    return {
      kind: 'answer',
      text: r.answer,
      citations: r.sources ?? [],
      conversationId: r.conversation_id ?? null,
      pendingActions: [],
      via: 'hermes',
    }
  }
  const viaSearch = () => universalSearch(params)

  const [first, second] = s.authType === 'phone' ? [viaHermes, viaSearch] : [viaSearch, viaHermes]
  try {
    return await first()
  } catch (e) {
    // 403: not allowed on this route; 404: route disabled (e.g. UNIVERSAL_SEARCH off)
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
      try {
        return await second()
      } catch (e2) {
        if (e2 instanceof ApiError && (e2.status === 403 || e2.status === 404)) {
          throw new ApiError(
            e2.status,
            s.authType === 'email'
              ? 'Chat is not available for email sign-in on this server yet. Universal search is turned off, and the record assistant only accepts phone sign-in.'
              : e2.message,
          )
        }
        throw e2
      }
    }
    throw e
  }
}

// Conversations (history)

export interface ConversationSummary {
  id: string
  title: string | null
  scope_tag?: string | null
  hindsight_summary?: string | null
  created_at: string
  updated_at: string
}

export interface ConversationTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  scope?: string | null
  citations?: Citation[] | null
  created_at: string
}

/** GET /conversations — 404 means "no patient link yet", shown as an empty list. */
export async function listConversations(): Promise<ConversationSummary[]> {
  try {
    const r = await request<{ conversations: ConversationSummary[] }>('/conversations')
    return r.conversations ?? []
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return []
    throw e
  }
}

export async function getConversationTurns(id: string): Promise<ConversationTurn[]> {
  const r = await request<{ turns: ConversationTurn[] }>(`/conversations/${id}/turns`)
  return r.turns ?? []
}

export async function deleteConversation(id: string): Promise<void> {
  await request(`/conversations/${id}`, { method: 'DELETE' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Records: visits, lab tests, prescriptions, documents
// ─────────────────────────────────────────────────────────────────────────────

export interface MedicationItem {
  [k: string]: unknown
  name?: string
  medicine_name?: string
  drug?: string
  dosage?: string
  dose?: string
  frequency?: string
  duration?: string
  instructions?: string
}

export interface Visit {
  id: string
  doctor_id: string | null
  doctor_name: string | null
  clinic_name: string | null
  date: string | null // "05 Oct 2026"
  time: string | null // "HH:MM"
  reason: string
  status: string
  previsit_url: string | null
  previsit_status: string | null
  has_prescription: boolean
  soap_note: string | null
  management_plan: string | null
  patient_summary: string | null
  medications: MedicationItem[]
  lab_tests: { id: string; test_name: string; result_date: string | null; abnormal_flag: boolean | null; interpretation: string | null }[]
}

export async function getVisits(): Promise<{ upcoming: Visit[]; past: Visit[] }> {
  const pid = await requirePatientId()
  return request(`/visits/patient/${pid}`)
}

export interface LabResultRow {
  name?: string
  name_extracted?: string
  value?: string | number | null
  unit?: string | null
  range?: string | null
  abnormal?: boolean | null
  [k: string]: unknown
}

export interface LabTest {
  id: string
  report_name: string
  report_type: string | null
  test_category: string | null
  ordered_date: string | null
  result_date: string | null
  status: string
  processing_status: string
  results: LabResultRow[] | Record<string, unknown> | null
  has_abnormal_values: boolean
  interpretation: string | null
  ordered_by: string | null
  lab_name: string | null
  report_format: string | null
  file_name: string | null
  confidence_score: number | null
}

export async function getLabTests(): Promise<LabTest[]> {
  const pid = await requirePatientId()
  const r = await request<{ lab_tests: LabTest[] }>(`/lab-tests/patient/${pid}`)
  return r.lab_tests ?? []
}

export interface Prescription {
  id: string
  created_at: string | null
  items: MedicationItem[]
  refillable: boolean
  refills_remaining: number
}

export async function getPrescriptions(): Promise<Prescription[]> {
  const pid = await requirePatientId()
  const r = await request<{ prescriptions: Prescription[] }>(`/prescriptions/patient/${pid}`)
  return r.prescriptions ?? []
}

export interface RecordDocument {
  id: string
  title: string
  kind: string
  date: string | null
  file_name: string
  mime_type: string
  size_bytes: number | null
}

export async function getRecordDocuments(): Promise<RecordDocument[]> {
  const pid = await requirePatientId()
  const r = await request<{ documents?: RecordDocument[] }>(`/records/patient/${pid}`)
  return r.documents ?? []
}

// Upload → review → confirm (medical-data-toolkit pipeline on the server)

export interface Observation {
  loinc_code?: string | null
  display: string
  original_display?: string
  edited?: boolean
  value?: string | null
  unit?: string | null
  reference_range?: string | null
  recorded_at?: string | null
  dosage?: string | null
  frequency?: string | null
  duration?: string | null
  instructions?: string | null
  legible?: boolean
  times?: string[]
  days_of_week?: number[]
  duration_days?: number | null
  is_medication?: boolean | null
}

export type UploadResult =
  | {
      type: 'pending_verification'
      raw_source_id: string
      extraction_id: string
      filename: string
      patient_name_on_doc: string | null
      patient_name_on_profile: string | null
      name_match_status: 'match' | 'partial' | 'no_match'
      report_title: string | null
      report_date: string | null
      observations: Observation[]
      doc_kind: string
      source_modality: string
      extraction_method: string
      needs_review: boolean
      transcription_model: string | null
      transcription_text: string | null
      warnings: string[]
      confidence: number | null
    }
  | { type: 'document_accepted'; raw_source_id: string; filename: string; message: string; mdt_enabled?: boolean; mdt_error?: string }
  | { type: 'unsupported_format'; message: string }

/** POST /medical/upload — PDF / JPEG / PNG, max 20 MB. `patient_id` is a required form field. */
export async function uploadMedicalDocument(file: { uri: string; name: string; type: string }): Promise<UploadResult> {
  const pid = await requirePatientId()
  const form = new FormData()
  form.append('file', filePart(file.uri, file.name, file.type))
  form.append('patient_id', pid)
  form.append('tenant_id', DEFAULT_TENANT_ID)
  return request('/medical/upload', { method: 'POST', form, timeoutMs: UPLOAD_TIMEOUT_MS })
}

/** POST /medical/confirm — save the patient-reviewed observations. */
export async function confirmMedicalDocument(
  r: Extract<UploadResult, { type: 'pending_verification' }>,
  observations: Observation[],
  createReminders: boolean,
): Promise<{ status: string; lab_test_id: string; observations_count: number; edits_applied: number; reminders_created: number }> {
  return request('/medical/confirm', {
    method: 'POST',
    timeoutMs: UPLOAD_TIMEOUT_MS,
    body: {
      raw_source_id: r.raw_source_id,
      extraction_id: r.extraction_id,
      observations,
      report_title: r.report_title,
      report_date: r.report_date,
      source_modality: r.source_modality,
      extraction_method: r.extraction_method,
      transcription_text: r.transcription_text,
      transcription_model: r.transcription_model,
      needs_review: r.needs_review,
      create_reminders: createReminders,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Medications (router mounted only when MEDICATION_REMINDER_ENABLED=true)
// ─────────────────────────────────────────────────────────────────────────────

export interface MedicationSchedule {
  id: string
  patient_id: string
  medicine_name: string
  dosage: string | null
  times: string[]
  days_of_week: number[] // Monday = 0; empty = daily
  start_date: string | null
  end_date: string | null
  timezone: string
  active: boolean
  notes: string | null
}

export interface DoseEvent {
  id: string
  schedule_id: string
  patient_id: string
  scheduled_date: string
  scheduled_time: string
  status: string
  response: string | null
}

export type DoseResponse = 'yes' | 'no' | 'take_now' | 'snooze_10'

export async function listSchedules(): Promise<MedicationSchedule[]> {
  const pid = await requirePatientId()
  const r = await request<{ schedules: MedicationSchedule[] }>('/medications/schedules', { query: { patient_id: pid } })
  return r.schedules ?? []
}

export async function createSchedule(s: {
  medicine_name: string
  dosage?: string
  times: string[]
  days_of_week?: number[]
  start_date?: string
  end_date?: string
  notes?: string
}): Promise<MedicationSchedule> {
  const pid = await requirePatientId()
  return request('/medications/schedules', {
    method: 'POST',
    body: { patient_id: pid, timezone: 'Asia/Kolkata', days_of_week: [], ...s },
  })
}

export function updateSchedule(id: string, patch: Partial<Omit<MedicationSchedule, 'id' | 'patient_id'>>): Promise<MedicationSchedule> {
  return request(`/medications/schedules/${id}`, { method: 'PATCH', body: patch })
}

export async function deleteSchedule(id: string): Promise<void> {
  await request(`/medications/schedules/${id}`, { method: 'DELETE' })
}

export async function pendingDoses(): Promise<DoseEvent[]> {
  const pid = await requirePatientId()
  const r = await request<{ doses: DoseEvent[] }>('/medications/doses/pending', { query: { patient_id: pid } })
  return r.doses ?? []
}

export function respondToDose(doseId: string, response: DoseResponse): Promise<{ id: string; status: string }> {
  return request(`/medications/doses/${doseId}/respond`, { method: 'POST', body: { response } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Family (router mounted when FAMILY_PLAN_ENABLED=true, the default)
// ─────────────────────────────────────────────────────────────────────────────

export const RELATIONSHIPS = ['spouse', 'parent', 'child', 'sibling', 'grandparent', 'grandchild', 'other'] as const
export const INVITE_ROLES = ['adult', 'dependent_adult', 'minor'] as const
export const ACCESS_SCOPES = ['appointments', 'medications', 'summary', 'full'] as const
export type AccessScope = (typeof ACCESS_SCOPES)[number]

export interface FamilyPlanSummary {
  plan_id: string
  name: string
  status: string
  hub_room_id: string | null
  is_admin: boolean
  my_role: string | null
  member_count: number
}

export interface FamilyPlans {
  plans: FamilyPlanSummary[]
  count: number
  max_plans: number
  can_join_more: boolean
  has_family_plan: boolean
}

export interface FamilyPlan {
  plan_id: string
  name: string
  status: string
  max_members: number
  hub_share_ceiling: string
  is_admin: boolean
  can_pay: boolean
  my_member_id: string | null
  my_role: string | null
}

export interface FamilyMember {
  id: string
  user_id: string | null
  display_name: string
  relationship_type: string
  role: string
  status: string
  is_minor: boolean
  is_billing_delegate: boolean
  hub_share_level: string
  is_self: boolean
  my_access_scope: string | null
  my_access_basis: string | null
}

export interface AccessRequest {
  id: string
  subject_member_id: string
  subject_name: string
  grantee_user_id: string
  grantee_name: string
  scope: AccessScope
  message: string | null
  requested_at: string | null
}

export interface AccessGrant {
  id: string
  subject_member_id: string
  subject_name: string
  grantee_user_id: string
  scope: AccessScope
  basis: string
  granted_at: string | null
  expires_at: string | null
  is_live: boolean
}

export function listFamilyPlans(): Promise<FamilyPlans> {
  return request('/family/plans')
}
export function getFamilyPlan(planId?: string): Promise<FamilyPlan> {
  return request('/family/plan', { query: { plan_id: planId } })
}
export function createFamilyPlan(name: string, displayName: string): Promise<{ plan_id: string }> {
  return request('/family/plan', { method: 'POST', body: { name, display_name: displayName } })
}
export function listFamilyMembers(planId?: string): Promise<FamilyMember[]> {
  return request('/family/members', { query: { plan_id: planId } })
}

/** Phone must be E.164 (+91…). Returns a 6-digit invite code — shown ONCE. */
export function inviteFamilyMember(p: {
  display_name: string
  phone: string
  relationship_type: string
  role: string
}): Promise<{ member_id: string; invite_code: string; expires_in_minutes: number; role: string }> {
  return request('/family/members', { method: 'POST', body: { ...p, phone: toE164(p.phone) } })
}

export function acceptFamilyInvite(phone: string, code: string): Promise<{ member_id: string; family_plan_id: string; role: string }> {
  return request('/family/members/accept', { method: 'POST', body: { phone: toE164(phone), code: code.trim() } })
}

export async function removeFamilyMember(memberId: string): Promise<void> {
  await request(`/family/members/${memberId}`, { method: 'DELETE' })
}

export async function listAccessRequests(): Promise<AccessRequest[]> {
  const r = await request<{ requests: AccessRequest[] }>('/family/access/requests')
  return r.requests ?? []
}
export function requestAccess(subjectMemberId: string, scope: AccessScope, message?: string) {
  return request('/family/access/requests', {
    method: 'POST',
    body: { subject_member_id: subjectMemberId, scope, message: message || undefined },
  })
}
export function approveAccess(grantId: string) {
  return request(`/family/access/requests/${grantId}/approve`, { method: 'POST', body: {} })
}
export function denyAccess(grantId: string) {
  return request(`/family/access/requests/${grantId}/deny`, { method: 'POST' })
}
export function listGrants(): Promise<{ i_can_see: AccessGrant[]; can_see_me: AccessGrant[] }> {
  return request('/family/access/grants')
}
export async function revokeGrant(grantId: string): Promise<void> {
  await request(`/family/access/grants/${grantId}`, { method: 'DELETE' })
}

export function toE164(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('+')) return '+' + t.slice(1).replace(/\D/g, '')
  let d = normalisePhone(t)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1) // trunk prefix: 098765 43210
  return d.length === 10 ? `+91${d}` : `+${d}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications (router mounted when CHAT_ENABLED=true, the default)
// ─────────────────────────────────────────────────────────────────────────────

export interface AppNotification {
  id: string
  title: string
  body: string | null
  notification_type: string
  link: string | null
  ref_id: string | null
  is_read: boolean
  created_at: string
}

export async function listNotifications(limit = 30, offset = 0): Promise<AppNotification[]> {
  // trailing slash matters: without it FastAPI answers 307
  const r = await request<{ notifications: AppNotification[] }>('/notifications/', { query: { limit, offset } })
  return r.notifications ?? []
}
export async function unreadNotificationCount(): Promise<number> {
  try {
    const r = await request<{ unread: number }>('/notifications/unread-count')
    return r.unread ?? 0
  } catch {
    return 0
  }
}
export function markNotificationRead(id: string) {
  return request(`/notifications/${id}/read`, { method: 'POST' })
}
export function markAllNotificationsRead() {
  return request('/notifications/mark-all-read', { method: 'POST' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Server status
// ─────────────────────────────────────────────────────────────────────────────

export interface ServerHealth {
  status: string
  app?: string
  flags?: Record<string, unknown>
}

export function getHealth(): Promise<ServerHealth> {
  return request('/health', { auth: false, timeoutMs: 8000 })
}

export { ApiError }
