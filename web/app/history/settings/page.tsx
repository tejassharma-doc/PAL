'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import TabBar from '@/components/layout/TabBar';

/* ── Line-drawing icons (stroke only, matches app style) ───────────── */
const ICONS = {
  personalise: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="var(--ink)" strokeWidth="1.6" strokeOpacity=".55"/>
      <circle cx="12" cy="12" r="3.5" stroke="var(--ink)" strokeWidth="1.4" strokeOpacity=".55"/>
      <circle cx="12" cy="12" r="1" fill="var(--ink)" fillOpacity=".55"/>
      <line x1="12" y1="2.5" x2="12" y2="4.5" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity=".55"/>
      <line x1="12" y1="19.5" x2="12" y2="21.5" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity=".55"/>
      <line x1="2.5" y1="12" x2="4.5" y2="12" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity=".55"/>
      <line x1="19.5" y1="12" x2="21.5" y2="12" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity=".55"/>
    </svg>
  ),
  analytics: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3"  y="13" width="4" height="8" rx="1" stroke="var(--ink)" strokeWidth="1.5" strokeOpacity=".55"/>
      <rect x="10" y="9"  width="4" height="12" rx="1" stroke="var(--ink)" strokeWidth="1.5" strokeOpacity=".55"/>
      <rect x="17" y="5"  width="4" height="16" rx="1" stroke="var(--ink)" strokeWidth="1.5" strokeOpacity=".55"/>
    </svg>
  ),
  export: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v13" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeOpacity=".55"/>
      <path d="M8 7l4-4 4 4" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeOpacity=".55"/>
      <path d="M5 15v4a1 1 0 001 1h12a1 1 0 001-1v-4" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeOpacity=".55"/>
    </svg>
  ),
  delete: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16" stroke="var(--rose)" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M10 11v5M14 11v5" stroke="var(--rose)" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M5 7l1 11a1 1 0 001 1h10a1 1 0 001-1l1-11" stroke="var(--rose)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" stroke="var(--rose)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  password: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="8.5" cy="13" r="4" stroke="var(--ink)" strokeWidth="1.6" strokeOpacity=".55"/>
      <path d="M12 11.5h7.5" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeOpacity=".55"/>
      <path d="M17.5 11.5v3" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeOpacity=".55"/>
      <path d="M15 11.5v2" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity=".55"/>
    </svg>
  ),
  signout: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M15 8l4 4-4 4" stroke="var(--rose)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 12H9" stroke="var(--rose)" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M12 5H6a1 1 0 00-1 1v12a1 1 0 001 1h6" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeOpacity=".45"/>
    </svg>
  ),
};

/* ── Toggle ────────────────────────────────────────────────────────── */
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 44, height: 26, borderRadius: 13,
      background: on ? 'var(--jade)' : 'var(--mist)',
      border: 'none', cursor: 'pointer', position: 'relative',
      transition: 'background 0.2s', flexShrink: 0,
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 3,
        left: on ? 21 : 3,
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

/* ── Row ───────────────────────────────────────────────────────────── */
function SettingRow({ icon, label, sublabel, right, danger }: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 13,
      padding: '12px 16px',
      borderBottom: '1px solid var(--line)',
    }}>
      <div style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: danger ? 'var(--rose)' : 'var(--ink)', lineHeight: 1.3 }}>
          {label}
        </p>
        {sublabel && (
          <p style={{ fontSize: 11, color: 'rgba(13,31,36,0.45)', marginTop: 2, lineHeight: 1.4 }}>
            {sublabel}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

const ChevronDark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M6 4l4 4-4 4" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.3"/>
  </svg>
);

const ChevronRose = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M6 4l4 4-4 4" stroke="var(--rose)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* ── Page ──────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const router = useRouter();
  const [standing,  setStanding]  = useState(false);
  const [analytics, setAnalytics] = useState(false);

  return (
    <PhoneShell>
      <div style={{ height: 28 }} />

      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4l-6 6 6 6" stroke="var(--ink)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.5"/>
          </svg>
        </button>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>Settings</h2>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 20 }}>

        {/* Privacy & Consent */}
        <div style={{ padding: '8px 16px 4px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(13,31,36,0.4)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            Privacy &amp; Consent
          </p>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, margin: '6px 16px', overflow: 'hidden', border: '1px solid var(--line)' }}>
          <SettingRow
            icon={ICONS.personalise}
            label="Always personalise"
            sublabel="Use my record without asking each session"
            right={<Toggle on={standing} onChange={setStanding} />}
          />
          <SettingRow
            icon={ICONS.analytics}
            label="Usage analytics"
            sublabel="Anonymous — helps improve PAL"
            right={<Toggle on={analytics} onChange={setAnalytics} />}
          />
        </div>

        {/* History */}
        <div style={{ padding: '12px 16px 4px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(13,31,36,0.4)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            History
          </p>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, margin: '6px 16px', overflow: 'hidden', border: '1px solid var(--line)' }}>
          <SettingRow icon={ICONS.export} label="Export my data" sublabel="Download as JSON" right={<ChevronDark />} />
          <SettingRow icon={ICONS.delete} label="Delete all history" sublabel="Removes all threads permanently" danger right={<ChevronRose />} />
        </div>

        {/* Account */}
        <div style={{ padding: '12px 16px 4px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(13,31,36,0.4)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            Account
          </p>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, margin: '6px 16px', overflow: 'hidden', border: '1px solid var(--line)' }}>
          <SettingRow icon={ICONS.password} label="Change password" right={<ChevronDark />} />
          <SettingRow icon={ICONS.signout} label="Sign out" danger />
        </div>

        <p style={{ fontSize: 11, color: 'rgba(13,31,36,0.3)', textAlign: 'center', padding: '20px 16px 0' }}>
          PAL v0.1.0 · Not a medical device
        </p>
      </div>

      <TabBar />
    </PhoneShell>
  );
}
