'use client';

import { useState } from 'react';
import PhoneShell from '@/components/layout/PhoneShell';
import AppBar from '@/components/layout/AppBar';
import TabBar from '@/components/layout/TabBar';
import PersonSheet from '@/components/layout/PersonSheet';

const ANIL = {
  initial: 'A',
  grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
  name: 'Anil',
  sub: 'your record · active',
};

export default function NotificationsPage() {
  const [showSheet, setShowSheet] = useState(false);
  const [statinTaken, setStatinTaken] = useState(false);

  const done = 6;
  const total = 7;
  const pct = done / total;
  const r = 20;
  const circ = 2 * Math.PI * r;

  return (
    <PhoneShell>
      <AppBar
        person={ANIL}
        badgeCount={3}
        onAvatarTap={() => setShowSheet(true)}
      />

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 92px' }}>
        <div style={{
          background: 'linear-gradient(160deg,#13343b,#0c2429)',
          borderRadius: 16,
          padding: 16,
          color: '#f6f3ec',
          margin: '8px 0 16px',
        }}>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '0.58rem',
            textTransform: 'uppercase',
            color: '#37b59b',
            marginBottom: 12,
          }}>
            ✶ this week, with you
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
              <svg width="52" height="52" viewBox="0 0 52 52">
                <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="6" />
                <circle
                  cx="26" cy="26" r={r}
                  fill="none"
                  stroke="#37b59b"
                  strokeWidth="6"
                  strokeDasharray={circ}
                  strokeDashoffset={circ * (1 - pct)}
                  strokeLinecap="round"
                  transform="rotate(-90 26 26)"
                />
                <text
                  x="26" y="30"
                  textAnchor="middle"
                  style={{ fontFamily: "'Newsreader', serif", fontSize: 11, fill: '#f6f3ec' }}
                >
                  {done}/{total}
                </text>
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: "'Newsreader', serif", fontSize: '0.98rem', lineHeight: 1.4 }}>
                Six days on track — nicely done.
              </div>
              <div style={{ fontSize: '0.74rem', opacity: .65, marginTop: 3 }}>
                Your statin, most evenings.
              </div>
            </div>
          </div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '0.56rem',
            opacity: .55,
            borderTop: '1px solid rgba(255,255,255,.12)',
            paddingTop: 10,
            lineHeight: 1.6,
          }}>
            Missed a day? That&apos;s okay. Tap any reminder to catch up — no streak to break.
          </div>
        </div>

        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '0.6rem',
          textTransform: 'uppercase',
          opacity: .5,
          margin: '14px 2px 10px',
          color: '#0d1f24',
        }}>
          Today
        </div>

        {/* Statin card */}
        <div style={{
          background: '#fff',
          border: '1px solid rgba(13,31,36,.10)',
          borderRadius: 14,
          padding: 13,
          marginBottom: 10,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'rgba(90,143,168,.14)',
            color: '#33607a',
            display: 'grid',
            placeItems: 'center',
            fontSize: '0.9rem',
            flexShrink: 0,
          }}>
            💊
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.3, color: '#0d1f24' }}>
              Atorvastatin · evening dose
            </div>
            <div style={{ fontSize: '0.76rem', opacity: .72, marginTop: 3, lineHeight: 1.45, color: '#0d1f24' }}>
              Take with dinner — Dr. Rao&apos;s plan
            </div>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.56rem',
              opacity: .45,
              marginTop: 6,
              color: '#0d1f24',
            }}>
              8:00 PM · daily
            </div>
            {!statinTaken ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => setStatinTaken(true)}
                  style={{
                    background: '#37b59b',
                    color: '#0c2429',
                    border: 'none',
                    borderRadius: 8,
                    padding: '7px 13px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Taken ✓
                </button>
                <button style={{
                  background: 'transparent',
                  border: '1px solid rgba(13,31,36,.16)',
                  borderRadius: 8,
                  padding: '7px 13px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: '#0d1f24',
                }}>
                  Later
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 10, color: '#1f7d6b', fontSize: '0.76rem' }}>✓ logged for tonight</div>
            )}
          </div>
        </div>

        {/* Dinner card */}
        <div style={{
          background: '#fff',
          border: '1px solid rgba(13,31,36,.10)',
          borderRadius: 14,
          padding: 13,
          marginBottom: 10,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'rgba(55,181,155,.14)',
            color: '#1f7d6b',
            display: 'grid',
            placeItems: 'center',
            fontSize: '0.9rem',
            flexShrink: 0,
          }}>
            🍽
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.3, color: '#0d1f24' }}>
              Tonight&apos;s dinner · Sneha&apos;s plan
            </div>
            <div style={{ fontSize: '0.76rem', opacity: .72, marginTop: 3, lineHeight: 1.45, color: '#0d1f24' }}>
              Herb-grilled salmon with quinoa — 480 kcal
            </div>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.56rem',
              opacity: .45,
              marginTop: 6,
              color: '#0d1f24',
            }}>
              7:30 PM · tonight
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button style={{
                background: 'rgba(90,143,168,.14)',
                color: '#33607a',
                border: 'none',
                borderRadius: 8,
                padding: '7px 13px',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}>
                View recipe
              </button>
              <button style={{
                background: 'transparent',
                border: '1px solid rgba(13,31,36,.16)',
                borderRadius: 8,
                padding: '7px 13px',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
                color: '#0d1f24',
              }}>
                Swap meal
              </button>
            </div>
          </div>
        </div>

        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '0.6rem',
          textTransform: 'uppercase',
          opacity: .5,
          margin: '14px 2px 10px',
          color: '#0d1f24',
        }}>
          Coming up
        </div>

        {/* Recheck card */}
        <div style={{
          background: '#fff',
          border: '1px solid rgba(13,31,36,.10)',
          borderRadius: 14,
          padding: 13,
          marginBottom: 10,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'rgba(13,31,36,.08)',
            color: 'rgba(13,31,36,.6)',
            display: 'grid',
            placeItems: 'center',
            fontSize: '0.9rem',
            flexShrink: 0,
          }}>
            📅
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.3, color: '#0d1f24' }}>
              LDL recheck due
            </div>
            <div style={{ fontSize: '0.76rem', opacity: .72, marginTop: 3, lineHeight: 1.45, color: '#0d1f24' }}>
              Your target was &lt;100 mg/dL — book a review with Dr. Rao
            </div>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.56rem',
              opacity: .45,
              marginTop: 6,
              color: '#0d1f24',
            }}>
              Thu 26 Jun · City Clinic OPD
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button style={{
                background: '#37b59b',
                color: '#0c2429',
                border: 'none',
                borderRadius: 8,
                padding: '7px 13px',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}>
                Book review
              </button>
              <button style={{
                background: 'transparent',
                border: '1px solid rgba(13,31,36,.16)',
                borderRadius: 8,
                padding: '7px 13px',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
                color: '#0d1f24',
              }}>
                Remind me
              </button>
            </div>
          </div>
        </div>

        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '0.6rem',
          opacity: .5,
          textAlign: 'center',
          marginTop: 14,
          lineHeight: 1.6,
          color: '#0d1f24',
        }}>
          You choose what PAL reminds you about,<br />
          and when. Quiet hours respected.
        </div>
      </div>

      <TabBar />

      {showSheet && (
        <PersonSheet onClose={() => setShowSheet(false)} />
      )}
    </PhoneShell>
  );
}
