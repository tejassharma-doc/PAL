'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/search',  label: 'Ask',     icon: '⌕', matches: ['/search', '/'] },
  { href: '/records', label: 'Record',  icon: '⛁' },
  { href: '/upload',  label: 'Upload',  icon: '⇪' },
  { href: '/history', label: 'History', icon: '◴', matches: ['/history'] },
  { href: '/visits',  label: 'Visits',  icon: '◷' },
];

export default function TabBar() {
  const pathname = usePathname();

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 72,
      background: 'rgba(251,249,244,.92)',
      backdropFilter: 'blur(12px)',
      borderTop: '1px solid rgba(13,31,36,.08)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-around',
      paddingBottom: 8,
      zIndex: 15,
    }}>
      {tabs.map(tab => {
        const extra = tab as { matches?: string[] };
        const active = extra.matches
          ? extra.matches.some(m => pathname === m || (m !== '/' && pathname.startsWith(m)))
          : pathname === tab.href || pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
            textDecoration: 'none',
            color: active ? 'var(--jade-deep)' : 'var(--ink)',
            opacity: active ? 1 : 0.35,
            minWidth: 48,
          }}>
            <span style={{ fontSize: '1.15rem', lineHeight: 1 }}>{tab.icon}</span>
            <span style={{
              fontFamily: 'var(--mono)',
              fontSize: '0.56rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
