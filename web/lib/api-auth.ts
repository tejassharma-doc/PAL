/**
 * Enhanced authentication API functions with session management
 * Supports both password-based and OTP-based authentication
 */

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

// ──────────────────────────────────────────────────────────────────────────────
// Storage helpers
// ──────────────────────────────────────────────────────────────────────────────

export function saveAuth(token: string, user: any, sessionId: string, patientId?: string) {
  if (typeof window === 'undefined') return

  // Clear old patient_id first to avoid stale data
  localStorage.removeItem('pal_patient_id')

  localStorage.setItem('pal_token', token)
  localStorage.setItem('pal_user_id', user.id)
  localStorage.setItem('pal_session_id', sessionId)
  localStorage.setItem('pal_preferred_lang', user.preferred_language || 'en')

  if (user.full_name) {
    localStorage.setItem('pal_user_name', user.full_name)
  }

  if (patientId) {
    localStorage.setItem('pal_patient_id', patientId)
    console.log('[AUTH] Saved patient_id:', patientId)
  } else {
    console.log('[AUTH] No patient_id provided - user needs onboarding')
  }
}

export function clearAuth() {
  if (typeof window === 'undefined') return

  localStorage.removeItem('pal_token')
  localStorage.removeItem('pal_user_id')
  localStorage.removeItem('pal_session_id')
  localStorage.removeItem('pal_preferred_lang')
  localStorage.removeItem('pal_user_name')
  localStorage.removeItem('pal_patient_id')
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('pal_token')
}

export function getUserId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('pal_user_id')
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email?: string
  phone?: string
  full_name?: string
  phone_verified: boolean
  email_verified: boolean
  preferred_language: string
  date_of_birth?: string
  has_ehr: boolean
  requires_onboarding: boolean
}

export interface AuthResponse {
  access_token: string
  token_type: string
  expires_in: number
  session_id: string
  user: User
  is_new_user: boolean
  requires_onboarding: boolean
}

export interface CheckUserResponse {
  exists: boolean
  has_password: boolean
  has_phone: boolean
  full_name?: string
  preferred_language?: string
}

export interface Session {
  id: string
  session_name?: string
  ip_address?: string
  last_activity: string
  created_at: string
  expires_at: string
  is_active: boolean
}

// ──────────────────────────────────────────────────────────────────────────────
// API Functions
// ──────────────────────────────────────────────────────────────────────────────

// REMOVED: checkUserExists() and registerUser() functions
// User registration is disabled. Users must be created externally.

/**
 * Login with username/email and password (uses new v3 endpoint)
 */
export async function loginWithPassword(
  username: string,
  password: string
): Promise<AuthResponse> {
  const res = await fetch('/api/v3/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: username.trim(),
      password,
    }),
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.detail || 'Login failed')
  }

  // Save auth data (including patient_id from new response)
  localStorage.setItem('pal_token', json.access_token)
  localStorage.setItem('pal_user_id', json.user.id)
  localStorage.setItem('pal_session_id', json.session_id)
  localStorage.setItem('pal_username', json.user.username)

  if (json.patient) {
    localStorage.setItem('pal_patient_id', json.patient.id)
    localStorage.setItem('pal_user_name', json.patient.full_name)
  }

  return json
}

/**
 * Request OTP for phone-based login
 */
export async function requestLoginOTP(data: {
  phone: string
  delivery_channel?: 'sms' | 'email'
  email?: string
}): Promise<{ message: string; dev_otp?: string; expires_in: number }> {
  const res = await fetch('/api/phone/auth/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: data.phone.replace(/\D/g, ''),
      delivery_channel: data.delivery_channel || 'sms',
      email: data.email,
    }),
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.detail || 'Failed to send OTP')
  }

  return json
}

/**
 * Verify OTP and login
 */
export async function verifyLoginOTP(
  phone: string,
  otpCode: string
): Promise<AuthResponse> {
  const res = await fetch('/api/phone/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: phone.replace(/\D/g, ''),
      otp_code: otpCode,
    }),
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.detail || 'OTP verification failed')
  }

  // Log what we received from backend
  console.log('[OTP VERIFY] Response:', {
    user_id: json.user?.id,
    patient_id: json.patient_id,
    requires_onboarding: json.requires_onboarding,
    has_patient_profile: json.has_patient_profile
  })

  // Save auth data
  saveAuth(json.access_token, json.user, json.session_id, json.patient_id)

  return json
}

/**
 * Get current user profile
 */
export async function getCurrentUser(): Promise<User> {
  const res = await fetch('/api/v2/auth/me', {
    headers: authHeaders(),
  })

  if (!res.ok) {
    if (res.status === 401) {
      clearAuth()
    }
    throw new Error('Failed to get user profile')
  }

  return res.json()
}

/**
 * Update user profile
 */
export async function updateProfile(data: {
  full_name?: string
  preferred_language?: string
}): Promise<{ id: string; full_name?: string; preferred_language?: string }> {
  const res = await fetch('/api/v2/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    throw new Error('Failed to update profile')
  }

  const json = await res.json()

  // Update localStorage
  if (json.preferred_language) {
    localStorage.setItem('pal_preferred_lang', json.preferred_language)
  }
  if (json.full_name) {
    localStorage.setItem('pal_user_name', json.full_name)
  }

  return json
}

