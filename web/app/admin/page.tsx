'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

const c = {
  ink: '#0d1f24', deep: '#13343b', jade: '#37b59b', jadeD: '#1f7d6b',
  amber: '#d8a24a', amberD: '#8a6020', rose: '#c2675e', blue: '#5a8fa8',
  paper: '#f6f3ec', soft: '#fbf9f4', mist: '#dfe6e3',
};
const mono = "'Space Mono', monospace";
const serif = "'Newsreader', serif";

const EVENT_COLORS: Record<string, string> = {
  consent_granted:       c.jade,
  consent_revoked:       c.rose,
  phi_record_read:       c.blue,
  phi_egress_decision:   c.amber,
  phi_access_denied:     c.rose,
};

function eventColor(type: string) {
  return EVENT_COLORS[type] || c.mist;
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '22px 24px',
      border: '1px solid rgba(13,31,36,.10)', flex: 1, minWidth: 160,
    }}>
      <div style={{ fontFamily: mono, fontSize: '.56rem', letterSpacing: '.14em', textTransform: 'uppercase', opacity: .5, marginBottom: 10 }}>{label}</div>
      <div style={{ fontFamily: serif, fontSize: '2rem', fontWeight: 400, color: accent, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: mono, fontSize: '.58rem', opacity: .45, marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

export default function AdminOverview() {
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('pal_token') : null;
    fetch(`${API}/admin/${DEFAULT_TENANT}/stats`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'API error')))
      .then(setStats)
      .catch(e => setError(String(e)));
  }, []);

  const totalTokens = stats
    ? (stats.tokens_30d.input + stats.tokens_30d.output).toLocaleString()
    : '—';

  return (
    <div style={{ padding: '36px 40px', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: serif, fontWeight: 300, fontSize: '1.9rem', letterSpacing: '-.02em', marginBottom: 4 }}>
          Overview
        </h1>
        <p style={{ fontSize: '.85rem', opacity: .55 }}>Operator dashboard — no patient data shown here.</p>
      </div>

      {error && (
        <div style={{
          background: 'rgba(194,103,94,.08)', border: '1px solid rgba(194,103,94,.4)',
          borderRadius: 12, padding: '13px 16px', marginBottom: 24, fontSize: '.82rem', color: c.rose,
        }}>
          ⚠ Could not load stats: {error}. Check that the API is running and <code>ADMIN_DASHBOARD=true</code> is set.
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        <StatCard label="Total users"         value={stats?.users ?? '—'}              accent={c.ink}   sub="active memberships in this tenant" />
        <StatCard label="Active consents"     value={stats?.active_consents ?? '—'}    accent={c.jade}  sub="live, non-revoked grants" />
        <StatCard label="Tokens · 30 days"    value={totalTokens}                       accent={c.blue}  sub={`${stats?.tokens_30d.requests ?? 0} AI requests`} />
        <StatCard label="Audit events · 7 d"  value={stats?.audit_events_7d ?? '—'}    accent={c.amber} sub="PHI access + consent events" />
      </div>

      {/* Recent events */}
      <div style={{ background: '#fff', border: '1px solid rgba(13,31,36,.10)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid rgba(13,31,36,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600, fontSize: '.9rem' }}>Recent audit events</div>
          <a href="/admin/audit" style={{ fontFamily: mono, fontSize: '.6rem', color: c.jadeD, textDecoration: 'none' }}>view all →</a>
        </div>

        {!stats && !error && (
          <div style={{ padding: '32px 22px', textAlign: 'center', fontFamily: mono, fontSize: '.62rem', opacity: .4 }}>Loading…</div>
        )}

        {stats?.recent_events?.length === 0 && (
          <div style={{ padding: '32px 22px', textAlign: 'center', fontFamily: mono, fontSize: '.62rem', opacity: .4 }}>No events yet — audit log is empty.</div>
        )}

        {(stats?.recent_events || []).map((ev: any, i: number) => (
          <div key={ev.id} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 22px',
            borderBottom: i < stats.recent_events.length - 1 ? '1px solid rgba(13,31,36,.07)' : 'none',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: eventColor(ev.event_type),
              display: 'inline-block',
            }} />
            <span style={{ fontFamily: mono, fontSize: '.62rem', color: c.jadeD, flexShrink: 0, minWidth: 180 }}>{ev.event_type}</span>
            <span style={{ fontFamily: mono, fontSize: '.56rem', opacity: .45, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              actor: {ev.actor_user_id ? ev.actor_user_id.slice(0, 8) + '…' : 'system'}
            </span>
            <span style={{ fontFamily: mono, fontSize: '.54rem', opacity: .38, flexShrink: 0 }}>
              {new Date(ev.occurred_at).toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* Feature flag reminder */}
      <div style={{
        marginTop: 28, background: 'rgba(55,181,155,.06)', border: '1px solid rgba(55,181,155,.25)',
        borderRadius: 12, padding: '13px 18px', display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <span style={{ color: c.jadeD, fontSize: '1rem', flexShrink: 0 }}>⛁</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: '.84rem', marginBottom: 2 }}>Operator console · institutional mode</div>
          <div style={{ fontSize: '.76rem', opacity: .7, lineHeight: 1.5 }}>
            This console is for deployment operators. No patient record content is ever shown here.
            PHI access requires a separate patient-side consent flow. Audit logs record metadata only.
          </div>
        </div>
      </div>
    </div>
  );
}
