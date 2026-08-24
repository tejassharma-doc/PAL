'use client';

interface Props {
  doctorName: string;
  appointmentLabel: string;
  isConnecting: boolean;
  onDecline: () => void;
  onAccept: () => void;
}

export default function IncomingCallOverlay({
  doctorName,
  appointmentLabel,
  isConnecting,
  onDecline,
  onAccept,
}: Props) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(11,32,37,0.97)',
      zIndex: 90,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'space-between',
      padding: '56px 36px 60px',
      animation: 'fadeIn 0.3s ease',
    }}>
      <style>{`
        @keyframes callRing1 {
          0%   { transform: scale(1);   opacity: 0.55; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes callRing2 {
          0%   { transform: scale(1);   opacity: 0.38; }
          100% { transform: scale(2.7); opacity: 0; }
        }
        @keyframes callRing3 {
          0%   { transform: scale(1);   opacity: 0.22; }
          100% { transform: scale(3.2); opacity: 0; }
        }
      `}</style>

      {/* Label */}
      <div style={{ textAlign: 'center' }}>
        <p style={{
          fontFamily: 'var(--mono)', fontSize: '0.6rem',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: 'var(--jade)', marginBottom: 8,
        }}>
          Incoming call
        </p>
        <p style={{
          fontFamily: 'var(--serif)', fontWeight: 300,
          fontSize: '1.15rem', color: '#f6f3ec',
        }}>
          Hermes · PAL
        </p>
      </div>

      {/* Avatar + rings */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <div style={{ position: 'relative', width: 82, height: 82, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              position: 'absolute', width: 82, height: 82, borderRadius: '50%',
              border: '1.5px solid var(--jade)',
              animation: `callRing${i} 2.4s ${(i - 1) * 0.7}s ease-out infinite`,
            }} />
          ))}
          <div style={{
            width: 82, height: 82, borderRadius: '50%',
            background: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--serif)', fontSize: '2.1rem', fontWeight: 500, color: '#fff',
            position: 'relative', zIndex: 2,
            boxShadow: '0 0 0 3px rgba(55,181,155,0.28)',
          }}>
            H
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f6f3ec', marginBottom: 5 }}>
            Appointment reminder
          </p>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'rgba(246,243,236,0.55)' }}>
            {doctorName} · {appointmentLabel}
          </p>
        </div>
      </div>

      {/* Decline / Accept — full column is the tap target */}
      <div style={{ display: 'flex', gap: 56, alignItems: 'center' }}>
        <button
          onClick={onDecline}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'var(--rose)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(194,103,94,.45)',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .7-.3 1l-2.2 2.2z"
                fill="#fff" transform="rotate(135 12 12)" />
            </svg>
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(246,243,236,0.45)' }}>
            Decline
          </span>
        </button>

        <button
          onClick={onAccept}
          disabled={isConnecting}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            background: 'none', border: 'none', cursor: isConnecting ? 'wait' : 'pointer', padding: 0,
          }}
        >
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: isConnecting ? 'rgba(55,181,155,0.55)' : 'var(--jade)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 22px rgba(55,181,155,.5)',
            transition: 'background 0.2s',
          }}>
            {isConnecting ? (
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                border: '2.5px solid rgba(255,255,255,0.35)',
                borderTop: '2.5px solid #fff',
                animation: 'spin 0.8s linear infinite',
              }} />
            ) : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .7-.3 1l-2.2 2.2z"
                  fill="#fff" />
              </svg>
            )}
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(246,243,236,0.75)' }}>
            {isConnecting ? 'Connecting…' : 'Accept'}
          </span>
        </button>
      </div>
    </div>
  );
}
