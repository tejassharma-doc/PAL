'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

const c = {
  ink: '#0d1f24', deep: '#13343b', jade: '#37b59b', jadeD: '#1f7d6b',
  rose: '#c2675e', amber: '#d8a24a', amberD: '#8a6020', blue: '#5a8fa8',
  paper: '#f6f3ec',
};
const mono = "'Space Mono', monospace";
const serif = "'Newsreader', serif";

const OPERATOR_ROLES = [
  'operator_admin', 'operator_developer', 'operator_support',
  'operator_security', 'operator_billing',
];

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  operator_admin:     { bg: 'rgba(194,103,94,.12)',  color: c.rose },
  operator_developer: { bg: 'rgba(55,181,155,.12)',  color: c.jadeD },
  operator_support:   { bg: 'rgba(216,162,74,.12)',  color: c.amberD },
  operator_security:  { bg: 'rgba(90,143,168,.14)',  color: '#33607a' },
  operator_billing:   { bg: 'rgba(13,31,36,.08)',    color: c.ink },
  member:             { bg: 'rgba(55,181,155,.08)',  color: c.jadeD },
  caregiver:          { bg: 'rgba(216,162,74,.08)',  color: c.amberD },
  provider:           { bg: 'rgba(90,143,168,.10)',  color: '#33607a' },
};

function RoleBadge({ role }: { role: string }) {
  const s = ROLE_COLORS[role] || { bg: 'rgba(13,31,36,.06)', color: c.ink };
  return (
    <span style={{
      fontFamily: mono, fontSize: '.56rem', letterSpacing: '.06em',
      padding: '4px 9px', borderRadius: 10, background: s.bg, color: s.color,
    }}>
      {role.replace('operator_', 'op/')}
    </span>
  );
}

