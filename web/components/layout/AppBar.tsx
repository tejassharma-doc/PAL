'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import FamilyHubButton from '@/components/family/FamilyHubButton';
import { useNotificationBadge } from '@/lib/useNotificationBadge';

interface Person {
  initial: string;
  grad: string;
  name: string;
  sub: string;
}

interface AppBarProps {
  person: Person;
  showBack?: boolean;
  onBack?: () => void;
  onAvatarTap?: () => void;
  onBell?: () => void;
  badgeCount?: number;
}

export default function AppBar({ person, showBack, onBack, onAvatarTap, onBell, badgeCount }: AppBarProps) {
  // The bell's real unread count. `badgeCount` remains an explicit override so
  // a mock or a screenshot can still force a number, but when it is not given
  // the bell now shows what the backend actually says — it used to be a
  // hard-coded 3 on every screen.
  const liveBadge = useNotificationBadge();
  const bellCount = badgeCount ?? liveBadge;
  const router = useRouter();

  return (
    <div style={{
      padding: '30px 18px 12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      {/* Left: back + avatar + name + add "+" */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {showBack && (
          <button onClick={onBack} style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1.3rem',
            color: '#0d1f24',
            opacity: 0.55,
            padding: '0 4px 0 0',
            lineHeight: 1,
          }}>
            ‹
          </button>
        )}
        <button onClick={onAvatarTap} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 11,
            background: person.grad,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.9rem',
            flexShrink: 0,
          }}>
            {person.initial}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#0d1f24', lineHeight: 1.2 }}>
              {person.name}
            </div>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.6rem',
              color: '#0d1f24',
              opacity: 0.5,
            }}>
              {person.sub}
            </div>
          </div>
        </button>

        {/* + Add family member shortcut */}
        <button
          onClick={() => router.push('/family')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 3px',
            lineHeight: 1,
            color: '#1f7d6b',
            opacity: 0.6,
            fontSize: '1.15rem',
            fontWeight: 300,
            marginLeft: 2,
          }}
          title="Add family member"
        >
          +
        </button>
      </div>

      {/* Right: Family Hub chat + settings gear + bell */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {/* Family Care Hub — renders nothing when the account has no family plan */}
        <FamilyHubButton size={34} />

        {/* Settings gear */}
        <button
          onClick={() => router.push('/history/settings')}
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            border: '1px solid rgba(13,31,36,.10)',
            background: '#fff',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            fontSize: '0.85rem',
            color: 'rgba(13,31,36,0.45)',
          }}
        >
          ⚙
        </button>

        {/* Bell with badge */}
        <button onClick={onBell} style={{
          width: 34,
          height: 34,
          borderRadius: 11,
          border: '1px solid rgba(13,31,36,.10)',
          background: '#fff',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
          flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path
              d="M8.5 17.5h3M10 3C7 3 4.5 5.5 4.5 8.5V13l-1.5 2.5h14L15.5 13V8.5C15.5 5.5 13 3 10 3z"
              stroke="#0d1f24"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {bellCount > 0 ? (
            <span style={{
              position: 'absolute',
              top: -4,
              right: -4,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: '#c2675e',
              color: '#fff',
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.54rem',
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
            }}>
              {bellCount > 9 ? '9+' : bellCount}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
