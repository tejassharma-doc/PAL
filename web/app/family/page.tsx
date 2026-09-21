'use client';

/**
 * /family — Group list screen (WhatsApp-style).
 *
 * Shows every family group the user belongs to. Tapping a group
 * opens its hub chat at /family/hub?planId=<id>.
 * Admins can create up to MAX_PLANS_PER_USER groups.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import {
  approveAccess,
  chatUnreadCount,
  createFamilyPlan,
  denyAccess,
  getFamilyPlans,
  listAccessRequests,
  listPayments,
  payRequest,
  type AccessRequest,
  type FamilyPlanListItem,
  type PaymentRequest,
} from '@/lib/family-api';

function initials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function GroupAvatar({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 14, flexShrink: 0,
      background: isAdmin
        ? 'linear-gradient(150deg,#13343b,#0c2429)'
        : 'linear-gradient(150deg,#5a8fa8,#33607a)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--serif)',
      position: 'relative',
    }}>
      {initials(name)}
      {isAdmin && (
        <span style={{
          position: 'absolute', bottom: -3, right: -3,
          width: 14, height: 14, borderRadius: 7,
          background: '#37b59b', border: '2px solid #fff',
          display: 'grid', placeItems: 'center',
          fontSize: 7, color: '#fff', fontWeight: 800,
        }}>
          A
        </span>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'var(--mono)', fontSize: '0.55rem', letterSpacing: '0.12em',
      textTransform: 'uppercase', color: 'var(--jade-deep)', opacity: 0.8,
      margin: '16px 2px 7px',
    }}>
      {children}
    </p>
  );
}

/* ── create group modal ─────────────────────────────────────────────────── */
function CreateGroupModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, displayName: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !displayName.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await onCreate(name.trim(), displayName.trim());
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create group');
    }
    setBusy(false);
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(13,31,36,.55)',
      display: 'flex', alignItems: 'flex-end', zIndex: 60,
    }}>
      <div style={{
        background: '#fff', borderRadius: '20px 20px 0 0',
        padding: '22px 18px 36px', width: '100%',
      }}>
        <p style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 300, marginBottom: 18 }}>
          New group
        </p>
        <input
          placeholder="Group name (e.g. Kumar Family)"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12,
            border: '1px solid var(--line-2)', fontSize: 14,
            fontFamily: 'inherit', marginBottom: 10, boxSizing: 'border-box',
          }}
        />
        <input
          placeholder="Your name in this group"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12,
            border: '1px solid var(--line-2)', fontSize: 14,
            fontFamily: 'inherit', marginBottom: 16, boxSizing: 'border-box',
          }}
        />
        {err && <p style={{ color: '#c2675e', fontSize: 12.5, marginBottom: 10 }}>{err}</p>}
        <button
          onClick={submit}
          disabled={busy || !name.trim() || !displayName.trim()}
          style={{
            width: '100%', background: '#37b59b', color: '#0c2429', border: 'none',
            borderRadius: 13, padding: '13px 0', fontSize: 15, fontWeight: 600,
            cursor: 'pointer', opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Creating…' : 'Create group'}
        </button>
        <button
          onClick={onClose}
          style={{
            width: '100%', background: 'none', border: 'none',
            color: 'rgba(13,31,36,.45)', fontSize: 13, marginTop: 10, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── page ───────────────────────────────────────────────────────────────── */
export default function FamilyPage() {
  const router = useRouter();

  const [plans, setPlans] = useState<FamilyPlanListItem[]>([]);
  const [canJoinMore, setCanJoinMore] = useState(true);
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pl, rq, py, un] = await Promise.all([
        getFamilyPlans(),
        listAccessRequests(),
        listPayments(),
        chatUnreadCount(),
      ]);
      setPlans(pl.plans);
      setCanJoinMore(pl.can_join_more);
      setRequests(rq);
      setPayments(py.filter(x => x.status === 'pending'));
      // Spread the total unread count across plans proportionally (rough heuristic).
      // Each plan's accurate unread count comes from its hub room; for now mark
      // the first plan that has a hub room with the total count.
      if (pl.plans.length > 0 && un > 0) {
        const first = pl.plans.find(p => p.hub_room_id);
        if (first) setUnreadMap({ [first.plan_id]: un });
      }
    } catch {
      // fail closed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  async function decide(id: string, approve: boolean) {
    setBusyId(id);
    try {
      if (approve) await approveAccess(id);
      else await denyAccess(id);
      setRequests(r => r.filter(x => x.id !== id));
      setToast(approve ? 'Access granted' : 'Request declined');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not update');
    }
    setBusyId(null);
  }

  async function settle(paymentId: string) {
    setBusyId(paymentId);
    try {
      await payRequest(paymentId);
      setPayments(p => p.filter(x => x.id !== paymentId));
      setToast('Payment settled');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Payment failed');
    }
    setBusyId(null);
  }

  async function handleCreate(name: string, displayName: string) {
    await createFamilyPlan({ name, display_name: displayName });
    await load();
  }

  return (
    <PhoneShell>
      <div style={{ height: 28 }} />

      {/* Header */}
      <div style={{ padding: '12px 18px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => router.push('/')}
          style={{ border: 'none', background: 'none', fontSize: '1.5rem', color: 'var(--ink)', cursor: 'pointer', padding: 0, lineHeight: 1 }}
          aria-label="Back"
        >
          ‹
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.45, marginBottom: 2 }}>
            Family
          </p>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 300, fontSize: '1.5rem', color: 'var(--ink)', lineHeight: 1.2 }}>
            Groups
          </h2>
        </div>
        {canJoinMore && (
          <button
            onClick={() => setShowCreate(true)}
            style={{
              width: 36, height: 36, borderRadius: 11, border: '1.5px solid var(--jade)',
              background: 'rgba(55,181,155,.08)', color: 'var(--jade)',
              display: 'grid', placeItems: 'center', cursor: 'pointer',
            }}
            aria-label="Create new group"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 3v9M3 7.5h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 84px' }}>

        {/* Group list */}
        {loading ? (
          [0, 1].map(i => (
            <div key={i} style={{
              background: '#fff', borderRadius: 14, border: '1px solid var(--line)',
              padding: '14px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8,
            }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(13,31,36,.08)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ width: 110, height: 13, borderRadius: 6, background: 'rgba(13,31,36,.08)', marginBottom: 8 }} />
                <div style={{ width: 70, height: 10, borderRadius: 6, background: 'rgba(13,31,36,.05)' }} />
              </div>
            </div>
          ))
        ) : plans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0 20px' }}>
            <p style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', fontWeight: 300, color: 'var(--ink)', marginBottom: 8 }}>
              No groups yet
            </p>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'rgba(13,31,36,.4)', lineHeight: 1.7 }}>
              Create a group to coordinate care<br />with your family.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
            {plans.map(p => {
              const unread = unreadMap[p.plan_id] ?? 0;
              return (
                <button
                  key={p.plan_id}
                  onClick={() => router.push(`/family/hub?planId=${p.plan_id}`)}
                  style={{
                    width: '100%', textAlign: 'left', cursor: 'pointer',
                    background: '#fff', border: '1px solid var(--line)',
                    borderRadius: 14, padding: '13px 14px',
                    display: 'flex', alignItems: 'center', gap: 13,
                  }}
                >
                  <GroupAvatar name={p.name} isAdmin={p.is_admin} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>
                      {p.name}
                    </p>
                    <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', color: 'rgba(13,31,36,.45)' }}>
                      {p.member_count} member{p.member_count !== 1 ? 's' : ''}
                      {p.is_admin ? ' · admin' : ''}
                    </p>
                  </div>
                  {unread > 0 && (
                    <span style={{
                      minWidth: 20, height: 20, borderRadius: 10,
                      background: '#c2675e', color: '#fff',
                      fontFamily: 'var(--mono)', fontSize: '0.55rem', fontWeight: 700,
                      display: 'grid', placeItems: 'center', padding: '0 5px', flexShrink: 0,
                    }}>
                      {unread}
                    </span>
                  )}
                  <svg width="7" height="12" viewBox="0 0 7 12" fill="none" style={{ flexShrink: 0, opacity: 0.3 }}>
                    <path d="M1 1l5 5-5 5" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              );
            })}
          </div>
        )}

        {/* Create group prompt when list is empty */}
        {!loading && canJoinMore && (
          <button
            onClick={() => setShowCreate(true)}
            style={{
              width: '100%', background: 'transparent', borderRadius: 14,
              border: '1.5px dashed var(--mist)', padding: '20px 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              cursor: 'pointer', color: 'rgba(13,31,36,0.4)',
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 10, flexShrink: 0,
              border: '1.5px dashed var(--mist)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 3v8M3 7h8" stroke="rgba(13,31,36,0.35)" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </div>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Create a group</span>
          </button>
        )}

        {/* Pending consent requests */}
        {requests.length > 0 && (
          <>
            <SectionLabel>Awaiting your approval</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {requests.map(r => (
                <div key={r.id} style={{
                  background: '#fff', borderRadius: 14,
                  border: '1px solid rgba(216,162,74,.45)', padding: 13,
                }}>
                  <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 3 }}>
                    <strong>{r.grantee_name}</strong> would like to see{' '}
                    {r.subject_name}&apos;s <strong>{r.scope}</strong>.
                  </p>
                  {r.message && (
                    <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(13,31,36,0.45)', lineHeight: 1.6, marginBottom: 9 }}>
                      &ldquo;{r.message}&rdquo;
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                    <button
                      onClick={() => decide(r.id, true)}
                      disabled={busyId === r.id}
                      style={{
                        flex: 1, background: '#37b59b', color: '#0c2429', border: 'none',
                        borderRadius: 11, padding: '9px 0', fontSize: 13, fontWeight: 600,
                        cursor: 'pointer', opacity: busyId === r.id ? 0.6 : 1,
                      }}
                    >Allow</button>
                    <button
                      onClick={() => decide(r.id, false)}
                      disabled={busyId === r.id}
                      style={{
                        flex: 1, background: 'transparent', color: 'rgba(13,31,36,.6)',
                        border: '1px solid var(--line-2)', borderRadius: 11,
                        padding: '9px 0', fontSize: 13, cursor: 'pointer',
                      }}
                    >Not now</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Payments due */}
        {payments.length > 0 && (
          <>
            <SectionLabel>Payments due</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {payments.map(p => (
                <div key={p.id} style={{
                  background: '#fff', borderRadius: 14, border: '1px solid var(--line)',
                  padding: 13, display: 'flex', alignItems: 'center', gap: 11,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 2 }}>{p.description}</p>
                    <p style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', fontWeight: 300, color: 'var(--ink)' }}>
                      {p.amount_display}
                    </p>
                  </div>
                  {p.can_pay ? (
                    <button
                      onClick={() => settle(p.id)}
                      disabled={busyId === p.id}
                      style={{
                        background: '#37b59b', color: '#0c2429', border: 'none',
                        borderRadius: 11, padding: '8px 15px', fontSize: 13,
                        fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                        opacity: busyId === p.id ? 0.6 : 1,
                      }}
                    >
                      {busyId === p.id ? '…' : 'Pay'}
                    </button>
                  ) : (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.55rem', color: 'rgba(13,31,36,0.35)', flexShrink: 0, maxWidth: 90, textAlign: 'right', lineHeight: 1.5 }}>
                      awaiting billing member
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'absolute', bottom: 78, left: 16, right: 16,
          background: 'linear-gradient(160deg,#13343b,#0c2429)', color: '#f6f3ec',
          borderRadius: 12, padding: '10px 13px', fontSize: 12.5, zIndex: 40,
          boxShadow: '0 12px 30px -14px rgba(0,0,0,.7)',
        }}>
          {toast}
        </div>
      )}

      {/* Create group modal */}
      {showCreate && (
        <CreateGroupModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </PhoneShell>
  );
}
