'use client';

import React from 'react';

/**
 * The phone frame every sub-page renders into.
 * - Narrow screens (< 600px, i.e. a real phone): the frame disappears and the
 *   app fills the whole viewport.
 * - Wider screens: a 400px-wide phone, as tall as the window allows (max 920px).
 */
export default function PhoneShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="pal-shell-page" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(120% 80% at 50% -10%, #18454e 0%, #13343b 38%, #0c2429 100%)',
    }}>
      <style>{`
        .pal-shell-frame { width: 400px; height: min(920px, calc(100dvh - 40px)); min-height: 600px; padding: 11px; border-radius: 40px; }
        .pal-shell-screen { border-radius: 30px; }
        @media (max-width: 599px) {
          .pal-shell-page { min-height: 100dvh !important; }
          .pal-shell-frame { width: 100vw; height: 100dvh; min-height: 0; padding: 0; border-radius: 0; box-shadow: none !important; }
          .pal-shell-screen { border-radius: 0; }
          .pal-shell-notch { display: none; }
        }
      `}</style>
      <div className="pal-shell-frame" style={{
        background: '#f6f3ec',
        boxShadow: '0 1px 2px rgba(13,31,36,.06),0 30px 70px -22px rgba(0,0,0,.6),0 0 0 2px rgba(255,255,255,.06)',
        position: 'relative',
        flexShrink: 0,
      }}>
        <div className="pal-shell-notch" style={{
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
        <div className="pal-shell-screen" style={{
          width: '100%',
          height: '100%',
          background: '#fbf9f4',
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
