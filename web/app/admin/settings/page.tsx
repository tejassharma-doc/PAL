'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

const c = {
  ink: '#0d1f24', deep: '#13343b', jade: '#37b59b', jadeD: '#1f7d6b',
  rose: '#c2675e', amber: '#d8a24a', paper: '#f6f3ec',
};
const mono = "'Space Mono', monospace";
const serif = "'Newsreader', serif";

const PRIVACY_MODES = [
  { value: 'strict',          label: 'Strict',          desc: 'PHI stays on host. Never sent to AI provider.' },
  { value: 'session_consent', label: 'Session consent', desc: 'PHI sent only when patient consents per session.' },
  { value: 'standing_consent',label: 'Standing consent',desc: 'PHI sent under opt-in standing consent.' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontFamily: mono, fontSize: '.58rem', letterSpacing: '.14em', textTransform: 'uppercase', opacity: .4, marginBottom: 14 }}>{title}</div>
      <div style={{ background: '#fff', border: '1px solid rgba(13,31,36,.10)', borderRadius: 14, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid rgba(13,31,36,.07)' }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: '.88rem' }}>{label}</div>
        {desc && <div style={{ fontFamily: mono, fontSize: '.56rem', opacity: .5, marginTop: 3 }}>{desc}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const [cfg, setCfg]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  // Editable fields
  const [privacyMode, setPrivacyMode]           = useState('strict');
  const [dailyBudget, setDailyBudget]           = useState('');
  const [perUserBudget, setPerUserBudget]        = useState('');
  const [ageMajority, setAgeMajority]           = useState('6570');
  const [baaSigned, setBaaSigned]               = useState(false);
  const [baaCounterparty, setBaaCounterparty]   = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('pal_token') : null;
  const authHeader = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  useEffect(() => {
    fetch(`${API}/admin/${DEFAULT_TENANT}/settings`, { headers: authHeader })
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e.detail || 'API error')))
      .then(d => {
        setCfg(d);
        setPrivacyMode(d.privacy_mode);
        setDailyBudget(d.daily_token_budget != null ? String(d.daily_token_budget) : '');
        setPerUserBudget(d.per_user_daily_token_budget != null ? String(d.per_user_daily_token_budget) : '');
        setAgeMajority(String(d.age_of_majority_days));
        setBaaSigned(d.baa_signed);
        setBaaCounterparty(d.baa_counterparty || '');
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    const body: any = {
      privacy_mode: privacyMode,
      age_of_majority_days: parseInt(ageMajority) || 6570,
      baa_signed: baaSigned,
      baa_counterparty: baaCounterparty || null,
    };
    if (dailyBudget)    body.daily_token_budget = parseInt(dailyBudget);
    if (perUserBudget)  body.per_user_daily_token_budget = parseInt(perUserBudget);

    try {
      const r = await fetch(`${API}/admin/${DEFAULT_TENANT}/settings`, {
        method: 'PATCH', headers: authHeader, body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Save failed'); }
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: "'Space Grotesk', sans-serif", fontSize: '.84rem',
    padding: '8px 12px', borderRadius: 9, width: 200,
    border: '1px solid rgba(13,31,36,.16)', background: c.paper, outline: 'none',
  };

  return (
    <div style={{ padding: '36px 40px', maxWidth: 840 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: serif, fontWeight: 300, fontSize: '1.9rem', letterSpacing: '-.02em', marginBottom: 4 }}>Settings</h1>
        <p style={{ fontSize: '.85rem', opacity: .55 }}>Tenant configuration. Feature flags are set at deploy time via env vars.</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(194,103,94,.08)', border: '1px solid rgba(194,103,94,.4)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: '.82rem', color: c.rose }}>
          ⚠ {error}
        </div>
      )}

      {loading && <div style={{ fontFamily: mono, fontSize: '.62rem', opacity: .4 }}>Loading…</div>}

      {cfg && (
        <form onSubmit={save}>
          {/* Read-only: deployment */}
          <Section title="Deployment">
            <Row label="Deployment mode" desc="Set via DEPLOYMENT_MODE env var — not editable here.">
              <span style={{ fontFamily: mono, fontSize: '.62rem', background: 'rgba(13,31,36,.06)', padding: '5px 10px', borderRadius: 8 }}>
                {cfg.deployment_mode}
              </span>
            </Row>
            <Row label="Tenant" desc="Slug and ID are immutable.">
              <span style={{ fontFamily: mono, fontSize: '.6rem', opacity: .5 }}>{cfg.slug} · {cfg.id.slice(0, 8)}…</span>
            </Row>
          </Section>

          {/* Privacy */}
          <Section title="Privacy mode">
            {PRIVACY_MODES.map(pm => (
              <div
                key={pm.value}
                onClick={() => setPrivacyMode(pm.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 22px', cursor: 'pointer',
                  borderBottom: '1px solid rgba(13,31,36,.07)',
                  background: privacyMode === pm.value ? 'rgba(55,181,155,.05)' : 'transparent',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${privacyMode === pm.value ? c.jade : 'rgba(13,31,36,.2)'}`,
                  display: 'grid', placeItems: 'center',
                }}>
                  {privacyMode === pm.value && (
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.jade, display: 'block' }} />
                  )}
                </span>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '.88rem' }}>{pm.label}</div>
                  <div style={{ fontFamily: mono, fontSize: '.56rem', opacity: .5, marginTop: 2 }}>{pm.desc}</div>
                </div>
              </div>
            ))}
          </Section>

          {/* Token budgets */}
          <Section title="Token budgets">
            <Row label="Daily token budget" desc="Across all users. Leave blank for unlimited.">
              <input type="number" min="0" value={dailyBudget}
                onChange={e => setDailyBudget(e.target.value)}
                placeholder="unlimited" style={inputStyle} />
            </Row>
            <div style={{ borderBottom: '1px solid rgba(13,31,36,.07)' }} />
            <Row label="Per-user daily budget" desc="Per patient per day. Leave blank for no per-user cap.">
              <input type="number" min="0" value={perUserBudget}
                onChange={e => setPerUserBudget(e.target.value)}
                placeholder="unlimited" style={inputStyle} />
            </Row>
          </Section>

          {/* BAA */}
          <Section title="Business associate agreement">
            <Row label="BAA signed" desc="Records that a BAA is in place with this tenant.">
              <button
                type="button"
                onClick={() => setBaaSigned(v => !v)}
                style={{
                  fontFamily: mono, fontSize: '.62rem', padding: '7px 14px', borderRadius: 9,
                  border: 'none', cursor: 'pointer',
                  background: baaSigned ? 'rgba(55,181,155,.14)' : 'rgba(13,31,36,.06)',
                  color: baaSigned ? c.jadeD : c.ink,
                }}
              >
                {baaSigned ? '✓ signed' : '· not signed'}
              </button>
            </Row>
            <Row label="Counterparty" desc="Legal entity name on the BAA.">
              <input type="text" value={baaCounterparty}
                onChange={e => setBaaCounterparty(e.target.value)}
                placeholder="e.g. City Clinic Pvt Ltd" style={inputStyle} />
            </Row>
            {cfg.baa_signed_at && (
              <div style={{ padding: '10px 22px', fontFamily: mono, fontSize: '.56rem', opacity: .4 }}>
                Signed at: {new Date(cfg.baa_signed_at).toLocaleString()}
              </div>
            )}
          </Section>

          {/* Age of majority */}
          <Section title="Minor handling">
            <Row label="Age of majority (days)" desc="Default 6570 = 18 years. Used for guardian re-consent triggers.">
              <input type="number" min="1000" max="10000" value={ageMajority}
                onChange={e => setAgeMajority(e.target.value)}
                style={inputStyle} />
            </Row>
          </Section>

          {/* Operator key status (read-only) */}
          <Section title="AI provider key">
            <Row label="Operator key" desc="Configured via OPERATOR_ANTHROPIC_API_KEY env var. Never returned.">
              <span style={{
                fontFamily: mono, fontSize: '.62rem', padding: '5px 10px', borderRadius: 8,
                background: cfg.operator_key_configured ? 'rgba(55,181,155,.12)' : 'rgba(13,31,36,.06)',
                color: cfg.operator_key_configured ? c.jadeD : c.ink,
              }}>
                {cfg.operator_key_configured ? 'configured ✓' : 'not set'}
              </span>
            </Row>
          </Section>

          {/* Save */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="submit" disabled={saving} style={{
              fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: '.84rem',
              padding: '11px 24px', borderRadius: 10, border: 'none',
              background: c.jade, color: '#0c2429', cursor: saving ? 'default' : 'pointer', opacity: saving ? .6 : 1,
            }}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            {saved && <span style={{ fontFamily: mono, fontSize: '.62rem', color: c.jadeD }}>Saved ✓</span>}
          </div>
        </form>
      )}
    </div>
  );
}
