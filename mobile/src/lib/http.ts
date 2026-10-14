/**
 * Thin fetch wrapper for the PAL FastAPI backend.
 *
 * - Adds the Bearer token from the saved session.
 * - Normalises FastAPI's three error shapes into one readable message:
 *     {"detail": "text"}                       most errors
 *     {"detail": [{loc, msg, type}, ...]}       422 validation
 *     {"detail": {detail, seconds_until_refill}} 429 out of credits
 * - A 401 on an authenticated call clears the session and notifies listeners,
 *   so the app drops back to the login screen ("session expired").
 * - Times out instead of hanging forever on a dead network.
 */
import { API_BASE, REQUEST_TIMEOUT_MS } from '../config'
import { clearSession, loadSession, notifySessionExpired, onSessionExpired } from './session'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/** Subscribe to "the server rejected our token". Returns an unsubscribe fn. */
export const onUnauthorized = onSessionExpired

export function describeError(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  const errText = (body as { error?: unknown } | null)?.error
  if (status === 429 && (typeof detail === 'string' || typeof errText === 'string')) {
    // slowapi says e.g. "3 per 1 hour"
    return 'Too many attempts. Please wait a while and try again.'
  }
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d: any) => {
        const field = Array.isArray(d?.loc) ? d.loc.filter((x: unknown) => x !== 'body').join('.') : ''
        return field ? `${field}: ${d?.msg}` : d?.msg
      })
      .filter(Boolean)
    if (msgs.length) return msgs.join('\n')
  }
  if (detail && typeof detail === 'object' && typeof (detail as any).detail === 'string') {
    return (detail as any).detail
  }
  if (status === 0) return 'Could not reach the PAL server. Check your internet connection.'
  if (status === 404) return 'Not found on the server.'
  if (status === 429) return 'Too many requests — please wait a little and try again.'
  if (status >= 500) return 'The PAL server had a problem. Please try again shortly.'
  return `Request failed (${status}).`
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** multipart upload; when set, `body` is ignored */
  form?: FormData
  query?: Record<string, string | number | boolean | undefined | null>
  auth?: boolean
  timeoutMs?: number
  /** default true: a 401 signs the user out. false: just throw. */
  expireOn401?: boolean
}

export async function request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, query, auth = true, timeoutMs = REQUEST_TIMEOUT_MS, expireOn401 = true } = opts

  let url = API_BASE + path
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    if (qs) url += (url.includes('?') ? '&' : '?') + qs
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  let sentToken: string | undefined
  if (auth) {
    const s = await loadSession()
    sentToken = s?.token
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`
  }
  let payload: any
  if (form) {
    payload = form // RN sets the multipart boundary itself
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, { method, headers, body: payload, signal: controller.signal })
  } catch (e: any) {
    const timedOut = e?.name === 'AbortError'
    throw new ApiError(
      0,
      timedOut
        ? 'The server took too long to respond. Please try again.'
        : 'Could not reach the PAL server. Check your internet connection.',
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { detail: text.slice(0, 300) }
    }
  }

  if (!res.ok) {
    if (res.status === 401 && auth) {
      // Only sign out if the token we sent is still the current one — a slow
      // request finishing after a fresh login must not wipe the new session.
      const current = await loadSession()
      if (expireOn401 && current && current.token === sentToken) {
        await clearSession()
        notifySessionExpired()
      }
      throw new ApiError(401, 'Your session has expired. Please sign in again.', data)
    }
    if (res.status >= 500) {
      // Server internals are not useful to a patient; keep them visible in debug builds.
      const friendly = 'The PAL server had a problem answering. Please try again shortly.'
      const raw = describeError(data, res.status)
      throw new ApiError(res.status, __DEV__ ? `${friendly}\n[${res.status}: ${raw}]` : friendly, data)
    }
    throw new ApiError(res.status, describeError(data, res.status), data)
  }
  return data as T
}

/** Build a multipart file part the React Native way. */
export function filePart(uri: string, name: string, type: string): any {
  return { uri, name, type }
}
