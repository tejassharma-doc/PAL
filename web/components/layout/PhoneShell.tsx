'use client';

import React from 'react';

export default function PhoneShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(120% 80% at 50% -10%, #18454e 0%, #13343b 38%, #0c2429 100%)',
    }}>
      <div style={{
        width: 344,
        height: 728,
        background: '#f6f3ec',
        borderRadius: 40,
        padding: 11,
        boxShadow: '0 1px 2px rgba(13,31,36,.06),0 30px 70px -22px rgba(0,0,0,.6),0 0 0 2px rgba(255,255,255,.06)',
        position: 'relative',
        flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute',
          top: 11,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 122,
          height: 24,
          background: '#f6f3ec',
          borderRadius: '0 0 16px 16px',
          zIndex: 30,
        }} />
        <div style={{
          width: '100%',
          height: '100%',
          background: '#fbf9f4',
          borderRadius: 30,
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          color: '#0d1f24',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}