export default function UsersPage() {
  const [users, setUsers]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm]       = useState({ email: '', full_name: '', role: 'operator_support', temp_password: '' });
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('pal_token') : null;
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  function load() {
    setLoading(true);
    fetch(`${API}/admin/${DEFAULT_TENANT}/users`, { headers })
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e.detail || 'API error')))
      .then(d => { setUsers(d.users); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }

  useEffect(load, []);

  async function toggleActive(userId: string, current: boolean) {
    await fetch(`${API}/admin/${DEFAULT_TENANT}/users/${userId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ active: !current }),
    });
    load();
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setSaveMsg('');
    try {
      const r = await fetch(`${API}/admin/${DEFAULT_TENANT}/users/invite`, {
        method: 'POST', headers,
        body: JSON.stringify(form),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Error'); }
      setSaveMsg('Invited ✓'); setShowInvite(false);
      setForm({ email: '', full_name: '', role: 'operator_support', temp_password: '' });
      load();
    } catch (err: any) {
      setSaveMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: '36px 40px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: serif, fontWeight: 300, fontSize: '1.9rem', letterSpacing: '-.02em', marginBottom: 4 }}>Users</h1>
          <p style={{ fontSize: '.85rem', opacity: .55 }}>All memberships in this tenant. Emails only — no health data shown.</p>
        </div>
        <button
          onClick={() => setShowInvite(v => !v)}
          style={{
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: '.82rem',
            padding: '10px 18px', borderRadius: 10, border: 'none',
            background: c.jade, color: '#0c2429', cursor: 'pointer',
          }}
        >
          + Invite operator
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <form onSubmit={invite} style={{
          background: '#fff', border: '1px solid rgba(13,31,36,.12)',
          borderRadius: 14, padding: '22px 24px', marginBottom: 24,
        }}>
          <div style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 16 }}>Invite operator user</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            {[
              { label: 'Email', key: 'email', type: 'email', placeholder: 'admin@clinic.org' },
              { label: 'Full name', key: 'full_name', type: 'text', placeholder: 'Dr. Smith' },
              { label: 'Temporary password', key: 'temp_password', type: 'password', placeholder: '········' },
            ].map(f => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: mono, fontSize: '.58rem', opacity: .55 }}>{f.label}</span>
                <input
                  type={f.type} required placeholder={f.placeholder}
                  value={(form as any)[f.key]}
                  onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif", fontSize: '.84rem',
                    padding: '9px 12px', borderRadius: 9,
                    border: '1px solid rgba(13,31,36,.16)', outline: 'none',
                    background: c.paper,
                  }}
                />
              </label>
            ))}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: mono, fontSize: '.58rem', opacity: .55 }}>Role</span>
              <select
                value={form.role}
                onChange={e => setForm(v => ({ ...v, role: e.target.value }))}
                style={{
                  fontFamily: "'Space Grotesk', sans-serif", fontSize: '.84rem',
                  padding: '9px 12px', borderRadius: 9,
                  border: '1px solid rgba(13,31,36,.16)', background: c.paper,
                }}
              >
                {OPERATOR_ROLES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" disabled={saving} style={{
              fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: '.8rem',
              padding: '9px 20px', borderRadius: 9, border: 'none',
              background: c.jade, color: '#0c2429', cursor: saving ? 'default' : 'pointer', opacity: saving ? .6 : 1,
            }}>
              {saving ? 'Inviting…' : 'Send invite'}
            </button>
            <button type="button" onClick={() => setShowInvite(false)} style={{
              fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500, fontSize: '.8rem',
              padding: '9px 16px', borderRadius: 9,
              border: '1px solid rgba(13,31,36,.16)', background: 'transparent', cursor: 'pointer',
            }}>Cancel</button>
            {saveMsg && <span style={{ fontFamily: mono, fontSize: '.62rem', color: saveMsg.startsWith('Error') ? c.rose : c.jadeD }}>{saveMsg}</span>}
          </div>
        </form>
      )}

      {error && (
        <div style={{ background: 'rgba(194,103,94,.08)', border: '1px solid rgba(194,103,94,.4)', borderRadius: 12, padding: '13px 16px', marginBottom: 20, fontSize: '.82rem', color: c.rose }}>
          ⚠ {error}
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid rgba(13,31,36,.10)', borderRadius: 14, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 100px 90px',
          padding: '12px 20px', borderBottom: '1px solid rgba(13,31,36,.10)',
          fontFamily: mono, fontSize: '.56rem', letterSpacing: '.12em', textTransform: 'uppercase', opacity: .45,
        }}>
          <span>User</span><span>Email</span><span>Role</span><span>Joined</span><span>Status</span>
        </div>

        {loading && (
          <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: mono, fontSize: '.62rem', opacity: .4 }}>Loading…</div>
        )}

        {!loading && users.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: mono, fontSize: '.62rem', opacity: .4 }}>No users yet.</div>
        )}

        {users.map((u: any, i: number) => (
          <div key={u.user_id} style={{
            display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 100px 90px',
            padding: '13px 20px', alignItems: 'center',
            borderBottom: i < users.length - 1 ? '1px solid rgba(13,31,36,.07)' : 'none',
            opacity: u.active ? 1 : 0.45,
          }}>
            <span style={{ fontWeight: 500, fontSize: '.88rem' }}>{u.full_name || '—'}</span>
            <span style={{ fontFamily: mono, fontSize: '.62rem', opacity: .7 }}>{u.email}</span>
            <span><RoleBadge role={u.role} /></span>
            <span style={{ fontFamily: mono, fontSize: '.56rem', opacity: .4 }}>
              {new Date(u.created_at).toLocaleDateString()}
            </span>
            <button
              onClick={() => toggleActive(u.user_id, u.active)}
              style={{
                fontFamily: mono, fontSize: '.58rem', padding: '5px 10px', borderRadius: 8,
                border: '1px solid ' + (u.active ? 'rgba(194,103,94,.3)' : 'rgba(55,181,155,.3)'),
                background: u.active ? 'rgba(194,103,94,.06)' : 'rgba(55,181,155,.06)',
                color: u.active ? c.rose : c.jadeD, cursor: 'pointer',
              }}
            >
              {u.active ? 'deactivate' : 'activate'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, fontFamily: mono, fontSize: '.56rem', opacity: .35 }}>
        Only operator-role users can be invited here. Patient records are managed in the patient-facing app.
      </div>
    </div>
  );
}
