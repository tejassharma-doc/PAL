'use client';

import { useState } from 'react';

/**
 * Slide-to-complete control for the pre-visit interview.
 *
 * Drag the thumb to the end to open the (public) pre-visit link. Uses a
 * transparent native range input underneath so touch dragging works on mobile,
 * with a custom thumb + fill rendered on top.
 */
export default function PrevisitSlider({
  url,
  label = 'Slide to complete pre-visit',
}: {
  url: string;
  label?: string;
}) {
  const [val, setVal] = useState(0);
  const [done, setDone] = useState(false);
  const THUMB = 40;

  const release = () => {
    if (val >= 90) {
      setDone(true);
      setVal(100);
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      setVal(0);
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        height: 46,
        borderRadius: 23,
        background: 'rgba(55,181,155,.14)',
        border: '1px solid rgba(55,181,155,.4)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* filled track */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: `${val}%`,
          background: 'rgba(55,181,155,.3)',
          transition: val === 0 ? 'width .22s ease' : 'none',
        }}
      />
      {/* label */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          fontSize: '.8rem',
          fontWeight: 600,
          color: '#1f7d6b',
          pointerEvents: 'none',
          fontFamily: 'Georgia, serif',
        }}
      >
        {done ? '✓ Opening pre-visit…' : label}
      </div>
      {/* transparent native range (handles the drag + touch) */}
      {!done && (
        <input
          type="range"
          min={0}
          max={100}
          value={val}
          aria-label={label}
          onChange={(e) => setVal(Number(e.target.value))}
          onPointerUp={release}
          onMouseUp={release}
          onTouchEnd={release}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            cursor: 'grab',
            margin: 0,
          }}
        />
      )}
      {/* custom thumb follows val */}
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: `calc(${val}% - ${(val / 100) * THUMB}px)`,
          width: THUMB,
          height: THUMB,
          borderRadius: '50%',
          background: '#37b59b',
          display: 'grid',
          placeItems: 'center',
          color: '#06201a',
          fontWeight: 700,
          pointerEvents: 'none',
          boxShadow: '0 2px 6px rgba(0,0,0,.2)',
          transition: val === 0 ? 'left .22s ease' : 'none',
        }}
      >
        {done ? '✓' : '→'}
      </div>
    </div>
  );
}
