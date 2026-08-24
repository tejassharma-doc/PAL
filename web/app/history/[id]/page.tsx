'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import PhoneShell from '@/components/layout/PhoneShell';
import AppBar from '@/components/layout/AppBar';
import TabBar from '@/components/layout/TabBar';

const ANIL = {
  initial: 'A',
  grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
  name: 'Anil',
  sub: 'your record · active',
};

export default function ThreadPage() {
  const router = useRouter();
  const [input, setInput] = useState('');

  return (
    <PhoneShell>
      <AppBar
        person={ANIL}
        showBack
        onBack={() => router.back()}
        badgeCount={3}
      />

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 92px' }}>
        <span style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '0.55rem',
          padding: '4px 9px',
          borderRadius: 9,
          display: 'inline-flex',
          gap: 5,
          alignItems: 'center',
          background: 'rgba(55,181,155,.10)',
          color: '#1f7d6b',
          margin: '6px 0 12px',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#37b59b', display: 'inline-block' }} />
          personal
        </span>

        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '0.52rem',
          opacity: .38,
          textAlign: 'center',
          margin: '8px 0 10px',
          color: '#0d1f24',
        }}>
          — today —
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 9 }}>
          <div style={{
            background: '#13343b',
            color: '#f6f3ec',
            borderRadius: '14px 14px 4px 14px',
            padding: '10px 13px',
            fontFamily: "'Newsreader', serif",
            fontSize: '0.88rem',
            maxWidth: '80%',
          }}>
            My LDL was 162 — how worried should I be?
          </div>
        </div>

        <div style={{
          background: '#fff',
          border: '1px solid rgba(13,31,36,.10)',
          borderRadius: '14px 14px 14px 4px',
          padding: '11px 13px',
          fontSize: '0.86rem',
          lineHeight: 1.55,
          maxWidth: '88%',
          marginBottom: 9,
          color: '#0d1f24',
          fontFamily: "'Newsreader', serif",
        }}>
          Your LDL of 162 mg/dL is above the ACC/AHA target of &lt;100 for your risk profile. With atorvastatin already in your plan, Dr. Rao may consider a dose adjustment at your upcoming visit.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 9 }}>
          <div style={{
            background: '#13343b',
            color: '#f6f3ec',
            borderRadius: '14px 14px 4px 14px',
            padding: '10px 13px',
            fontFamily: "'Newsreader', serif",
            fontSize: '0.88rem',
            maxWidth: '80%',
          }}>
            What diet changes would help most?
          </div>
        </div>

        <div style={{
          background: '#fff',
          border: '1px solid rgba(13,31,36,.10)',
          borderRadius: '14px 14px 14px 4px',
          padding: '11px 13px',
          fontSize: '0.86rem',
          lineHeight: 1.55,
          maxWidth: '88%',
          marginBottom: 9,
          color: '#0d1f24',
          fontFamily: "'Newsreader', serif",
        }}>
          Sneha's plan already covers this well. The key changes: reduce saturated fats to &lt;7% of calories, increase soluble fibre from oats and lentils, and add more omega-3s through salmon 2–3× per week.
        </div>

        <div style={{
          background: '#fff',
          border: '1px dashed rgba(13,31,36,.16)',
          borderRadius: 14,
          padding: '11px 13px',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          marginTop: 8,
        }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Continue this conversation…"
            style={{
              fontFamily: "'Newsreader', serif",
              fontSize: '0.86rem',
              border: 'none',
              outline: 'none',
              background: 'none',
              flex: 1,
              color: '#0d1f24',
            }}
          />
          <span style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: '#37b59b',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontSize: '0.78rem',
            flexShrink: 0,
            cursor: 'pointer',
          }}>
            🎙
          </span>
        </div>

        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '0.54rem',
          opacity: .38,
          textAlign: 'center',
          marginTop: 9,
          color: '#0d1f24',
          lineHeight: 1.5,
        }}>
          PAL remembers this thread&apos;s context — no need to re-explain.
        </div>
      </div>

      <TabBar />
    </PhoneShell>
  );
}
