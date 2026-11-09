/**
 * Subscription / billing REST client. House style matches lib/family-api.ts.
 * Promotes the inline fetches in app/page.tsx (loadSubscription/subAction) and
 * app/pricing/page.tsx (create + Razorpay) into typed functions.
 */

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const token = localStorage.getItem('pal_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function unwrap<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as Record<string, string>).detail || `${what} failed (${res.status})`)
  }
  return (await res.json()) as T
}

export interface SubscriptionStatus {
  active: boolean
  plan?: 'individual' | 'family' | string
  status?: 'active' | 'paused' | 'cancelled' | string
  renews_at?: string
  current_period_end?: string
  amount_display?: string
  max_members?: number
  [key: string]: unknown
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  try {
    const res = await fetch('/api/subscription/status', { headers: authHeaders() })
    if (!res.ok) return { active: false }
    return (await res.json()) as SubscriptionStatus
  } catch {
    return { active: false }
  }
}

export async function subscriptionAction(action: 'pause' | 'resume' | 'cancel'): Promise<SubscriptionStatus> {
  const res = await fetch(`/api/subscription/${action}`, { method: 'POST', headers: authHeaders() })
  return unwrap<SubscriptionStatus>(res, `Subscription ${action}`)
}

export interface CreateSubscriptionResult {
  subscription_id: string
  razorpay_key_id: string
  short_url?: string
  [key: string]: unknown
}

export async function createSubscription(plan: 'individual' | 'family'): Promise<CreateSubscriptionResult> {
  const res = await fetch(`/api/subscription/create?plan=${encodeURIComponent(plan)}`, {
    method: 'POST',
    headers: authHeaders(),
  })
  return unwrap<CreateSubscriptionResult>(res, 'Create subscription')
}
