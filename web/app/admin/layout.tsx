'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getMyPermissions } from '@/lib/api';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

const NAV = [
  { href: '/admin',          icon: '◎', label: 'Overview',  perm: 'audit.read'     },
  { href: '/admin/users',    icon: '◆', label: 'Users',     perm: 'users.manage'   },
  { href: '/admin/audit',    icon: '⛁', label: 'Audit log', perm: 'audit.read'     },
  { href: '/admin/settings', icon: '⚛', label: 'Settings',  perm: 'settings.write' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [perms, setPerms] = useState<Set<string> | null>(null);

  useEffect(() => {
    getMyPermissions()
      .then(p => setPerms(new Set(p)))
      .catch(() => setPerms(new Set()));
  }, []);

  // Show all items while loading (null), filter once resolved
  const visibleNav = perms === null ? NAV : NAV.filter(n => perms.has(n.perm));

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      fontFamily: "'Space Grotesk', sans-serif",
      background: '#f6f3ec',
      color: '#0d1f24',
    }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        background: '#13343b',
        color: '#dfe6e3',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 20,
      }}>
        {/* Logo area */}
        <div style={{ padding: '24px 22px 20px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
              display: 'grid', placeItems: 'center',
              fontFamily: "'Newsreader', serif", fontSize: '1rem', color: '#fff',
            }}>✶</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.92rem', letterSpacing: '-.01em', color: '#f6f3ec' }}>PAL Admin</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.52rem', opacity: .45, marginTop: 1 }}>operator console</div>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, padding: '16px 10px' }}>
          {visibleNav.map(({ href, icon, label }) => {
            const active = href === '/admin' ? path === '/admin' : path.startsWith(href);
            return (
              <Link key={href} href={href} style={{ textDecoration: 'none' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 10, marginBottom: 3,
                  fontWeight: active ? 600 : 400,
                  fontSize: '.86rem',
                  color: active ? '#0c2429' : 'rgba(223,230,227,.72)',
                  background: active ? '#37b59b' : 'transparent',
                  transition: 'all .14s',
                }}>
                  <span style={{ fontSize: '.9rem', opacity: active ? 1 : .6 }}>{icon}</span>
                  {label}
                </div>
              </Link>
            );
          })}
          {perms !== null && visibleNav.length === 0 && (
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.52rem', opacity: .35, padding: '10px 12px' }}>
              No admin access
            </div>
          )}
        </nav>

        {/* Tenant chip */}
        <div style={{ padding: '16px 22px 24px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.54rem', opacity: .4, marginBottom: 6 }}>TENANT</div>
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: '.58rem',
            background: 'rgba(255,255,255,.06)', borderRadius: 8,
            padding: '6px 10px', color: '#37b59b', letterSpacing: '.04em',
          }}>
            {DEFAULT_TENANT.slice(0, 8)}…
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, marginLeft: 220, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
}
