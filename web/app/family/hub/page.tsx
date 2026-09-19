'use client';

/**
 * Family Care Hub — /family/hub
 *
 * The shared room where the household coordinates care. Three message kinds:
 *   - ordinary chat between members
 *   - `payment_request` cards  → tap to pay on someone else's behalf
 *   - `care_event` system lines → already redacted server-side
 *
 * PRIVACY NOTE FOR ANYONE EDITING THIS FILE:
 * Never render a field the server did not already redact. The backend strips
 * provider names, specialties and drug names before they are written to
 * `chat_messages` (services/family/policy.py::redact_for_hub). If you add a
 * field to the payload, redact it there — not here. Redacting in the UI leaves
 * the PHI in the database and in every client cache.
 *
 * Style: house Style A — PhoneShell, inline styles, CSS custom properties.
 * Content width inside PhoneShell is ~322px; nothing here assumes more.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import TabBar from '@/components/layout/TabBar';
import {
  getHub,
  getRoomMessages,
  listPayments,
  payRequest,
  sendRoomMessageRest,
  type ChatMessage,
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
  const paymentId = String(p.payment_request_id ?? '');
  const [status, setStatus] = useState<string>(String(p.status ?? 'pending'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const paid = status === 'paid';

  async function handlePay() {
    if (!paymentId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await payRequest(paymentId);
      setStatus(r.status);
      onPaid(paymentId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Payment failed');
    }
    setBusy(false);
  }

  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${paid ? 'var(--line)' : 'rgba(216,162,74,.45)'}`,
        borderRadius: 14,
        padding: 13,
        boxShadow: paid ? 'none' : '0 8px 22px -14px rgba(216,162,74,.7)',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--mono)',
          fontSize: '0.55rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: paid ? 'var(--jade-deep)' : 'var(--amber-deep)',
          marginBottom: 6,
        }}
      >
        {paid ? 'Paid' : 'Payment due'}
      </p>

      <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 10 }}>
        {msg.content}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span
          style={{
            fontFamily: 'var(--serif)',
            fontSize: '1.35rem',
            fontWeight: 300,
            color: 'var(--ink)',
          }}
        >
          {String(p.amount_display ?? '')}
        </span>

        {paid ? (
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '0.6rem',
              background: 'rgba(55,181,155,.12)',
              color: 'var(--jade-deep)',
              borderRadius: 11,
              padding: '4px 10px',
            }}
          >
            settled
          </span>
        ) : canPay ? (
          <button
            onClick={handlePay}
            disabled={busy}
            style={{
              background: '#37b59b',
              color: '#0c2429',
              border: 'none',
              borderRadius: 11,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Paying…' : 'Pay now'}
          </button>
        ) : (
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '0.58rem',
              color: 'rgba(13,31,36,0.4)',
              textAlign: 'right',
              maxWidth: 150,
            }}
          >
            a billing member can settle this
          </span>
        )}
      </div>

      {err && (
        <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'var(--rose)', marginTop: 8 }}>
          {err}
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
        color: 'rgba(13,31,36,0.42)',
        textAlign: 'center',
        padding: '2px 12px',
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
    <div style={{ display: 'flex', gap: 8, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      {!mine && (
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 9,
            flexShrink: 0,
            background: 'linear-gradient(150deg,var(--jade),var(--jade-deep))',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            fontFamily: 'var(--serif)',
          }}
        >
          {initials(msg.sender_name || '?')}
        </div>
      )}
      <div style={{ maxWidth: 216 }}>
        {!mine && (
          <p
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '0.55rem',
              color: 'rgba(13,31,36,0.4)',
              marginBottom: 3,
            }}
          >
            {msg.sender_name}
          </p>
        )}
        <div
          style={
            mine
              ? {
                  background: 'linear-gradient(160deg,#13343b,#0c2429)',
                  color: '#f6f3ec',
                  borderRadius: 14,
                  padding: '9px 12px',
                  fontSize: 13,
                  lineHeight: 1.5,
                }
              : {
                  background: '#fff',
                  border: '1px solid rgba(13,31,36,.10)',
                  color: 'var(--ink)',
                  borderRadius: 14,
                  padding: '9px 12px',
                  fontSize: 13,
                  lineHeight: 1.5,
                }
          }
        >
          {msg.content}
        </div>
        <p
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '0.5rem',
            color: 'rgba(13,31,36,0.32)',
            marginTop: 3,
            textAlign: mine ? 'right' : 'left',
          }}
        >
          {timeOf(msg.created_at)}
        </p>
      </div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */
