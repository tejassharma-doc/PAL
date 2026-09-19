'use client';

/**
 * /family — EXTENDED, not replaced.
 *
 * Everything that was on this page before is still here, byte-for-byte in
 * behaviour: the `listFamilyMembers()` roster, the DEV_MEMBERS bypass, the
 * relation avatars, the scope pills, the revoke button, the privacy note.
 *
 * What is new, and additive:
 *   1. A Care Hub banner (only shown once /api/family/plan returns a plan).
 *   2. Pending access requests — the 1-tap consent handshake.
 *   3. A payments-due strip for billing delegates.
 *   4. A "Family plan" roster driven by the new /api/family/members endpoint,
 *      which reports per-member access resolution.
 *
 * All new sections fail closed: if the family-plan API is absent, disabled, or
 * errors, they render nothing and the original page is what you see.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import { listFamilyMembers, revokeConsent, FamilyMember } from '@/lib/api';
import {
  approveAccess,
  chatUnreadCount,
  denyAccess,
  getFamilyPlan,
  listAccessRequests,
  listPayments,
  listPlanMembers,
  payRequest,
  requestAccess,
  type AccessRequest,
  type FamilyPlanInfo,
  type FamilyPlanMember,
  type PaymentRequest,
} from '@/lib/family-api';

const DEV_BYPASS = process.env.NODE_ENV === 'development';

const DEV_MEMBERS: FamilyMember[] = [
  { user_id: 'priya',  name: 'Priya',  relation: 'SPOUSE',    scope: 'full',    grant_id: 'grant-priya'  },
  { user_id: 'meera',  name: 'Meera',  relation: 'CHILD_OF',  scope: 'partial', grant_id: 'grant-meera'  },
  { user_id: 'ramesh', name: 'Ramesh', relation: 'PARENT_OF', scope: null,      grant_id: 'grant-ramesh' },
];

/* Avatar gradient by relation — matches HTML .fava colour system */
function getAvatarGradient(relation: string): string {
  const r = relation.toUpperCase();
  if (r.includes('SPOUSE') || r.includes('PARTNER')) return 'linear-gradient(150deg,#5a8fa8,#33607a)';
  if (r.includes('CHILD') || r.includes('SON') || r.includes('DAUGHTER'))
    return 'linear-gradient(150deg,var(--amber),#b07d2c)';
  if (r.includes('PARENT') || r.includes('FATHER') || r.includes('MOTHER') || r.includes('MOM') || r.includes('DAD'))
    return 'linear-gradient(150deg,#9c7bb0,#6a4a86)';
  return 'linear-gradient(150deg,var(--jade),var(--jade-deep))';
}

/* Scope pill config */
function getScopePill(scope: string | null): { label: string; bg: string; color: string } | null {
  if (!scope) return null;
  const s = scope.toLowerCase();
  if (s.includes('full') || s.includes('all'))
    return { label: 'full access', bg: 'rgba(55,181,155,.12)', color: 'var(--jade-deep)' };
  if (s.includes('partial') || s.includes('specific') || s.includes('annotate'))
    return { label: 'partial', bg: 'rgba(216,162,74,.16)', color: 'var(--amber-deep)' };
  if (s.includes('read') || s.includes('view'))
    return { label: 'view only', bg: 'rgba(13,31,36,.06)', color: 'rgba(13,31,36,0.45)' };
  return null;
}

