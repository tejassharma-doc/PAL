'use client';

/**
 * /family/invite — admin invites a member by phone; anyone can claim a seat.
 *
 * Two modes on one screen, because the same household uses both:
 *   • Invite  — the admin creates a seat tagged to a phone number and gets a
 *               6-digit code to pass on. The seat exists immediately, so care
 *               coordination can start before the invitee installs anything.
 *   • Join    — someone who received a code claims their seat.
 *
 * The code is shown exactly once. The server stores only its SHA-256 hash and
 * allows three attempts, mirroring PAL's existing OTP flow.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import TabBar from '@/components/layout/TabBar';
import {
  acceptInvite,
  createFamilyPlan,
  getFamilyPlan,
  inviteMember,
  type FamilyPlanInfo,
} from '@/lib/family-api';
import { invalidateFamilyPlanCache } from '@/components/family/FamilyHubButton';

type Mode = 'invite' | 'join';

const RELATIONSHIPS = [
  { value: 'spouse', label: 'Spouse' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'other', label: 'Other' },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#fff',
  border: '1px solid var(--line-2)',
  borderRadius: 12,
  padding: '10px 12px',
  fontSize: 13,
  fontFamily: 'var(--sans)',
  color: 'var(--ink)',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: '0.55rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'rgba(13,31,36,0.45)',
  marginBottom: 5,
  display: 'block',
};

export default function FamilyInvitePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('invite');
  const [plan, setPlan] = useState<FamilyPlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  // invite form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+91');
  const [relation, setRelation] = useState('parent');
  const [role, setRole] = useState<'adult' | 'dependent_adult' | 'minor'>('dependent_adult');
  const [dob, setDob] = useState('');
  const [delegate, setDelegate] = useState(false);

  // join form
  const [joinPhone, setJoinPhone] = useState('+91');
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    getFamilyPlan()
      .then(p => {
        setPlan(p);
        if (!p) setMode('join');
      })
      .catch(() => setPlan(null))
      .finally(() => setLoading(false));
  }, []);

  async function ensurePlan(): Promise<boolean> {
    if (plan) return true;
    try {
      const nm = typeof window !== 'undefined'
        ? localStorage.getItem('pal_user_name') || localStorage.getItem('pal_full_name') || 'Me'
        : 'Me';
      await createFamilyPlan({ name: `${nm}'s Family`, display_name: nm });
      invalidateFamilyPlanCache();   // so the AppBar Hub button appears at once
      const p = await getFamilyPlan();
      setPlan(p);
      return !!p;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a family plan');
      return false;
    }
  }

  async function handleInvite() {
    setError(null);
    if (!name.trim()) { setError('Enter a name'); return; }
    if (!/^\+\d{6,}$/.test(phone.replace(/[\s-]/g, ''))) {
      setError('Phone must be in international format, e.g. +919876543210');
      return;
    }
    setBusy(true);
    if (await ensurePlan()) {
      try {
        const r = await inviteMember({
          display_name: name.trim(),
          phone: phone.replace(/[\s-]/g, ''),
          relationship_type: relation,
          role,
          date_of_birth: dob || undefined,
          is_billing_delegate: delegate,
        });
        setIssuedCode(r.invite_code);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not send the invitation');
      }
    }
    setBusy(false);
  }

  async function handleJoin() {
    setError(null);
    setBusy(true);
    try {
      const r = await acceptInvite(joinPhone.replace(/[\s-]/g, ''), joinCode.trim());
      invalidateFamilyPlanCache();   // the seat is claimed — reveal the Hub button
      setJoined(r.note);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join');
    }
    setBusy(false);
  }

  return (
    <PhoneShell>
      <div style={{ height: 28 }} />

      <div style={{
        padding: '10px 18px 10px', flexShrink: 0, borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button
          onClick={() => router.push('/family')}
          aria-label="Back"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 16, color: 'rgba(13,31,36,0.45)' }}
        >
          ←
        </button>
        <div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.55rem', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.45 }}>
            Family
          </p>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 300, fontSize: '1.05rem', color: 'var(--ink)' }}>
            Add someone
          </h2>
        </div>
      </div>

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 90px' }}>
        {loading && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', opacity: 0.4, textAlign: 'center' }}>
            Loading…
          </p>
        )}

        {!loading && (
          <>
            {/* mode switch */}
            <div style={{
              display: 'flex', gap: 6, background: 'rgba(13,31,36,.04)',
              borderRadius: 12, padding: 4, marginBottom: 16,
            }}>
              {(['invite', 'join'] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(null); }}
                  style={{
                    flex: 1, border: 'none', borderRadius: 9, padding: '7px 0',
                    fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    background: mode === m ? '#fff' : 'transparent',
                    color: mode === m ? 'var(--ink)' : 'rgba(13,31,36,.45)',
                    boxShadow: mode === m ? 'var(--shadow-sm)' : 'none',
                  }}
                >
                  {m === 'invite' ? 'Invite someone' : 'I have a code'}
                </button>
              ))}
            </div>

            {/* ── INVITE ─────────────────────────────────────────────────── */}
            {mode === 'invite' && !issuedCode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <label style={labelStyle}>Their name</label>
                  <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Amma" />
                </div>
                <div>
                  <label style={labelStyle}>Their phone</label>
                  <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+919876543210" inputMode="tel" />
                  <p style={{ fontFamily: 'var(--mono)', fontSize: '0.55rem', color: 'rgba(13,31,36,.35)', marginTop: 5, lineHeight: 1.6 }}>
                    They will be matched to this seat when they sign in with this number.
                  </p>
                </div>
                <div>
                  <label style={labelStyle}>Relationship</label>
                  <select style={inputStyle} value={relation} onChange={e => setRelation(e.target.value)}>
                    {RELATIONSHIPS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Kind of member</label>
                  <select
                    style={inputStyle}
                    value={role}
                    onChange={e => setRole(e.target.value as typeof role)}
                  >
                    <option value="adult">Adult — manages their own care</option>
                    <option value="dependent_adult">Adult needing help — e.g. elderly parent</option>
                    <option value="minor">Child under 18 — I am the guardian</option>
                  </select>
                  <p style={{ fontFamily: 'var(--mono)', fontSize: '0.55rem', color: 'rgba(13,31,36,.35)', marginTop: 5, lineHeight: 1.6 }}>
                    {role === 'minor'
                      ? 'Guardian access ends automatically on their 18th birthday.'
                      : 'They see only their own record until they grant you access.'}
                  </p>
                </div>
                <div>
                  <label style={labelStyle}>Date of birth (optional)</label>
                  <input style={inputStyle} type="date" value={dob} onChange={e => setDob(e.target.value)} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                  <input type="checkbox" checked={delegate} onChange={e => setDelegate(e.target.checked)} />
                  <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                    Can pay for other members
                  </span>
                </label>

                {error && (
                  <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', color: 'var(--rose)', lineHeight: 1.6 }}>
                    {error}
                  </p>
                )}

                <button
                  onClick={handleInvite}
                  disabled={busy}
                  style={{
                    background: '#37b59b', color: '#0c2429', border: 'none', borderRadius: 12,
                    padding: '12px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    opacity: busy ? 0.6 : 1, marginTop: 4,
                  }}
                >
                  {busy ? 'Creating…' : 'Create invitation'}
                </button>
              </div>
            )}

            {/* invite code result */}
            {mode === 'invite' && issuedCode && (
              <div style={{
                background: '#fff', border: '1px solid rgba(55,181,155,.45)', borderRadius: 14,
                padding: 18, textAlign: 'center',
              }}>
                <p style={{ fontFamily: 'var(--mono)', fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--jade-deep)', marginBottom: 10 }}>
                  Invitation code
                </p>
                <p style={{ fontFamily: 'var(--mono)', fontSize: '2rem', fontWeight: 700, letterSpacing: '0.18em', color: 'var(--ink)', marginBottom: 12 }}>
                  {issuedCode}
                </p>
                <p style={{ fontSize: 12.5, color: 'rgba(13,31,36,.55)', lineHeight: 1.6, marginBottom: 16 }}>
                  Send this to {name}. It is shown only once and expires in 7 days.
                </p>
                <button
                  onClick={() => { setIssuedCode(null); setName(''); setPhone('+91'); }}
                  style={{
                    background: 'transparent', border: '1px solid var(--line-2)', borderRadius: 11,
                    padding: '9px 16px', fontSize: 13, cursor: 'pointer', marginRight: 8,
                  }}
                >
                  Invite another
                </button>
                <button
                  onClick={() => router.push('/family')}
                  style={{
                    background: '#37b59b', color: '#0c2429', border: 'none', borderRadius: 11,
                    padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </div>
            )}

            {/* ── JOIN ───────────────────────────────────────────────────── */}
            {mode === 'join' && !joined && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <label style={labelStyle}>Your phone</label>
                  <input style={inputStyle} value={joinPhone} onChange={e => setJoinPhone(e.target.value)} inputMode="tel" />
                </div>
                <div>
                  <label style={labelStyle}>Invitation code</label>
                  <input
                    style={{ ...inputStyle, fontFamily: 'var(--mono)', letterSpacing: '0.2em', fontSize: 16 }}
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                  />
                </div>

                {error && (
                  <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', color: 'var(--rose)', lineHeight: 1.6 }}>
                    {error}
                  </p>
                )}

                <button
                  onClick={handleJoin}
                  disabled={busy || joinCode.length < 4}
                  style={{
                    background: joinCode.length >= 4 ? '#37b59b' : 'rgba(13,31,36,.08)',
                    color: joinCode.length >= 4 ? '#0c2429' : 'rgba(13,31,36,.35)',
                    border: 'none', borderRadius: 12, padding: '12px 0',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy ? 'Joining…' : 'Join family'}
                </button>
              </div>
            )}

            {mode === 'join' && joined && (
              <div style={{
                background: '#fff', border: '1px solid rgba(55,181,155,.45)',
                borderRadius: 14, padding: 18, textAlign: 'center',
              }}>
                <p style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 300, marginBottom: 8 }}>
                  You&apos;re in.
                </p>
                <p style={{ fontSize: 12.5, color: 'rgba(13,31,36,.55)', lineHeight: 1.7, marginBottom: 16 }}>
                  {joined}
                </p>
                <button
                  onClick={() => router.push('/family')}
                  style={{
                    background: '#37b59b', color: '#0c2429', border: 'none', borderRadius: 11,
                    padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Go to Family
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <TabBar />
    </PhoneShell>
  );
}
