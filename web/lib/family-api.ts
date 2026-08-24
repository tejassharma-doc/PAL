/**
 * Family Plan + chat REST client.
 *
 * House style, matching lib/api.ts:
 *   - relative `/api/...` paths (proxied by app/api/[...proxy]/route.ts)
 *   - bearer from localStorage `pal_token`
 *   - throwing helpers unwrap `detail`; list helpers soft-fail to []
 *
 * This is a NEW file. lib/api.ts is not modified, so its existing
 * `listFamilyMembers` / `grantConsent` / `revokeConsent` (which point at the
 * unimplemented `/api/consent/*` surface) keep behaving exactly as before.
 */

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('pal_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeaders() };
}

async function unwrap<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).detail || `${what} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

// ── types ────────────────────────────────────────────────────────────────────
export type AccessScope = 'appointments' | 'medications' | 'summary' | 'full';
export type HubShareLevel = 'none' | 'minimal' | 'detailed';

export interface FamilyPlanInfo {
  plan_id: string;
  name: string;
  status: string;
  max_members: number;
  billing_currency: string;
  hub_share_ceiling: HubShareLevel;
  hub_room_id: string | null;
  is_admin: boolean;
  can_pay: boolean;
  my_member_id: string | null;
  my_role: string | null;
}

export interface FamilyPlanMember {
  id: string;
  user_id: string | null;
  display_name: string;
  relationship_type: string;
  role: string;
  status: string;
  is_minor: boolean;
  is_billing_delegate: boolean;
  hub_share_level: HubShareLevel;
  is_self: boolean;
  my_access_scope: AccessScope | null;
  my_access_basis: string | null;
}

export interface AccessRequest {
  id: string;
  subject_member_id: string;
  subject_name: string;
  grantee_user_id: string;
  grantee_name: string;
  scope: AccessScope;
  message: string | null;
  requested_at: string | null;
}

export interface PaymentRequest {
  id: string;
  subject_member_id: string;
  subject_name: string;
  amount_minor: number;
  currency: string;
  amount_display: string;
  description: string;
  payment_url: string | null;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  can_pay: boolean;
}

export interface HubInfo {
  room_id: string;
  plan_id: string;
  name: string;
  muted: boolean;
  can_pay: boolean;
}

export interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  content_type: string;
  payload: Record<string, unknown> | null;
  subject_member_id: string | null;
  reply_to_id: string | null;
  message_type: string;
  created_at: string;
}

export interface Conversation {
  room_id: string;
  name: string | null;
  room_type: string;
  owner_org_type: string | null;
  owner_org_id: string | null;
  last_message: string | null;
  last_content_type: string | null;
  last_message_at: string | null;
  unread_count: number;
}

// ── plan ─────────────────────────────────────────────────────────────────────
/** null when the account has no plan yet (404), which is a normal state. */
export async function getFamilyPlan(): Promise<FamilyPlanInfo | null> {
  const res = await fetch('/api/family/plan', { headers: authHeaders() });
  if (res.status === 404) return null;
  return unwrap<FamilyPlanInfo>(res, 'Load family plan');
}

export async function createFamilyPlan(params: {
  name: string;
  display_name: string;
  phone?: string;
}): Promise<{ plan_id: string; hub_room_id: string | null }> {
  const res = await fetch('/api/family/plan', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(params),
  });
  return unwrap(res, 'Create family plan');
}

export async function updateFamilyPlan(params: {
  name?: string;
  hub_share_ceiling?: HubShareLevel;
}): Promise<void> {
  const res = await fetch('/api/family/plan', {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify(params),
  });
  await unwrap(res, 'Update family plan');
}

// ── members ──────────────────────────────────────────────────────────────────
export async function listPlanMembers(): Promise<FamilyPlanMember[]> {
  const res = await fetch('/api/family/members', { headers: authHeaders() });
  if (!res.ok) return [];
  return (await res.json()) as FamilyPlanMember[];
}

export async function inviteMember(params: {
  display_name: string;
  phone: string;
  relationship_type: string;
  role: 'adult' | 'dependent_adult' | 'minor';
  date_of_birth?: string;
  is_billing_delegate?: boolean;
}): Promise<{ member_id: string; invite_code: string; expires_in_minutes: number; role: string }> {
  const res = await fetch('/api/family/members', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(params),
  });
  return unwrap(res, 'Invite');
}

export async function acceptInvite(phone: string, code: string) {
  const res = await fetch('/api/family/members/accept', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ phone, code }),
  });
  return unwrap<{ member_id: string; family_plan_id: string; role: string; note: string }>(
    res,
    'Accept invitation',
  );
}

export async function updateMember(
  memberId: string,
  params: {
    role?: string;
    is_billing_delegate?: boolean;
    hub_share_level?: HubShareLevel;
    hub_muted?: boolean;
    display_name?: string;
  },
): Promise<void> {
  const res = await fetch(`/api/family/members/${memberId}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify(params),
  });
  await unwrap(res, 'Update member');
}