/* Scope pill for the NEW ladder: appointments < medications < summary < full */
function getPlanScopePill(scope: string | null): { label: string; bg: string; color: string } {
  switch (scope) {
    case 'full':
      return { label: 'full access', bg: 'rgba(55,181,155,.12)', color: 'var(--jade-deep)' };
    case 'summary':
      return { label: 'summary', bg: 'rgba(55,181,155,.10)', color: 'var(--jade-deep)' };
    case 'medications':
      return { label: 'medications', bg: 'rgba(216,162,74,.16)', color: 'var(--amber-deep)' };
    case 'appointments':
      return { label: 'appointments', bg: 'rgba(90,143,168,.16)', color: 'var(--blue-deep)' };
    default:
      return { label: 'no access', bg: 'rgba(13,31,36,.04)', color: 'rgba(13,31,36,0.35)' };
  }
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function mapRelation(relation: string): string {
  const map: Record<string, string> = {
    SPOUSE:    'Spouse',
    PARENT_OF: 'Parent',
    CHILD_OF:  'Child',
  };
  return map[relation.toUpperCase()] ?? relation;
}

function SkeletonCard() {
  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--line)', padding: '14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 44, height: 44, borderRadius: 13, background: 'rgba(13,31,36,.08)', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ width: 90, height: 12, borderRadius: 6, background: 'rgba(13,31,36,.08)', marginBottom: 7 }} />
        <div style={{ width: 60, height: 10, borderRadius: 6, background: 'rgba(13,31,36,.05)' }} />
      </div>
      <div style={{ width: 70, height: 22, borderRadius: 11, background: 'rgba(13,31,36,.06)' }} />
    </div>
  );
}

