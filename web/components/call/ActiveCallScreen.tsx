'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { sendCallTurn, endCall, CallSession, AppointmentSlot } from '@/lib/api';

// Web Speech API types
type SpeechRecognition = any;
type SpeechRecognitionEvent = any;

const KOKORO_TTS_LANGS = new Set(['en', 'hi', 'pa', 'bn']);
const SPEECH_LANG: Record<string, string> = {
  en: 'en-IN', hi: 'hi-IN', pa: 'pa-IN', bn: 'bn-BD',
  ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN',
  mr: 'mr-IN', gu: 'gu-IN', ur: 'ur-PK',
};

type Bubble = { role: 'hermes' | 'patient'; text: string; id: number };

interface Props {
  sessionId: string;
  greeting: string;
  doctorName: string;
  lang?: string;
  textOnly?: boolean;
  onEnd: () => void;
}

export default function ActiveCallScreen({
  sessionId,
  greeting,
  doctorName,
  lang = 'en',
  textOnly = false,
  onEnd,
}: Props) {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { role: 'hermes', text: greeting, id: 0 },
  ]);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [sttInterim, setSttInterim] = useState('');
  const [inputText, setInputText] = useState('');
  const [timer, setTimer] = useState(0);
  const [callEnded, setCallEnded] = useState(false);
  const [bookingDone, setBookingDone] = useState(false);
  const [confirmedSlot, setConfirmedSlot] = useState<AppointmentSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const bubbleCounter = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sttRef = useRef<SpeechRecognition | null>(null);
  const mutedRef = useRef(false);

  const hasTTS = !textOnly && KOKORO_TTS_LANGS.has(lang);
  const bcp = SPEECH_LANG[lang] ?? 'en-IN';

  const nextId = () => ++bubbleCounter.current;

  // Timer
  useEffect(() => {
    const id = setInterval(() => setTimer(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Speak greeting on mount
  useEffect(() => {
    if (hasTTS && greeting) speak(greeting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new bubbles
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' });
  }, [bubbles, isThinking]);

  function toggleMute() {
    const nowMuted = !mutedRef.current;
    mutedRef.current = nowMuted;
    setMuted(nowMuted);
    if (nowMuted) {
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
    }
  }

  function speak(text: string) {
    if (typeof window === 'undefined' || !hasTTS || mutedRef.current) return;
    window.speechSynthesis?.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = bcp;
    utter.rate = 0.93;
    utter.pitch = 1.06;
    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => setIsSpeaking(false);
    utter.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis?.speak(utter);
  }

  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking || callEnded) return;

    setBubbles(b => [...b, { role: 'patient', text: trimmed, id: nextId() }]);
    setInputText('');
    setSttInterim('');
    setIsThinking(true);
    setError(null);

    try {
      const session: CallSession = await sendCallTurn(sessionId, trimmed);
      const hermesText = session.hermes_response ?? '';

      if (hermesText) {
        setBubbles(b => [...b, { role: 'hermes', text: hermesText, id: nextId() }]);
        speak(hermesText);
      }

      if (session.booking_done && session.slot_id) {
        setBookingDone(true);
        const slot =
          session.available_slots?.find(s => s.slot_id === session.slot_id) ?? null;
        setConfirmedSlot(slot);
      }

      if (session.call_ended) {
        setCallEnded(true);
        window.speechSynthesis?.cancel();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection error');
    } finally {
      setIsThinking(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isThinking, callEnded]);

  function toggleSTT() {
    if (isRecording) {
      sttRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const SR =
      (window as unknown as Record<string, unknown>)['SpeechRecognition'] as
        (new () => SpeechRecognition) | undefined ??
      (window as unknown as Record<string, unknown>)['webkitSpeechRecognition'] as
        (new () => SpeechRecognition) | undefined;
    if (!SR) return;

    window.speechSynthesis?.cancel();
    setIsSpeaking(false);

    const rec = new SR();
    sttRef.current = rec;
    rec.lang = bcp;
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => setIsRecording(true);
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      for (const res of Array.from(e.results) as any[]) {
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      setSttInterim(interim);
      if (final) {
        setSttInterim('');
        handleSend(final);
      }
    };
    rec.onend = () => { setIsRecording(false); setSttInterim(''); };
    rec.onerror = () => { setIsRecording(false); setSttInterim(''); };
    rec.start();
  }

  async function handleEndCall() {
    window.speechSynthesis?.cancel();
    sttRef.current?.stop();
    try { await endCall(sessionId); } catch { /* ignore */ }
    onEnd();
  }

  const timerStr = `${String(Math.floor(timer / 60)).padStart(2, '0')}:${String(timer % 60).padStart(2, '0')}`;

  const srAvailable =
    typeof window !== 'undefined' &&
    !!(
      (window as unknown as Record<string, unknown>)['SpeechRecognition'] ||
      (window as unknown as Record<string, unknown>)['webkitSpeechRecognition']
    );

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(180deg,#0c2429 0%,#091e22 100%)',
      zIndex: 90,
      display: 'flex', flexDirection: 'column',
      animation: 'fadeIn 0.25s ease',
    }}>
      <style>{`
        @keyframes speakRing {
          0%, 100% { box-shadow: 0 0 0 0   rgba(55,181,155,0.55); }
          50%       { box-shadow: 0 0 0 14px rgba(55,181,155,0);   }
        }
        @keyframes thinkDot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40%            { opacity: 1;   transform: scale(1.2); }
        }
      `}</style>

      {/* Header */}
      <div style={{ padding: '50px 20px 14px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <p style={{
            fontFamily: 'var(--mono)', fontSize: '0.57rem',
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: callEnded ? 'rgba(246,243,236,0.4)' : 'var(--jade)',
          }}>
            {callEnded ? (textOnly ? 'Chat ended' : 'Call ended') : (textOnly ? 'Chat · Hermes' : 'Active call')}
          </p>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'rgba(246,243,236,0.55)', marginTop: 2 }}>
            {timerStr}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f6f3ec' }}>Hermes</p>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(246,243,236,0.4)' }}>
            {doctorName}
          </p>
        </div>
      </div>

      {/* Avatar */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 14, flexShrink: 0 }}>
        <div style={{
          width: 58, height: 58, borderRadius: '50%',
          background: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--serif)', fontSize: '1.55rem', fontWeight: 500, color: '#fff',
          animation: isSpeaking ? 'speakRing 1.1s ease infinite' : 'none',
          transition: 'box-shadow 0.3s',
        }}>
          H
        </div>
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="scr"
        style={{
          flex: 1, overflowY: 'auto',
          padding: '0 14px 8px',
          display: 'flex', flexDirection: 'column', gap: 9,
        }}
      >
        {bubbles.map(b => (
          <div
            key={b.id}
            style={{
              alignSelf: b.role === 'patient' ? 'flex-end' : 'flex-start',
              maxWidth: '84%',
              background: b.role === 'hermes'
                ? 'rgba(55,181,155,0.1)'
                : 'rgba(246,243,236,0.08)',
              border: b.role === 'hermes'
                ? '1px solid rgba(55,181,155,0.22)'
                : '1px solid rgba(246,243,236,0.1)',
              borderRadius: b.role === 'hermes'
                ? '4px 13px 13px 13px'
                : '13px 13px 4px 13px',
              padding: '9px 13px',
              animation: 'fadeIn 0.18s ease',
            }}
          >
            {b.role === 'hermes' && (
              <p style={{
                fontFamily: 'var(--mono)', fontSize: '0.51rem',
                color: 'var(--jade)', textTransform: 'uppercase',
                letterSpacing: '0.1em', marginBottom: 4,
              }}>
                Hermes
              </p>
            )}
            <p style={{ fontSize: '0.81rem', color: '#f6f3ec', lineHeight: 1.55 }}>
              {b.text}
            </p>
          </div>
        ))}

        {/* STT interim */}
        {isRecording && sttInterim && (
          <div style={{
            alignSelf: 'flex-end', maxWidth: '84%',
            background: 'rgba(246,243,236,0.05)',
            border: '1px dashed rgba(246,243,236,0.14)',
            borderRadius: '13px 13px 4px 13px',
            padding: '9px 13px',
          }}>
            <p style={{ fontSize: '0.81rem', color: 'rgba(246,243,236,0.5)', fontStyle: 'italic', lineHeight: 1.55 }}>
              {sttInterim}…
            </p>
          </div>
        )}

        {/* Thinking dots */}
        {isThinking && (
          <div style={{
            alignSelf: 'flex-start',
            background: 'rgba(55,181,155,0.1)',
            border: '1px solid rgba(55,181,155,0.22)',
            borderRadius: '4px 13px 13px 13px',
            padding: '14px 16px',
            display: 'flex', gap: 5,
          }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--jade)', display: 'inline-block',
                animation: `thinkDot 1.2s ${i * 0.2}s ease infinite`,
              }} />
            ))}
          </div>
        )}

        {/* Booking confirmed */}
        {bookingDone && (
          <div style={{
            background: 'rgba(55,181,155,0.14)',
            border: '1px solid rgba(55,181,155,0.38)',
            borderRadius: 12, padding: '12px 14px',
            animation: 'fadeIn 0.3s ease',
          }}>
            <p style={{
              fontFamily: 'var(--mono)', fontSize: '0.54rem',
              color: 'var(--jade)', textTransform: 'uppercase',
              letterSpacing: '0.12em', marginBottom: 6,
            }}>
              ✓ Booking confirmed
            </p>
            {confirmedSlot ? (
              <p style={{ fontSize: '0.8rem', color: '#f6f3ec', lineHeight: 1.55 }}>
                {confirmedSlot.doctor_name} · {confirmedSlot.clinic}
                <br />
                <span style={{ opacity: 0.65, fontFamily: 'var(--mono)', fontSize: '0.68rem' }}>
                  {confirmedSlot.datetime}
                </span>
              </p>
            ) : (
              <p style={{ fontSize: '0.8rem', color: '#f6f3ec', lineHeight: 1.55 }}>
                Your appointment has been booked with {doctorName}.
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(194,103,94,0.1)',
            border: '1px solid rgba(194,103,94,0.28)',
            borderRadius: 10, padding: '9px 13px',
          }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'var(--rose)' }}>
              ⚠ {error}
            </p>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div style={{
        padding: '10px 18px 38px',
        borderTop: '1px solid rgba(246,243,236,0.06)',
        background: 'rgba(0,0,0,0.18)',
        flexShrink: 0,
      }}>
        {!callEnded ? (
          <>
            {/* Text input */}
            <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginBottom: 12 }}>
              <input
                type="text"
                value={isRecording ? sttInterim : inputText}
                onChange={e => !isRecording && setInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isRecording && handleSend(inputText)}
                placeholder={isRecording ? 'Listening…' : 'Type a reply…'}
                disabled={isThinking}
                style={{
                  flex: 1,
                  background: 'rgba(246,243,236,0.07)',
                  border: '1px solid rgba(246,243,236,0.13)',
                  borderRadius: 22,
                  padding: '10px 16px',
                  fontSize: '0.81rem', color: '#f6f3ec',
                  fontFamily: 'var(--sans)', outline: 'none',
                  fontStyle: isRecording ? 'italic' : 'normal',
                  caretColor: 'var(--jade)',
                }}
              />
              <button
                onClick={() => !isRecording && handleSend(inputText)}
                disabled={!inputText.trim() || isThinking || isRecording}
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: inputText.trim() && !isThinking && !isRecording
                    ? 'var(--jade)'
                    : 'rgba(246,243,236,0.09)',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M13 1.5 L1.5 7 L7 8.2 L8.2 13 Z" fill="rgba(246,243,236,0.85)" />
                </svg>
              </button>
            </div>

            {/* Mic + speaking stop + end call row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px' }}>
              {/* Mute toggle (left anchor) */}
              <div style={{ minWidth: 64, display: 'flex', justifyContent: 'center' }}>
                {hasTTS && (
                  <button
                    onClick={toggleMute}
                    aria-label={muted ? 'Unmute Hermes' : 'Mute Hermes'}
                    title={muted ? 'Unmute' : 'Mute audio'}
                    style={{
                      width: 42, height: 42, borderRadius: '50%',
                      background: muted
                        ? 'rgba(194,103,94,0.18)'
                        : 'rgba(55,181,155,0.12)',
                      border: muted
                        ? '1.5px solid rgba(194,103,94,0.38)'
                        : '1.5px solid rgba(55,181,155,0.22)',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.2s',
                      color: muted ? 'var(--rose)' : 'var(--jade)',
                    }}
                  >
                    {muted ? (
                      /* Speaker-off */
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <path d="M2 6.5v5h3l4 3V3.5L5 6.5H2z" fill="currentColor" />
                        <line x1="12" y1="5.5" x2="16.5" y2="12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <line x1="16.5" y1="5.5" x2="12" y2="12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    ) : (
                      /* Speaker-on with waves */
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <path d="M2 6.5v5h3l4 3V3.5L5 6.5H2z" fill="currentColor" />
                        <path d="M12.5 5.5a4 4 0 010 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M14.5 3.5a7 7 0 010 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
                      </svg>
                    )}
                  </button>
                )}
              </div>

              {/* Mic — only for voice mode */}
              {!textOnly && srAvailable && (
                <button
                  onClick={toggleSTT}
                  disabled={isThinking}
                  aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                  style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: isRecording
                      ? 'var(--rose)'
                      : 'rgba(55,181,155,0.16)',
                    border: isRecording
                      ? 'none'
                      : '1.5px solid rgba(55,181,155,0.32)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    animation: isRecording ? 'palpulse 1s infinite' : 'none',
                    transition: 'background 0.2s',
                    opacity: isThinking ? 0.4 : 1,
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <rect x="7" y="2" width="8" height="12" rx="4"
                      fill={isRecording ? '#fff' : 'var(--jade)'} />
                    <path d="M4 11a7 7 0 0014 0"
                      stroke={isRecording ? '#fff' : 'var(--jade)'}
                      strokeWidth="1.8" strokeLinecap="round" fill="none" />
                    <line x1="11" y1="18" x2="11" y2="21"
                      stroke={isRecording ? '#fff' : 'var(--jade)'}
                      strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              )}

              {/* End call */}
              <button
                onClick={handleEndCall}
                aria-label="End call"
                style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: 'var(--rose)',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 18px rgba(194,103,94,.42)',
                  minWidth: 56,
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .7-.3 1l-2.2 2.2z"
                    fill="#fff"
                    transform="rotate(135 12 12)"
                  />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p style={{
              fontFamily: 'var(--mono)', fontSize: '0.6rem',
              color: 'rgba(246,243,236,0.45)', marginBottom: 18,
            }}>
              {timerStr} · {textOnly ? 'Chat ended' : 'Call ended'}
            </p>
            <button
              onClick={onEnd}
              style={{
                background: 'rgba(246,243,236,0.08)',
                color: '#f6f3ec',
                border: '1px solid rgba(246,243,236,0.18)',
                borderRadius: 22, padding: '10px 30px',
                fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