export default function FamilyHubPage() {
  const router = useRouter();
  const [hub, setHub] = useState<HubInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chat = useChatSocket({ enabled: !!hub });

  useEffect(() => {
    setMyUserId(typeof window === 'undefined' ? null : localStorage.getItem('pal_user_id'));
  }, []);

  // Load hub + history.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await getHub();
        if (cancelled) return;
        if (!h) {
          setError('You are not part of a family plan yet.');
          setLoading(false);
          return;
        }
        setHub(h);
        // getRoomMessages marks the room read server-side, so tell the AppBar
        // badge to clear now rather than waiting for its next poll.
        const msgs = await getRoomMessages(h.room_id, 80);
        if (!cancelled) {
          setMessages(msgs);
          announceChatRead();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open the Care Hub');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Join the room once the socket is up.
  useEffect(() => {
    if (chat.connected && hub) chat.joinRoom(hub.room_id);
  }, [chat.connected, hub, chat]);

  // Live frames.
  useEffect(() => {
    if (!hub) return;
    return chat.onMessage((f: ChatFrame) => {
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
      // De-dupe on message_id — our own optimistic row is reconciled here.
      setMessages(prev => (prev.some(m => m.id === incoming.id) ? prev : [...prev, incoming]));

      // The user is looking at this room, so acknowledge immediately. Without
      // this the AppBar badge would count messages that are on screen.
      if (incoming.sender_id !== myUserId) {
        chat.markRead(incoming.id);
        announceChatRead();
      }
    });
  }, [chat, hub, myUserId]);

  // Keep pinned to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !hub || sending) return;
    setSending(true);
    setDraft('');

    // Socket first; REST fallback keeps the hub usable on a blocked WS.
    const viaSocket = chat.connected && chat.sendRoom(hub.room_id, text);
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
        sender_id: myUserId ?? 'me',
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
  }, [draft, hub, sending, chat, myUserId]);

  function handlePaid(paymentId: string) {
    // Refresh the payment list so any duplicate card reflects the new status.
    listPayments().catch(() => undefined);
  }

  const connLabel =
    chat.state === 'open' ? 'live' : chat.state === 'connecting' ? 'connecting…' : 'offline';

  return (
    <PhoneShell>
      <div style={{ height: 28 }} />

      {/* header */}
      <div
        style={{
          padding: '10px 18px 10px',
          flexShrink: 0,
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <button
          onClick={() => router.push('/family')}
          aria-label="Back"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 16,
            color: 'rgba(13,31,36,0.45)',
          }}
        >
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '0.55rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              opacity: 0.45,
            }}
          >
            Care Hub
          </p>
          <h2
            style={{
              fontFamily: 'var(--serif)',
              fontWeight: 300,
              fontSize: '1.05rem',
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {hub?.name ?? 'Family'}
          </h2>
        </div>
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '0.52rem',
            color: chat.state === 'open' ? 'var(--jade-deep)' : 'rgba(13,31,36,0.35)',
            flexShrink: 0,
          }}
        >
          {connLabel}
        </span>
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        className="scr"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 14px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {loading && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', opacity: 0.4, textAlign: 'center' }}>
            Loading…
          </p>
        )}

        {!loading && error && (
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <p style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', fontWeight: 300, marginBottom: 6 }}>
              {error}
            </p>
            <button
              onClick={() => router.push('/family')}
              style={{
                background: 'none',
                border: '1px solid var(--line-2)',
                borderRadius: 11,
                padding: '7px 14px',
                fontSize: 12,
                cursor: 'pointer',
                marginTop: 8,
              }}
            >
              Back to Family
            </button>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <p
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '0.6rem',
              opacity: 0.4,
              textAlign: 'center',
              marginTop: 40,
              lineHeight: 1.7,
            }}
          >
            No messages yet.
            <br />
            Coordinate appointments, reminders and payments here.
          </p>
        )}

        {messages.map(m => {
          if (m.content_type === 'payment_request') {
            return (
              <PaymentCard key={m.id} msg={m} canPay={!!hub?.can_pay} onPaid={handlePaid} />
            );
          }
          if (m.message_type === 'system' || m.content_type === 'care_event') {
            return <SystemLine key={m.id} text={m.content} />;
          }
          return <Bubble key={m.id} msg={m} mine={m.sender_id === myUserId} />;
        })}
      </div>

      {/* privacy footnote */}
      {!loading && !error && (
        <p
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '0.52rem',
            color: 'rgba(13,31,36,0.32)',
            textAlign: 'center',
            padding: '0 18px 6px',
            flexShrink: 0,
          }}
        >
          Everyone in the plan sees this room. Clinical details stay private.
        </p>
      )}

      {/* composer */}
      {!loading && !error && (
        <div
          style={{
            flexShrink: 0,
            padding: '8px 12px 10px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            background: '#fbf9f4',
            position: 'relative',
            zIndex: 16,          // above TabBar's zIndex 15
          }}
        >
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Message the family…"
            maxLength={4000}
            style={{
              flex: 1,
              minWidth: 0,
              background: '#fff',
              border: '1px solid var(--line-2)',
              borderRadius: 12,
              padding: '9px 12px',
              fontSize: 13,
              fontFamily: 'var(--sans)',
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            style={{
              background: draft.trim() ? '#37b59b' : 'rgba(13,31,36,.08)',
              color: draft.trim() ? '#0c2429' : 'rgba(13,31,36,.35)',
              border: 'none',
              borderRadius: 12,
              padding: '9px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: draft.trim() ? 'pointer' : 'default',
              flexShrink: 0,
            }}
          >
            Send
          </button>
        </div>
      )}

      {/* Spacer for the TabBar.
          TabBar is `position:absolute; bottom:0; height:72; zIndex:15`, so it
          floats OVER whatever is at the bottom of the PhoneShell. Every other
          PAL screen copes by putting 84-92px of bottom padding on its scroll
          area — but this screen has a fixed composer below the scroll area, so
          padding does not help and the TabBar physically covered the Send
          button (verified in a real browser: the click was intercepted by the
          "Visits" tab). This spacer lifts the composer clear of it. */}
      <div style={{ height: 72, flexShrink: 0 }} />

      <TabBar />
    </PhoneShell>
  );
}