export async function removeMember(memberId: string): Promise<void> {
  const res = await fetch(`/api/family/members/${memberId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await unwrap(res, 'Remove member');
}

// ── consent handshake ────────────────────────────────────────────────────────
export async function listAccessRequests(): Promise<AccessRequest[]> {
  const res = await fetch('/api/family/access/requests', { headers: authHeaders() });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.requests || []) as AccessRequest[];
}

export async function requestAccess(params: {
  subject_member_id: string;
  scope: AccessScope;
  message?: string;
}): Promise<{ request_id: string; status: string }> {
  const res = await fetch('/api/family/access/requests', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(params),
  });
  return unwrap(res, 'Request access');
}

/** The 1-tap confirmation. */
export async function approveAccess(requestId: string, expiresInDays?: number): Promise<void> {
  const res = await fetch(`/api/family/access/requests/${requestId}/approve`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ expires_in_days: expiresInDays ?? null }),
  });
  await unwrap(res, 'Approve');
}

export async function denyAccess(requestId: string): Promise<void> {
  const res = await fetch(`/api/family/access/requests/${requestId}/deny`, {
    method: 'POST',
    headers: jsonHeaders(),
  });
  await unwrap(res, 'Decline');
}

export async function revokeAccessGrant(grantId: string): Promise<void> {
  const res = await fetch(`/api/family/access/grants/${grantId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await unwrap(res, 'Revoke');
}

export async function listGrants(): Promise<{
  i_can_see: Array<Record<string, unknown>>;
  can_see_me: Array<Record<string, unknown>>;
}> {
  const res = await fetch('/api/family/access/grants', { headers: authHeaders() });
  if (!res.ok) return { i_can_see: [], can_see_me: [] };
  return res.json();
}

// ── payments ─────────────────────────────────────────────────────────────────
export async function listPayments(): Promise<PaymentRequest[]> {
  const res = await fetch('/api/family/payments', { headers: authHeaders() });
  if (!res.ok) return [];
  return (await res.json()) as PaymentRequest[];
}

export async function payRequest(paymentId: string): Promise<{ status: string }> {
  const res = await fetch(`/api/family/payments/${paymentId}/pay`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return unwrap(res, 'Pay');
}

// ── hub + chat ───────────────────────────────────────────────────────────────
export async function getHub(): Promise<HubInfo | null> {
  const res = await fetch('/api/family/hub', { headers: authHeaders() });
  if (res.status === 404 || res.status === 403 || res.status === 503) return null;
  return unwrap<HubInfo>(res, 'Open Care Hub');
}

export async function getRoomMessages(roomId: string, limit = 50): Promise<ChatMessage[]> {
  const res = await fetch(`/api/chat/rooms/${roomId}/messages?limit=${limit}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  // API returns newest-first; render oldest-first.
  return ((data.messages || []) as ChatMessage[]).slice().reverse();
}

/** REST fallback send — used when the socket is not open. */
export async function sendRoomMessageRest(roomId: string, content: string) {
  const res = await fetch('/api/chat/send', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ room_id: roomId, content }),
  });
  return unwrap<{ message_id: string; room_id: string }>(res, 'Send');
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/chat/conversations', { headers: authHeaders() });
  if (!res.ok) return [];
  return (await res.json()) as Conversation[];
}

export async function chatUnreadCount(): Promise<number> {
  const res = await fetch('/api/chat/unread-count', { headers: authHeaders() });
  if (!res.ok) return 0;
  const data = await res.json();
  return Number(data.unread || 0);
}

// ── notifications ────────────────────────────────────────────────────────────
export interface AppNotification {
  id: string;
  title: string;
  body: string | null;
  notification_type: string;
  link: string | null;
  ref_id: string | null;
  is_read: boolean;
  created_at: string;
}

export async function listAppNotifications(limit = 30): Promise<AppNotification[]> {
  const res = await fetch(`/api/notifications/?limit=${limit}`, { headers: authHeaders() });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.notifications || []) as AppNotification[];
}

export async function notificationUnreadCount(): Promise<number> {
  const res = await fetch('/api/notifications/unread-count', { headers: authHeaders() });
  if (!res.ok) return 0;
  const data = await res.json();
  return Number(data.unread || 0);
}

export async function markNotificationRead(id: string): Promise<void> {
  await fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: authHeaders() });
}

export async function markAllNotificationsRead(): Promise<void> {
  await fetch('/api/notifications/mark-all-read', { method: 'POST', headers: authHeaders() });
}
