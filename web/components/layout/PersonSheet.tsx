'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

interface Person {
  key: string;
  name: string;
  initial: string;
  grad: string;
  role: string;
  note: string;
  active?: boolean;
}

const people: Person[] = [
  { key: 'anil', name: 'Anil', initial: 'A', grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)', role: '(you)', note: 'your own record', active: true },
  { key: 'priya', name: 'Priya', initial: 'P', grad: 'linear-gradient(150deg,#5a8fa8,#33607a)', role: '', note: 'spouse · she granted you' },
  { key: 'meera', name: 'Meera', initial: 'M', grad: 'linear-gradient(150deg,#d8a24a,#b07d2c)', role: '', note: "child · you're guardian" },
  { key: 'ramesh', name: 'Ramesh', initial: 'R', grad: 'linear-gradient(150deg,#9c7bb0,#6a4a86)', role: '', note: 'parent · limited scope' },
];

interface PersonSheetProps {
  onClose: () => void;
  onSelect?: (key: string) => void;
}

export default function PersonSheet({ onClose, onSelect }: PersonSheetProps) {
  const router = useRouter();
  return (
    <div
      onClick={onClose}
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
          fontWeight: 300,
          fontSize: '1.25rem',
          marginBottom: 3,
          color: '#0d1f24',
        }}>
          Whose health today?
        </div>
        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 12,
          marginBottom: 14,
          color: '#4a5a5f',
        }}>
          Each person, their own consent.
        </div>

        {people.map(p => (
          <button
            key={p.key}
            onClick={() => { onSelect?.(p.key); onClose(); }}
            style={{
              width: '100%',
              background: '#fff',
              border: '1px solid rgba(13,31,36,.14)',
              borderRadius: 12,
              padding: '11px 12px',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              background: p.grad,
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 16,
              flexShrink: 0,
            }}>
              {p.initial}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#0d1f24' }}>
                {p.name} <span style={{ fontWeight: 400, color: '#4a5a5f' }}>{p.role}</span>
              </div>
              <div style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 12,
                marginTop: 2,
                color: '#4a5a5f',
              }}>
                {p.note}
              </div>
            </div>
            {p.active ? (
              <span style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 12,
                color: '#1f7d6b',
                background: 'rgba(55,181,155,.12)',
                padding: '3px 8px',
                borderRadius: 9,
              }}>
                you
              </span>
            ) : (
              <span style={{ fontSize: '1rem',  color: '#4a5a5f' }}>›</span>
            )}
          </button>
        ))}

        {/* Add member button */}
        <button
          onClick={() => { onClose(); router.push('/family'); }}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1.5px dashed rgba(13,31,36,.18)',
            borderRadius: 12,
            padding: '10px 12px',
            marginBottom: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
          }}
        >
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            border: '1.5px dashed rgba(13,31,36,.18)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 3v8M3 7h8" stroke="rgba(13,31,36,0.35)" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 15,
            color: '#4a5a5f',
            fontWeight: 500,
          }}>
            Add family member
          </span>
        </button>

        {/* Medication reminders link */}
        <button
          onClick={() => { onClose(); router.push('/medications'); }}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1.5px solid rgba(13,31,36,.14)',
            borderRadius: 12,
            padding: '10px 12px',
            marginBottom: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
          }}
        >
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            background: 'rgba(55,181,155,.12)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            fontSize: '1rem',
          }}>
            💊
          </div>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 15,
            color: '#0d1f24',
            fontWeight: 500,
          }}>
            Medication reminders
          </span>
        </button>

        {/* Settings link with notification dot */}
        <button
          onClick={() => { onClose(); router.push('/history/settings'); }}
          style={{
            width: '100%', background: 'none', border: 'none', borderTop: '1px solid rgba(13,31,36,.14)',
            padding: '12px 0 0', marginTop: 4, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <span style={{ fontSize: 16, color: '#4a5a5f' }}>⚙</span>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12,  color: '#4a5a5f' }}>
            Settings
          </span>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#d8a24a',
            display: 'inline-block',
            marginLeft: 2,
            flexShrink: 0,
          }} />
        </button>
      </div>
    </div>
  );
}
