'use client';

/**
 * Family Care Hub — /family/hub?planId=<uuid>
 *
 * Three message kinds:
 *   - ordinary chat between members
 *   - `payment_request` cards  → tap to pay on someone else's behalf
 *   - `care_event` system lines → already redacted server-side
 *
 * Admin controls (members panel, toggled by the people icon in the header):
 *   - See all members with their status
 *   - Remove a member (hard-deletes from the database)
 *   - Add a member (navigates to the invite page)
 *
 * PRIVACY NOTE FOR ANYONE EDITING THIS FILE:
 * Never render a field the server did not already redact. The backend strips
 * provider names, specialties and drug names before they are written to
 * `chat_messages` (services/family/policy.py::redact_for_hub). If you add a
 * field to the payload, redact it there — not here.
 *
 * Style: house Style A — PhoneShell, inline styles, CSS custom properties.
 */

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import TabBar from '@/components/layout/TabBar';
import {
  deleteFamilyPlan,
  getHub,
  getRoomMessages,
  listPlanMembers,
  listPayments,
  payRequest,
  removeMember,
  sendRoomMessageRest,
  type ChatMessage,
  type FamilyPlanMember,
  type HubInfo,
} from '@/lib/family-api';
import { useChatSocket, type ChatFrame } from '@/lib/useChatSocket';
import { announceChatRead } from '@/lib/chatSocket';

function timeOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

/* ── payment card ─────────────────────────────────────────────────────────── */
function PaymentCard({
  msg,
  canPay,
  onPaid,
}: {
  msg: ChatMessage;
  canPay: boolean;
  onPaid: (paymentId: string) => void;
}) {
  const p = (msg.payload || {}) as Record<string, string | number | null>;
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(false);

  async function pay() {
    if (!p.payment_id) return;
    setPaying(true);
    try {
      await payRequest(String(p.payment_id));
      setDone(true);
      onPaid(String(p.payment_id));
    } catch {
      setPaying(false);
    }
  }

  return (
    <div
      style={{
        background: 'linear-gradient(160deg,#f9f5ec,#f3f0e6)',
        border: '1px solid rgba(216,162,74,.3)',
        borderRadius: 14,
        padding: '12px 13px',
        margin: '0 auto',
        maxWidth: 260,
        width: '100%',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--mono)',
          fontSize: '0.52rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'rgba(13,31,36,.45)',
          marginBottom: 4,
        }}
      >
        Payment request
      </p>
      <p
        style={{
          fontFamily: 'var(--serif)',
          fontWeight: 300,
          fontSize: '1.4rem',
          color: 'var(--ink)',
          marginBottom: 2,
        }}
      >
        {p.amount_display ?? '—'}
      </p>
      {p.description && (
        <p style={{ fontSize: 12, color: 'rgba(13,31,36,.55)', lineHeight: 1.5, marginBottom: 9 }}>
          {String(p.description)}
        </p>
      )}
      {canPay && !done && (
        <button
          onClick={pay}
          disabled={paying}
          style={{
            width: '100%',
            background: paying ? 'rgba(55,181,155,.3)' : '#37b59b',
            color: '#0c2429',
            border: 'none',
            borderRadius: 10,
            padding: '8px 0',
            fontSize: 13,
            fontWeight: 600,
            cursor: paying ? 'default' : 'pointer',
          }}
        >
          {paying ? '…' : 'Pay'}
        </button>
      )}
      {done && (
        <p
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '0.6rem',
            color: 'var(--jade-deep)',
            textAlign: 'center',
          }}
        >
          Paid
        </p>
      )}
    </div>
  );
}

/* ── system line ──────────────────────────────────────────────────────────── */
function SystemLine({ text }: { text: string }) {
  return (
    <p
      style={{
        fontFamily: 'var(--mono)',
        fontSize: '0.58rem',
        color: 'rgba(13,31,36,0.38)',
        textAlign: 'center',
        lineHeight: 1.6,
      }}
    >
      {text}
    </p>
  );
}

