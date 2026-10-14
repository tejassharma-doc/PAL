'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, History, FileText, Upload, CalendarDays, type LucideIcon } from 'lucide-react';

const tabs: { href: string; label: string; Icon: LucideIcon; matches?: string[] }[] = [
  { href: '/search',  label: 'Ask',     Icon: MessageCircle, matches: ['/search', '/'] },
  { href: '/history', label: 'History', Icon: History, matches: ['/history'] },
  { href: '/records', label: 'Records', Icon: FileText },
  { href: '/upload',  label: 'Upload',  Icon: Upload },
  { href: '/visits',  label: 'Visits',  Icon: CalendarDays },
];

export default function TabBar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 76,
      background: '#fbf9f4',
      borderTop: '1px solid rgba(13,31,36,.14)',
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'space-around',
      padding: '6px 4px 8px',
      zIndex: 15,
    }}>
      {tabs.map(tab => {
        const active = tab.matches
          ? tab.matches.some(m => pathname === m || (m !== '/' && pathname.startsWith(m)))
          : pathname === tab.href || pathname.startsWith(tab.href);
        const { Icon } = tab;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              textDecoration: 'none',
              color: active ? '#1f7d6b' : '#2f3b40',
              minWidth: 48,
              minHeight: 48,
            }}
          >
            <span style={{
              display: 'grid',
              placeItems: 'center',
              padding: '4px 14px',
              borderRadius: 14,
              background: active ? 'rgba(31,125,107,.12)' : 'transparent',
              lineHeight: 0,
            }}>
              <Icon size={24} strokeWidth={2} aria-hidden="true" />
            </span>
            <span style={{
              fontFamily: "'Space Grotesk', ui-sans-serif, sans-serif",
              fontSize: 12,
              fontWeight: active ? 700 : 600,
              lineHeight: 1.2,
            }}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