/* ── NEW: section label ───────────────────────────────────────────────────── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'var(--mono)', fontSize: '0.55rem', letterSpacing: '0.12em',
      textTransform: 'uppercase', color: 'var(--jade-deep)', opacity: 0.8,
      margin: '14px 2px 6px',
    }}>
      {children}
    </p>
  );
}

export default function FamilyPage() {
  const router = useRouter();

  /* ---- original state (unchanged) ---- */
  const [members,  setMembers]  = useState<FamilyMember[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  /* ---- new state (family plan) ---- */
  const [plan, setPlan] = useState<FamilyPlanInfo | null>(null);
  const [planMembers, setPlanMembers] = useState<FamilyPlanMember[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [unread, setUnread] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* ---- original effect (unchanged) ---- */
  useEffect(() => {
    if (DEV_BYPASS) {
      setMembers(DEV_MEMBERS);
      setActiveId(DEV_MEMBERS[0].user_id);
      setLoading(false);
      return;
    }
    listFamilyMembers()
      .then(m => {
        setMembers(m);
        if (m.length > 0) setActiveId(m[0].user_id);
      })
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, []);

  /* ---- new effect: family plan. Fails closed; never blocks the page. ---- */
  const loadPlan = useCallback(async () => {
    try {
      const p = await getFamilyPlan();
      if (!p) { setPlan(null); return; }
      setPlan(p);
      const [pm, rq, py, un] = await Promise.all([
        listPlanMembers(),
        listAccessRequests(),
        listPayments(),
        chatUnreadCount(),
      ]);
      setPlanMembers(pm);
      setRequests(rq);
      setPayments(py.filter(x => x.status === 'pending'));
      setUnread(un);
    } catch {
      setPlan(null);
    }
  }, []);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  /* ---- original handler (unchanged) ---- */
  async function handleRevoke(grantId: string) {
    setRevoking(grantId);
    try {
      await revokeConsent(grantId);
      const updated = await listFamilyMembers();
      setMembers(updated);
    } catch { /* ignore */ }
    setRevoking(null);
  }

  /* ---- new handlers ---- */
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

  async function ask(memberId: string) {
    setBusyId(memberId);
    try {
      await requestAccess({ subject_member_id: memberId, scope: 'medications' });
      setToast('Request sent — they will get a notification');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not send request');
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <PhoneShell>
      <div style={{ height: 28 }} />

      {/* Header with Back Button */}
      <div style={{ padding: '12px 18px 8px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button
            onClick={() => router.push('/')}
            style={{
              border: 'none',
              background: 'none',
              fontSize: '1.5rem',
              color: 'var(--ink)',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center'
            }}
            aria-label="Back to home"
          >
            ‹
          </button>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.45, marginBottom: 4 }}>
              Family
            </p>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 300, fontSize: '1.5rem', color: 'var(--ink)', lineHeight: 1.2 }}>
              Whose health today?
            </h2>
          </div>
        </div>
      </div>

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 84px' }}>

        {/* ── NEW: Care Hub banner ───────────────────────────────────────── */}
        {plan?.hub_room_id && (
          <button
            onClick={() => router.push('/family/hub')}
            style={{
              width: '100%', textAlign: 'left', cursor: 'pointer',
              background: 'linear-gradient(160deg,#13343b,#0c2429)',
              border: 'none', borderRadius: 14, padding: '13px 14px',
              display: 'flex', alignItems: 'center', gap: 11, marginBottom: 4,
              boxShadow: '0 10px 26px -16px rgba(13,31,36,.9)',
            }}
          >
            <div style={{
              width: 38, height: 38, borderRadius: 12, flexShrink: 0,
              background: 'rgba(55,181,155,.18)', display: 'grid', placeItems: 'center',
              color: 'var(--jade)', fontSize: 15,
            }}>
              ✻
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: '#f6f3ec', marginBottom: 2 }}>
                Care Hub
              </p>
              <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(246,243,236,.55)' }}>
                {plan.name}
              </p>
            </div>
            {unread > 0 && (
              <span style={{
                minWidth: 18, height: 18, borderRadius: 9, background: '#c2675e', color: '#fff',
                fontFamily: 'var(--mono)', fontSize: '0.54rem', fontWeight: 700,
                display: 'grid', placeItems: 'center', padding: '0 5px', flexShrink: 0,
              }}>
                {unread}
              </span>
            )}
          </button>
        )}

        {/* ── NEW: pending consent requests ──────────────────────────────── */}
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
                    <p style={{
                      fontFamily: 'var(--mono)', fontSize: '0.58rem',
                      color: 'rgba(13,31,36,0.45)', lineHeight: 1.6, marginBottom: 9,
                    }}>
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
                    >
                      Allow
                    </button>
                    <button
                      onClick={() => decide(r.id, false)}
                      disabled={busyId === r.id}
                      style={{
                        flex: 1, background: 'transparent', color: 'rgba(13,31,36,.6)',
                        border: '1px solid var(--line-2)', borderRadius: 11,
                        padding: '9px 0', fontSize: 13, cursor: 'pointer',
                      }}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── NEW: payments due ──────────────────────────────────────────── */}
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
                    <p style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 2 }}>
                      {p.description}
                    </p>
                    <p style={{
                      fontFamily: 'var(--serif)', fontSize: '1.1rem',
                      fontWeight: 300, color: 'var(--ink)',
                    }}>
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
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: '0.55rem',
                      color: 'rgba(13,31,36,0.35)', flexShrink: 0, maxWidth: 90,
                      textAlign: 'right', lineHeight: 1.5,
                    }}>
                      awaiting a billing member
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── NEW: family plan roster with real access resolution ────────── */}
        {plan && planMembers.length > 0 && (
          <>
            <SectionLabel>{plan.name}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {planMembers.map(m => {
                const pill = getPlanScopePill(m.my_access_scope);
                return (
                  <div key={m.id} style={{
                    background: '#fff', borderRadius: 14, border: '1px solid var(--line)',
                    padding: '14px', display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 13, flexShrink: 0,
                      background: getAvatarGradient(m.relationship_type),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 600, fontSize: 15, fontFamily: 'var(--serif)',
                    }}>
                      {initials(m.display_name)}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
                        {m.display_name}
                        {m.is_self && (
                          <span style={{
                            fontFamily: 'var(--mono)', fontSize: '0.52rem',
                            color: 'rgba(13,31,36,0.35)', marginLeft: 6,
                          }}>
                            you
                          </span>
                        )}
                      </p>
                      <p style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'rgba(13,31,36,0.45)' }}>
                        {m.relationship_type}
                        {m.is_minor ? ' · minor' : ''}
                        {m.status === 'invited' ? ' · invited' : ''}
                      </p>
                      {!m.is_self && !m.my_access_scope && m.status === 'active' && (
                        <button
                          onClick={() => ask(m.id)}
                          disabled={busyId === m.id}
                          style={{
                            fontFamily: 'var(--mono)', fontSize: '0.58rem',
                            color: 'var(--jade-deep)', background: 'none', border: 'none',
                            padding: 0, cursor: 'pointer', marginTop: 4,
                          }}
                        >
                          {busyId === m.id ? 'Sending…' : 'Request access'}
                        </button>
                      )}
                    </div>

                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: '0.6rem', fontWeight: 700,
                      background: pill.bg, color: pill.color,
                      borderRadius: 11, padding: '3px 9px', whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {pill.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <p style={{
              fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(13,31,36,0.38)',
              marginTop: 10, lineHeight: 1.7, textAlign: 'center',
            }}>
              Being in a family plan grants no access on its own.
              <br />
              Each person decides who may see their record.
            </p>
          </>
        )}

        {/* ── ORIGINAL: consent roster (unchanged behaviour) ─────────────── */}
        {(members.length > 0 || loading) && plan && <SectionLabel>Shared with me</SectionLabel>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {loading && [0, 1, 2].map(i => <SkeletonCard key={i} />)}

          {!loading && members.map(m => {
            const pill    = getScopePill(m.scope);
            const isActive = activeId === m.user_id;
            return (
              <div
                key={m.user_id}
                onClick={() => setActiveId(m.user_id)}
                style={{
                  background: '#fff', borderRadius: 14,
                  border: isActive ? '1px solid var(--jade)' : '1px solid var(--line)',
                  boxShadow: isActive ? '0 8px 24px -12px rgba(55,181,155,.5)' : 'none',
                  padding: '14px', display: 'flex', alignItems: 'center', gap: 12,
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                {/* Rounded-rect avatar (.fava) */}
                <div style={{
                  width: 44, height: 44, borderRadius: 13, flexShrink: 0,
                  background: getAvatarGradient(m.relation),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 600, fontSize: 15,
                  fontFamily: 'var(--serif)',
                }}>
                  {initials(m.name)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{m.name}</p>
                  <p style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'rgba(13,31,36,0.45)' }}>
                    {mapRelation(m.relation)}
                  </p>
                  {m.grant_id && (
                    <button
                      onClick={e => { e.stopPropagation(); handleRevoke(m.grant_id!); }}
                      disabled={revoking === m.grant_id}
                      style={{
                        fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(194,103,94,.8)',
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        marginTop: 4, opacity: revoking === m.grant_id ? 0.5 : 1,
                      }}
                    >
                      {revoking === m.grant_id ? 'Removing…' : 'Remove access'}
                    </button>
                  )}
                </div>

                {/* Scope pill (.fr .scope / .scope.partial) */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  {pill ? (
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: '0.6rem', fontWeight: 700,
                      background: pill.bg, color: pill.color,
                      borderRadius: 11, padding: '3px 9px', whiteSpace: 'nowrap',
                    }}>
                      {pill.label}
                    </span>
                  ) : (
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: '0.6rem',
                      background: 'rgba(13,31,36,.04)', color: 'rgba(13,31,36,0.35)',
                      borderRadius: 11, padding: '3px 9px',
                    }}>
                      no access
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add family member — dashed card */}
          {!loading && (
            <button
              onClick={() => router.push('/family/invite')}
              style={{
                background: 'transparent', borderRadius: 14,
                border: '1.5px dashed var(--mist)', padding: '20px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                cursor: 'pointer', color: 'rgba(13,31,36,0.4)', width: '100%',
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
              <span style={{ fontSize: 13, fontWeight: 500 }}>Add family member</span>
            </button>
          )}
        </div>

        {/* Privacy note */}
        {!loading && members.length > 0 && (
          <p style={{
            fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'rgba(13,31,36,0.4)',
            marginTop: 16, lineHeight: 1.6, textAlign: 'center',
          }}>
            Family members access only what you&apos;ve shared.
            <br />
            You can remove access at any time.
          </p>
        )}
      </div>

      {/* toast */}
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
    </PhoneShell>
  );
}
