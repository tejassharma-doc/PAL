'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

interface Thread {
  id: string;
  title: string;
  scope: 'personal' | 'general';
  agents: string;
  when: string;
  group: string;
}

const threads: Thread[] = [
  { id: '1', title: 'Is it safe to take ibuprofen with my statin?', scope: 'general', agents: 'medication + evidence', when: '2m ago', group: 'Today' },
  { id: '2', title: 'My LDL was 162 — how worried should I be?', scope: 'personal', agents: 'records + evidence', when: '1h ago', group: 'Today' },
  { id: '3', title: 'Does stress raise blood pressure?', scope: 'general', agents: 'evidence', when: 'Yesterday', group: 'Yesterday' },
  { id: '4', title: 'What does eGFR of 88 mean for me?', scope: 'personal', agents: 'records + evidence', when: 'Yesterday', group: 'Yesterday' },
];

export default function HistoryPage() {
  const router = useRouter();
  const [showSheet, setShowSheet] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const groups = ['Today', 'Yesterday'];

  return (
    <PhoneShell>
      <AppBar
        person={ANIL}
        badgeCount={3}
        onAvatarTap={() => setShowSheet(true)}
      />

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 92px' }}>
        <div style={{
          fontFamily: "'Newsreader', serif",
          fontWeight: 300,
          fontSize: '1.5rem',
          margin: '12px 0 3px',
          color: '#0d1f24',
        }}>
          Your conversations
        </div>
        <div style={{ fontSize: '0.8rem', opacity: .6, marginBottom: 13, color: '#0d1f24' }}>
          Saved so you can continue. Yours to delete.
        </div>

        <div style={{
          background: '#fff',
          border: '1px solid rgba(13,31,36,.14)',
          borderRadius: 12,
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          marginBottom: 16,
        }}>
          <span style={{ color: '#1f7d6b', fontSize: '0.9rem', opacity: .7 }}>⌕</span>
          <input
            placeholder="Search conversations…"
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: '0.85rem',
              border: 'none',
              outline: 'none',
              background: 'none',
              width: '100%',
              color: '#0d1f24',
            }}
          />
        </div>

        {groups.map(group => (
          <div key={group}>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.58rem',
              textTransform: 'uppercase',
              opacity: .45,
              margin: '14px 2px 9px',
              color: '#0d1f24',
            }}>
              {group}
            </div>
            {threads.filter(t => t.group === group).map(t => (
              <div
                key={t.id}
                onClick={() => router.push(`/history/${t.id}`)}
                style={{
                  background: '#fff',
                  border: '1px solid rgba(13,31,36,.10)',
                  borderRadius: 13,
                  padding: 13,
                  marginBottom: 9,
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  background: t.scope === 'personal' ? '#37b59b' : '#dfe6e3',
                }} />
                <div style={{ paddingLeft: 8, paddingRight: 22 }}>
                  <div style={{
                    fontFamily: "'Newsreader', serif",
                    fontSize: '0.94rem',
                    lineHeight: 1.35,
                    color: '#0d1f24',
                    marginBottom: 7,
                  }}>
                    {t.title}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <span style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '0.55rem',
                      padding: '3px 8px',
                      borderRadius: 10,
                      display: 'inline-flex',
                      gap: 5,
                      alignItems: 'center',
                      background: t.scope === 'personal' ? 'rgba(55,181,155,.10)' : 'rgba(13,31,36,.06)',
                      color: t.scope === 'personal' ? '#1f7d6b' : 'rgba(13,31,36,.5)',
                    }}>
                      <span style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: t.scope === 'personal' ? '#37b59b' : '#dfe6e3',
                        display: 'inline-block',
                      }} />
                      {t.scope === 'personal' ? 'used your record' : 'general'}
                    </span>
                    <span style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '0.55rem',
                      opacity: .45,
                      color: '#0d1f24',
                    }}>
                      {t.agents}
                    </span>
                    <span style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '0.55rem',
                      opacity: .4,
                      marginLeft: 'auto',
                      color: '#0d1f24',
                    }}>
                      {t.when}
                    </span>
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setDeleteTarget(t.id); }}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    background: 'none',
                    border: 'none',
                    fontSize: '0.95rem',
                    opacity: .28,
                    cursor: 'pointer',
                    color: '#0d1f24',
                  }}
                >
                  ⋯
                </button>
              </div>
            ))}
          </div>
        ))}

        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '0.54rem',
          opacity: .36,
          textAlign: 'center',
          color: '#0d1f24',
          marginTop: 8,
        }}>
          swipe a card left to delete · tap ⋯ for options
        </div>
      </div>

      <TabBar />

      {deleteTarget && (
        <div
          onClick={() => setDeleteTarget(null)}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(13,31,36,.45)',
            zIndex: 40,
            borderRadius: 29,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              background: '#fbf9f4',
              borderRadius: '20px 20px 0 0',
              padding: '20px 18px 28px',
            }}
          >
            <div style={{
              width: 36,
              height: 4,
              borderRadius: 3,
              background: 'rgba(13,31,36,.16)',
              margin: '0 auto 16px',
            }} />
            <div style={{
              fontFamily: "'Newsreader', serif",
              fontSize: '1.1rem',
              fontWeight: 400,
              marginBottom: 12,
              color: '#0d1f24',
            }}>
              Delete this conversation?
            </div>
            {['All messages in this thread', 'Embeddings and semantic index', 'Hindsight summary entries'].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, marginBottom: 8, alignItems: 'center' }}>
                <span style={{ color: '#c2675e', fontSize: '0.8rem' }}>✗</span>
                <span style={{ fontSize: '0.82rem', color: '#0d1f24', opacity: .7 }}>{item}</span>
              </div>
            ))}
            <div style={{
              fontSize: '0.74rem',
              opacity: .55,
              marginTop: 10,
              marginBottom: 16,
              padding: '10px 12px',
              borderLeft: '2px solid rgba(216,162,74,.5)',
              background: 'rgba(216,162,74,.06)',
              borderRadius: '0 9px 9px 0',
              color: '#8a6020',
              lineHeight: 1.5,
            }}>
              Raw uploaded documents are flagged, not deleted (provenance).
            </div>
            <button
              onClick={() => setDeleteTarget(null)}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 11,
                background: '#c2675e',
                border: 'none',
                color: '#fff',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                marginBottom: 8,
              }}
            >
              Delete permanently
            </button>
            <button
              onClick={() => setDeleteTarget(null)}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 11,
                background: 'transparent',
                border: '1px solid rgba(13,31,36,.16)',
                color: '#0d1f24',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      {showSheet && (
        <PersonSheet onClose={() => setShowSheet(false)} />
      )}
    </PhoneShell>
  );
}
