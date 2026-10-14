'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Bell, ChevronLeft, Plus, Settings } from 'lucide-react';
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
      padding: '30px 16px 12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      flexShrink: 0,
    }}>
      {/* Left: back + avatar + name + add "+" */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {showBack && (
          <button onClick={onBack} aria-label="Back" style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#2f3b40',
            padding: 0,
            width: 32,
            height: 40,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}>
            <ChevronLeft size={24} strokeWidth={2} />
          </button>
        )}
        <button onClick={onAvatarTap} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          minWidth: 0,
        }}>
          <div style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: person.grad,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            flexShrink: 0,
          }}>
            {person.initial}
          </div>
          <div style={{ textAlign: 'left', minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#0d1f24', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {person.name}
            </div>
            <div style={{
              fontSize: 12,
              color: '#4a5a5f',
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
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
            padding: 0,
            width: 32,
            height: 40,
            display: 'grid',
            placeItems: 'center',
            color: '#1f7d6b',
            flexShrink: 0,
          }}
          title="Add family member"
          aria-label="Add family member"
        >
          <Plus size={20} strokeWidth={2} />
        </button>
      </div>

      {/* Right: Family group chat + settings + bell */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {/* Family group chat — always shown; without a plan it opens /family */}
        <FamilyHubButton size={40} />

        {/* Settings */}
        <button
          onClick={() => router.push('/history/settings')}
          aria-label="Settings"
          title="Settings"
          style={TOP_BTN}
        >
          <Settings size={20} strokeWidth={2} color="#2f3b40" />
        </button>

        {/* Bell with badge */}
        <button onClick={onBell} aria-label="Notifications" title="Notifications" style={{ ...TOP_BTN, position: 'relative' }}>
          <Bell size={20} strokeWidth={2} color="#2f3b40" />
          {bellCount > 0 ? (
            <span style={{
              position: 'absolute',
              top: -5,
              right: -5,
              minWidth: 18,
              height: 18,
              padding: '0 4px',
              boxSizing: 'border-box',
              borderRadius: 9,
              background: '#c2675e',
              color: '#fff',
              fontFamily: "'Space Grotesk', ui-sans-serif, sans-serif",
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1,
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

const TOP_BTN: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  border: '1px solid rgba(13,31,36,.14)',
  background: '#fff',
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  flexShrink: 0,
};
