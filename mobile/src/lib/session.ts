/**
 * Persisted login session.
 *
 * The backend has two logins that produce different identities:
 *   email  (/v3/auth/login)    user.id = users.id,       token lasts ~60 min, no refresh
 *   phone  (/phone/auth/verify) user.id = phone_users.id, token lasts 30 days
 * Both give a patients.id (or null when no profile exists yet). Every
 * /records, /visits, /lab-tests, /prescriptions, /medications call takes the
 * patient id; /family and /notifications key off the token itself.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

export type AuthType = 'email' | 'phone'

export interface Session {
  token: string
  authType: AuthType
  userId: string
  patientId: string | null
  displayName: string
  username?: string
  email?: string
  phone?: string
  /** epoch ms, from the JWT `exp` claim; null if it could not be read */
  expiresAt: number | null
}

const KEY = 'pal_session_v1'

let cached: Session | null | undefined

type Listener = () => void
const expiredListeners = new Set<Listener>()

/** Subscribe to "the session is no longer valid" (server 401 or local expiry). */
export function onSessionExpired(fn: Listener): () => void {
  expiredListeners.add(fn)
  return () => {
    expiredListeners.delete(fn)
  }
}

export function notifySessionExpired(): void {
  expiredListeners.forEach(fn => fn())
}

export async function loadSession(): Promise<Session | null> {
  if (cached === undefined) {
    try {
      const raw = await AsyncStorage.getItem(KEY)
      cached = raw ? (JSON.parse(raw) as Session) : null
    } catch {
      cached = null
    }
  }
  if (cached && isExpired(cached)) {
    // Email tokens last ~60 min with no refresh: drop back to the login screen.
    await clearSession()
    notifySessionExpired()
    return null
  }
  return cached
}

export async function saveSession(s: Session): Promise<void> {
  cached = s
  await AsyncStorage.setItem(KEY, JSON.stringify(s))
}

export async function updateSession(patch: Partial<Session>): Promise<Session | null> {
  const cur = await loadSession()
  if (!cur) return null
  const next = { ...cur, ...patch }
  await saveSession(next)
  return next
}

export async function clearSession(): Promise<void> {
  cached = null
  await AsyncStorage.removeItem(KEY)
}

export function isExpired(s: Session, skewMs = 30_000): boolean {
  return s.expiresAt != null && Date.now() + skewMs >= s.expiresAt
}

/** Read `exp` from a JWT without verifying it (the server verifies). */
export function jwtExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = base64UrlDecode(part)
    const exp = JSON.parse(json).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Small base64url decoder — Hermes has no Buffer, and atob is not guaranteed. */
export function base64UrlDecode(input: string): string {
  const s = input.replace(/-/g, '+').replace(/_/g, '/')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of s) {
    if (ch === '=') break
    const idx = B64.indexOf(ch)
    if (idx < 0) continue
    value = (value << 6) | idx
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >> bits) & 0xff)
    }
  }
  // UTF-8 decode
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b < 0x80) out += String.fromCharCode(b)
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++i] & 0x3f))
    else if (b < 0xf0)
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f))
    else {
      const cp =
        ((b & 0x07) << 18) | ((bytes[++i] & 0x3f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f)
      out += String.fromCodePoint(cp)
    }
  }
  return out
}