/* ── chat bubble ──────────────────────────────────────────────────────────── */
function Bubble({ msg, mine }: { msg: ChatMessage; mine: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: mine ? 'flex-end' : 'flex-start',
        gap: 3,
      }}
    >
      {!mine && (
        <p
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '0.56rem',
            color: 'rgba(13,31,36,.5)',
            marginLeft: 4,
          }}
        >
          {msg.sender_name}
        </p>
      )}
      <div
        style={{
          background: mine ? '#37b59b' : '#fff',
          color: mine ? '#0c2429' : 'var(--ink)',
          border: mine ? 'none' : '1px solid var(--line)',
          borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          padding: '9px 12px',
          maxWidth: '78%',
          fontSize: 13.5,
          lineHeight: 1.5,
          wordBreak: 'break-word',
        }}
      >
        {msg.content}
      </div>
      <p style={{ fontFamily: 'var(--mono)', fontSize: '0.52rem', color: 'rgba(13,31,36,.3)', marginRight: mine ? 2 : 0, marginLeft: mine ? 0 : 4 }}>
        {timeOf(msg.created_at)}
      </p>
    </div>
  );
}

/* ── members panel ────────────────────────────────────────────────────────── */
function MembersPanel({
  planId,
  isAdmin,
  onClose,
  onMemberRemoved,
  onGroupDeleted,
}: {
  planId: string;
  isAdmin: boolean;
  onClose: () => void;
  onMemberRemoved: () => void;
  onGroupDeleted: () => void;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<FamilyPlanMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    listPlanMembers(planId)
      .then(setMembers)
      .finally(() => setLoading(false));
  }, [planId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleRemove(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from this group?`)) return;
    setRemovingId(memberId);
    try {
      await removeMember(memberId, planId);
      setMembers(m => m.filter(x => x.id !== memberId));
      setToast(`${name} removed`);
      onMemberRemoved();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not remove member');
    }
    setRemovingId(null);
  }

  async function handleDeleteGroup() {
    if (!confirm('Delete this group permanently? All messages will be lost.')) return;
    setDeleting(true);
    try {
      await deleteFamilyPlan(planId);
      onGroupDeleted();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not delete group');
      setDeleting(false);
    }
  }

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(13,31,36,.45)',
      zIndex: 50,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
    }}>
      <div style={{
        background: '#fbf9f4',
        borderRadius: '20px 20px 0 0',
        padding: '0 0 32px',
        maxHeight: '75%',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* handle bar */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(13,31,36,.15)' }} />
        </div>

        {/* title row */}
        <div style={{ padding: '6px 18px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <p style={{ fontFamily: 'var(--serif)', fontSize: '1.15rem', fontWeight: 300, flex: 1 }}>Members</p>
          {isAdmin && (
            <button
              onClick={() => router.push(`/family/invite?planId=${planId}`)}
              style={{
                background: 'rgba(55,181,155,.1)', border: '1px solid var(--jade)',
                color: 'var(--jade-deep)', borderRadius: 10, padding: '6px 12px',
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              }}
            >
              + Add member
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              color: 'rgba(13,31,36,.4)', fontSize: 20, cursor: 'pointer', padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* member list */}
        <div style={{ overflowY: 'auto', padding: '0 16px', flex: 1 }}>
          {loading ? (
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', opacity: 0.4, textAlign: 'center', marginTop: 20 }}>Loading…</p>
          ) : members.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 0', borderBottom: '1px solid var(--line)',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: m.is_self ? 'linear-gradient(150deg,#13343b,#0c2429)' : 'linear-gradient(150deg,#5a8fa8,#33607a)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: 'var(--serif)',
              }}>
                {initials(m.display_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
                  {m.display_name}
                  {m.is_self && <span style={{ fontFamily: 'var(--mono)', fontSize: '0.52rem', color: 'rgba(13,31,36,.35)', marginLeft: 5 }}>you</span>}
                </p>
                <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(13,31,36,.4)' }}>
                  {m.role}{m.status === 'invited' ? ' · pending invite' : ''}
                </p>
              </div>
              {isAdmin && !m.is_self && (
                <button
                  onClick={() => handleRemove(m.id, m.display_name)}
                  disabled={removingId === m.id}
                  style={{
                    background: 'none', border: '1px solid rgba(194,103,94,.4)',
                    color: '#c2675e', borderRadius: 9, padding: '5px 10px',
                    fontSize: 12, cursor: 'pointer', flexShrink: 0,
                    opacity: removingId === m.id ? 0.5 : 1,
                  }}
                >
                  {removingId === m.id ? '…' : 'Remove'}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* delete group button — admin only */}
        {isAdmin && (
          <div style={{ padding: '14px 16px 4px', borderTop: '1px solid var(--line)' }}>
            <button
              onClick={handleDeleteGroup}
              disabled={deleting}
              style={{
                width: '100%', background: 'none',
                border: '1px solid rgba(194,103,94,.4)', borderRadius: 12,
                padding: '11px 0', color: '#c2675e', fontSize: 13,
                fontWeight: 600, cursor: 'pointer', opacity: deleting ? 0.5 : 1,
              }}
            >
              {deleting ? 'Deleting…' : 'Delete Group'}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div style={{
          position: 'absolute', bottom: 90, left: 16, right: 16,
          background: 'linear-gradient(160deg,#13343b,#0c2429)', color: '#f6f3ec',
          borderRadius: 12, padding: '10px 13px', fontSize: 12.5, zIndex: 55,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/* ── inner page (needs useSearchParams, so wrapped in Suspense) ───────────── */
function HubPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const planId = params.get('planId') ?? undefined;

  const [hub, setHub] = useState<HubInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const chat = useChatSocket({ enabled: !!hub });
  // Stable callbacks from the hook (useCallback([])) — safe as effect deps.
  const { state: socketState, connected: socketConnected, onMessage, joinRoom: joinChatRoom, sendRoom: sendChatRoom, markRead: markChatRead } = chat;

  useEffect(() => {
    const id = typeof window === 'undefined' ? null : localStorage.getItem('pal_user_id');
    setMyUserId(id);
    myUserIdRef.current = id;
  }, []);

  // Load hub + history.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await getHub(planId);
        if (cancelled) return;
        if (!h) {
          setError('You are not part of this group.');
          setLoading(false);
          return;
        }
        setHub(h);
        // Load messages + check admin status in parallel
        const [msgs, members] = await Promise.all([
          getRoomMessages(h.room_id, 80),
          listPlanMembers(planId),
        ]);
        if (!cancelled) {
          setMessages(msgs);
          announceChatRead();
          // Admin = user is in the member list with role 'admin'
          const myId = localStorage.getItem('pal_user_id');
          const me = members.find(m => m.is_self || m.user_id === myId);
          setIsAdmin(me?.role === 'admin');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open the Care Hub');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [planId]);

  // Join room once socket is open. Stable deps: socketConnected is a boolean,
  // joinChatRoom is from useCallback([]), hub.room_id is set once on load.
  useEffect(() => {
    if (socketConnected && hub) joinChatRoom(hub.room_id);
  }, [socketConnected, hub, joinChatRoom]);

  // Live frame handler. Runs once when hub loads (hub/onMessage/markChatRead are
  // all stable after that). myUserIdRef is used instead of myUserId to avoid
  // re-registering the listener every time the user id resolves from localStorage.
  useEffect(() => {
    if (!hub) return;
    return onMessage((f: ChatFrame) => {
      if (f.type !== 'room_message') return;
      if (f.room_id !== hub.room_id) return;
      const incoming: ChatMessage = {
        id: String(f.message_id),
        sender_id: String(f.sender_id ?? f.from ?? ''),
        sender_name: String(f.sender_name ?? 'Someone'),
        content: String(f.content ?? ''),
        content_type: String(f.content_type ?? 'text'),
        payload: (f.payload as Record<string, unknown> | null) ?? null,
        subject_member_id: null,
        reply_to_id: (f.reply_to_id as string | null) ?? null,
        message_type: 'room',
        created_at: String(f.timestamp ?? new Date().toISOString()),
      };
      setMessages(prev => (prev.some(m => m.id === incoming.id) ? prev : [...prev, incoming]));
      if (incoming.sender_id !== myUserIdRef.current) {
        markChatRead(incoming.id);
        announceChatRead();
      }
    });
  }, [hub, onMessage, markChatRead]);

  // Pin to bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !hub || sending) return;
    setSending(true);
    setDraft('');

    const viaSocket = socketConnected && sendChatRoom(hub.room_id, text);
    if (!viaSocket) {
      try {
        await sendRoomMessageRest(hub.room_id, text);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not send');
        setDraft(text);
        setSending(false);
        return;
      }
    }

    setMessages(prev => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        sender_id: myUserIdRef.current ?? 'me',
        sender_name: 'You',
        content: text,
        content_type: 'text',
        payload: null,
        subject_member_id: null,
        reply_to_id: null,
        message_type: 'room',
        created_at: new Date().toISOString(),
      },
    ]);
    setSending(false);
  }, [draft, hub, sending, socketConnected, sendChatRoom]);

  function handlePaid(paymentId: string) {
    listPayments().catch(() => undefined);
  }

  const connLabel =
    socketState === 'open' ? 'live' : socketState === 'connecting' ? 'connecting…' : 'offline';

  return (
    <PhoneShell>
      <div style={{ height: 28 }} />

      {/* header */}
      <div style={{
        padding: '10px 18px 10px', flexShrink: 0,
        borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button
          onClick={() => router.push('/family')}
          aria-label="Back"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 16, color: 'rgba(13,31,36,0.45)' }}
        >
          ←
        </button>
        {/* group name — tap to open members panel */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowMembers(true)}
          onKeyDown={e => e.key === 'Enter' && setShowMembers(true)}
          aria-label="View group members"
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
        >
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.55rem', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.45 }}>
            Care Hub
          </p>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 300, fontSize: '1.05rem', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {hub?.name ?? 'Family'}
          </h2>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.52rem', color: chat.state === 'open' ? 'var(--jade-deep)' : 'rgba(13,31,36,0.35)', flexShrink: 0 }}>
          {connLabel}
        </span>
        {/* Members button */}
        <button
          onClick={() => setShowMembers(true)}
          aria-label="Members"
          style={{
            background: 'none', border: '1px solid var(--line-2)',
            borderRadius: 9, padding: '5px 8px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
            color: 'rgba(13,31,36,.55)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="5" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M1 11.5c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="10.5" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M12.5 11.5c0-1.5-1-2.5-2-2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          {isAdmin && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.52rem', fontWeight: 700, color: 'var(--jade-deep)' }}>
              Admin
            </span>
          )}
        </button>
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        className="scr"
        style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {loading && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', opacity: 0.4, textAlign: 'center' }}>Loading…</p>
        )}

        {!loading && error && (
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <p style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', fontWeight: 300, marginBottom: 6 }}>{error}</p>
            <button
              onClick={() => router.push('/family')}
              style={{ background: 'none', border: '1px solid var(--line-2)', borderRadius: 11, padding: '7px 14px', fontSize: 12, cursor: 'pointer', marginTop: 8 }}
            >
              Back to Groups
            </button>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', opacity: 0.4, textAlign: 'center', marginTop: 40, lineHeight: 1.7 }}>
            No messages yet.<br />Coordinate appointments, reminders and payments here.
          </p>
        )}

        {messages.map(m => {
          if (m.content_type === 'payment_request')
            return <PaymentCard key={m.id} msg={m} canPay={!!hub?.can_pay} onPaid={handlePaid} />;
          if (m.message_type === 'system' || m.content_type === 'care_event')
            return <SystemLine key={m.id} text={m.content} />;
          return <Bubble key={m.id} msg={m} mine={m.sender_id === myUserId} />;
        })}
      </div>

      {/* privacy footnote */}
      {!loading && !error && (
        <p style={{ fontFamily: 'var(--mono)', fontSize: '0.52rem', color: 'rgba(13,31,36,0.32)', textAlign: 'center', padding: '0 18px 6px', flexShrink: 0 }}>
          Everyone in the plan sees this room. Clinical details stay private.
        </p>
      )}

      {/* composer */}
      {!loading && !error && (
        <div style={{
          flexShrink: 0, padding: '8px 12px 10px', borderTop: '1px solid var(--line)',
          display: 'flex', gap: 8, alignItems: 'center', background: '#fbf9f4',
          position: 'relative', zIndex: 16,
        }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Message the family…"
            maxLength={4000}
            style={{
              flex: 1, minWidth: 0, background: '#fff',
              border: '1px solid var(--line-2)', borderRadius: 12,
              padding: '9px 12px', fontSize: 13, fontFamily: 'var(--sans)',
              color: 'var(--ink)', outline: 'none',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            style={{
              background: draft.trim() ? '#37b59b' : 'rgba(13,31,36,.08)',
              color: draft.trim() ? '#0c2429' : 'rgba(13,31,36,.35)',
              border: 'none', borderRadius: 12, padding: '9px 14px',
              fontSize: 13, fontWeight: 600,
              cursor: draft.trim() ? 'pointer' : 'default', flexShrink: 0,
            }}
          >
            Send
          </button>
        </div>
      )}

      <div style={{ height: 72, flexShrink: 0 }} />
      <TabBar />

      {/* members panel */}
      {showMembers && planId && (
        <MembersPanel
          planId={planId}
          isAdmin={isAdmin}
          onClose={() => setShowMembers(false)}
          onMemberRemoved={() => { /* member count refreshes on next visit to the group list */ }}
          onGroupDeleted={() => router.replace('/family')}
        />
      )}
    </PhoneShell>
  );
}

/* ── page export (Suspense required for useSearchParams in App Router) ─────── */
export default function FamilyHubPage() {
  return (
    <Suspense fallback={null}>
      <HubPageInner />
    </Suspense>
  );
}