/**
 * List all active sessions for current user
 */
export async function getUserSessions(): Promise<{ sessions: Session[] }> {
  const res = await fetch('/api/v2/auth/sessions', {
    headers: authHeaders(),
  })

  if (!res.ok) {
    throw new Error('Failed to get sessions')
  }

  return res.json()
}

/**
 * Revoke a specific session
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/v2/auth/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })

  if (!res.ok) {
    throw new Error('Failed to revoke session')
  }
}

/**
 * Logout from all sessions
 */
export async function logout(): Promise<void> {
  try {
    const res = await fetch('/api/v2/auth/logout', {
      method: 'POST',
      headers: authHeaders(),
    })

    if (!res.ok) {
      console.error('Logout request failed')
    }
  } finally {
    // Always clear local auth regardless of API response
    clearAuth()
  }
}

/**
 * Get user permissions
 */
export async function getUserPermissions(): Promise<{ permissions: string[] }> {
  const res = await fetch('/api/v2/auth/permissions', {
    headers: authHeaders(),
  })

  if (!res.ok) {
    throw new Error('Failed to get permissions')
  }

  return res.json()
}

/**
 * Get complete user profile with credits
 */
export async function getUserProfile(): Promise<{
  user: {
    id: string
    username: string
    email: string
    is_active: boolean
    created_at?: string
  }
  patient: {
    id: string
    mrn?: string
    abha_id?: string
    abha_address?: string
    full_name: string
    date_of_birth?: string
    gender?: string
    phone?: string
    email?: string
    blood_group?: string
    address?: string
    allergies?: string
    chronic_conditions?: string
    current_medications?: string
    emergency_contact?: {
      name?: string
      relationship?: string
      phone?: string
    }
    photo_url?: string
  } | null
  credits: {
    balance: number
    total_purchased: number
    total_used: number
    last_refill_date?: string
  }
}> {
  const res = await fetch('/api/user/profile', {
    headers: authHeaders(),
  })

  if (!res.ok) {
    if (res.status === 401) {
      clearAuth()
    }
    throw new Error('Failed to get user profile')
  }

  return res.json()
}

/**
 * Get user credits only
 */
export async function getUserCredits(): Promise<{
  balance: number
  total_purchased: number
  total_used: number
  last_refill_date?: string
}> {
  const res = await fetch('/api/user/credits', {
    headers: authHeaders(),
  })

  if (!res.ok) {
    if (res.status === 401) {
      clearAuth()
    }
    throw new Error('Failed to get credits')
  }

  return res.json()
}

/**
 * Get user's appointment/visit history
 */
export interface LabTestSummary {
  id: string
  test_name: string
  result_date?: string
  abnormal_flag: boolean
  interpretation?: string
}

export interface Visit {
  id: string
  doctor_id?: string
  date: string
  reason: string
  status: string
  soap_note?: string
  management_plan?: string
  patient_summary?: string
  lab_tests: LabTestSummary[]
}

export async function getPatientVisits(
  patientId: string
): Promise<{ upcoming: Visit[]; past: Visit[] }> {
  const res = await fetch(`/api/visits/patient/${patientId}`, {
    headers: authHeaders(),
  })

  if (!res.ok) {
    if (res.status === 401) {
      clearAuth()
    }
    throw new Error('Failed to fetch visits')
  }

  return res.json()
}

// Legacy function - kept for compatibility
export async function getUserVisits(
  tenantId: string,
  memberId: string
): Promise<{ appointments: Visit[] }> {
  const patientId = localStorage.getItem('pal_patient_id')
  if (!patientId) {
    return { appointments: [] }
  }

  const data = await getPatientVisits(patientId)
  return { appointments: [...data.upcoming, ...data.past] }
}

// ──────────────────────────────────────────────────────────────────────────────
// Legacy compatibility functions (uses old endpoints)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Legacy OTP request (uses /auth/request-otp)
 */
export async function requestOTPLegacy(data: {
  phone: string
  delivery_channel?: 'sms' | 'email'
  email?: string
}): Promise<{ message: string; dev_otp?: string }> {
  const res = await fetch('/api/auth/request-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: data.phone.replace(/\D/g, ''),
      delivery_channel: data.delivery_channel || 'sms',
      email: data.email,
    }),
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.detail || 'Failed to send OTP')
  }

  return json
}

/**
 * Legacy OTP verify (uses /auth/verify-otp)
 */
export async function verifyOTPLegacy(
  phone: string,
  otpCode: string
): Promise<AuthResponse> {
  const res = await fetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: phone.replace(/\D/g, ''),
      otp_code: otpCode,
    }),
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.detail || 'OTP verification failed')
  }

  // Save auth data (minimal)
  if (typeof window !== 'undefined') {
    localStorage.setItem('pal_token', json.access_token)
    if (json.user?.id) localStorage.setItem('pal_user_id', json.user.id)
    if (json.user?.preferred_language) localStorage.setItem('pal_preferred_lang', json.user.preferred_language)
  }

  return json
}
