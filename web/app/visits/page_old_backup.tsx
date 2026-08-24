'use client';

import { useState, useEffect } from 'react';
import PhoneShell from '@/components/layout/PhoneShell';
import AppBar from '@/components/layout/AppBar';
import TabBar from '@/components/layout/TabBar';
import PersonSheet from '@/components/layout/PersonSheet';
import IncomingCallOverlay from '@/components/call/IncomingCallOverlay';
import ActiveCallScreen from '@/components/call/ActiveCallScreen';
import { initiateCall } from '@/lib/api';
import { getUserVisits, DEFAULT_TENANT_ID, type Visit } from '@/lib/api-auth';

const VOICE_LANGS = new Set(['en', 'hi', 'pa', 'bn']);

const ANIL = {
  initial: 'A',
  grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
  name: 'Anil',
  sub: 'your record · active',
};

type CallPhase = 'idle' | 'incoming' | 'connecting' | 'active';

export default function VisitsPage() {
  const [showSheet, setShowSheet] = useState(false);
  const [callPhase, setCallPhase] = useState<CallPhase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [greeting, setGreeting] = useState('');
  const [callError, setCallError] = useState<string | null>(null);
  const [lang, setLang] = useState('en');
  const [upcomingVisits, setUpcomingVisits] = useState<Visit[]>([]);
  const [pastVisits, setPastVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('pal_lang') ?? 'en';
    setLang(stored);
  }, []);

  // Load visits from database
  useEffect(() => {
    async function loadVisits() {
      try {
        const patientId = localStorage.getItem('pal_patient_id');
        const name = localStorage.getItem('pal_user_name') || localStorage.getItem('pal_full_name') || '';

        setUserName(name);

        if (!patientId) {
          setLoading(false);
          return;
        }

        const { getPatientVisits } = await import('@/lib/api-auth');
        const data = await getPatientVisits(patientId);
        setUpcomingVisits(data.upcoming || []);
        setPastVisits(data.past || []);
      } catch (err) {
        console.error('Failed to load visits:', err);
      } finally {
        setLoading(false);
      }
    }

    loadVisits();
  }, []);

  const hasVoice = VOICE_LANGS.has(lang);

  // Helper to format visit datetime
  function formatVisitDate(isoString: string): string {
    try {
      const date = new Date(isoString);
      const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
      const day = date.getDate();
      const month = date.toLocaleDateString('en-US', { month: 'short' });
      const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      return `${weekday} ${day} ${month}, ${time}`;
    } catch {
      return isoString;
    }
  }

  // Helper to get doctor initial
  function getDoctorInitial(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  // Helper to get gradient for doctor
  function getDoctorGradient(index: number): string {
    const gradients = [
      'linear-gradient(150deg,#5a8fa8,#33607a)',
      'linear-gradient(150deg,#37b59b,#1f7d6b)',
      'linear-gradient(150deg,#d8a24a,#b07d2c)',
    ];
    return gradients[index % gradients.length];
  }

  // Split visits into upcoming and past
  async function startSession(skipToActive = false) {
    setCallPhase('connecting');
    setCallError(null);
    try {
      const session = await initiateCall({
        doctorId: 'rao-001',
        doctorName: 'Dr. Rao',
        patientName: 'Anil',
        appointmentReason: 'Lipid review',
      });
      setSessionId(session.session_id);
      setGreeting(
        session.hermes_response ??
          (hasVoice
            ? 'Hello Anil, this is Hermes calling about your upcoming appointment with Dr. Rao.'
            : 'Hi Anil! I\'m Hermes. I\'m reaching out about your lipid review with Dr. Rao on 26 Jun at 11:30. Do you have any questions, or would you like to reschedule?')
      );
      setCallPhase('active');
    } catch {
      if (process.env.NODE_ENV === 'development') {
        setSessionId('dev-mock-session');
        setGreeting(
          hasVoice
            ? 'Hello Anil! This is Hermes calling about your lipid review with Dr. Rao on Thursday, 26th June at 11:30 AM. I wanted to check if you have any questions before your visit, or if you need to reschedule?'
            : 'Hi Anil! I\'m Hermes. I\'m messaging about your lipid review with Dr. Rao on 26 Jun at 11:30 AM. Any questions, or would you like to reschedule?'
        );
        setCallPhase('active');
      } else {
        setCallError('Could not connect — is the backend running?');
        setCallPhase(skipToActive ? 'idle' : 'incoming');
      }
    }
  }

  const handleAccept = () => startSession(false);
  const handleTextChat = () => startSession(true);

  function handleDecline() {
    setCallPhase('idle');
    setCallError(null);
  }

  function handleEndCall() {
    setCallPhase('idle');
    setSessionId(null);
    setGreeting('');
    setCallError(null);
  }

  return (
    <PhoneShell>
      <AppBar
        person={ANIL}
        badgeCount={3}
        onAvatarTap={() => setShowSheet(true)}
      />

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 92px' }}>
        <div style={{
          fontFamily: "'Newsreader', serif",
          fontWeight: 300,
          fontSize: '1.5rem',
          margin: '12px 0 3px',
          color: '#0d1f24',
        }}>
          Your visits
        </div>
        <div style={{ fontSize: '0.8rem', opacity: .6, marginBottom: 16, color: '#0d1f24' }}>
          Every plan here comes from your care team.
        </div>

        {/* Upcoming appointment cards */}
        {loading ? (
          <div style={{
            background: 'linear-gradient(160deg,#13343b,#0c2429)',
            borderRadius: 14,
            padding: 15,
            color: '#f6f3ec',
            marginBottom: 14,
            textAlign: 'center',
          }}>
            Loading visits...
          </div>
        ) : upcomingVisits.length > 0 ? (
          upcomingVisits.map((visit) => (
            <div key={visit.id} style={{
              background: 'linear-gradient(160deg,#13343b,#0c2429)',
              borderRadius: 14,
              padding: 15,
              color: '#f6f3ec',
              marginBottom: 14,
              animation: 'fadeIn 0.4s ease',
            }}>
              <div style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '0.58rem',
                textTransform: 'uppercase',
                color: '#37b59b',
                marginBottom: 9,
              }}>
                ◷ upcoming
              </div>
              <div style={{ fontFamily: "'Newsreader', serif", fontSize: '1.05rem', marginBottom: 3 }}>
                {visit.reason}
              </div>
              <div style={{ fontSize: '0.76rem', opacity: .7, marginBottom: 13 }}>
                {visit.date}
              </div>

          {/* Hermes indicator — only when idle */}
          {callPhase === 'idle' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              borderTop: '1px solid rgba(255,255,255,.08)',
              paddingTop: 10, marginBottom: 10,
            }}>
              <style>{`
                @keyframes hermDot {
                  0%, 100% { opacity: 0.25; transform: translateY(0); }
                  40%       { opacity: 1;    transform: translateY(-3px); }
                }
              `}</style>
              <div style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                background: hasVoice ? 'rgba(55,181,155,.22)' : 'rgba(90,143,168,.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Newsreader', serif", fontSize: '0.72rem',
                color: hasVoice ? '#37b59b' : '#5a8fa8',
              }}>H</div>
              <span style={{
                fontFamily: "'Space Mono', monospace", fontSize: '0.82rem',
                color: '#f6f3ec', fontWeight: 700, flex: 1,
                display: 'flex', alignItems: 'center',
              }}>
                {hasVoice ? (
                  <>
                    Hermes is calling
                    {[0, 0.22, 0.44].map((delay, i) => (
                      <span key={i} style={{
                        display: 'inline-block',
                        animation: `hermDot 1.2s ${delay}s ease-in-out infinite`,
                      }}>.</span>
                    ))}
                  </>
                ) : 'Hermes wants to chat'}
              </span>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: hasVoice ? '#37b59b' : '#5a8fa8',
                animation: 'pulse-dot 1.3s infinite',
                display: 'inline-block',
              }} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={hasVoice ? () => setCallPhase('incoming') : handleTextChat}
              disabled={callPhase === 'connecting'}
              style={{
                flex: 1,
                background: '#37b59b',
                color: '#0c2429',
                border: 'none',
                borderRadius: 9,
                padding: '9px',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: callPhase === 'connecting' ? 'wait' : 'pointer',
                opacity: callPhase === 'connecting' ? 0.7 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              {callPhase === 'connecting' ? 'Connecting…' : 'Prepare with PAL'}
            </button>
            <button
              onClick={handleTextChat}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,.1)',
                color: '#f6f3ec',
                border: 'none',
                borderRadius: 9,
                padding: '9px',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reschedule
            </button>
          </div>

          {callError && (
            <p style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.56rem',
              color: 'var(--rose)',
              marginTop: 8,
              textAlign: 'center',
            }}>
              {callError}
            </p>
          )}
            </div>
          ))
        ) : (
          <div style={{
            background: '#fff',
            border: '1px solid rgba(13,31,36,.10)',
            borderRadius: 14,
            padding: 20,
            textAlign: 'center',
            marginBottom: 14,
          }}>
            <div style={{ fontSize: '0.85rem', opacity: 0.6, color: '#0d1f24' }}>
              No upcoming appointments
            </div>
          </div>
        )}

        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '0.62rem',
          textTransform: 'uppercase',
          opacity: .5,
          margin: '2px 2px 12px',
          color: '#0d1f24',
        }}>
          Care plans
        </div>

        {/* Past visits cards */}
        {loading ? (
          <div style={{
            background: '#fff',
            border: '1px solid rgba(13,31,36,.10)',
            borderRadius: 14,
            padding: 20,
            textAlign: 'center',
            marginBottom: 11,
          }}>
            <div style={{ fontSize: '0.85rem', opacity: 0.6, color: '#0d1f24' }}>
              Loading care plans...
            </div>
          </div>
        ) : pastVisits.length > 0 ? (
          pastVisits.map((visit, index) => {
            const isExpanded = expandedVisitId === visit.id;
            const day = visit.date.split(' ')[0];
            const month = visit.date.split(' ')[1];
            const year = visit.date.split(' ')[2];

            // Use doctor_id if available, otherwise use index-based name
            const doctorLabel = visit.doctor_id ? `Dr. ${visit.doctor_id.substring(0, 8)}` : `Doctor ${index + 1}`;
            const doctorInitial = visit.doctor_id ? visit.doctor_id.substring(0, 1).toUpperCase() : 'D';

            return (
              <div key={visit.id} style={{
                background: '#fff',
                border: '1px solid rgba(13,31,36,.10)',
                borderRadius: 14,
                padding: 14,
                marginBottom: 11,
              }}>
                <div
                  onClick={() => setExpandedVisitId(isExpanded ? null : visit.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', gap: 11, marginBottom: 10, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 11,
                      background: getDoctorGradient(index),
                      display: 'grid', placeItems: 'center',
                      color: '#fff', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0,
                    }}>
                      {doctorInitial}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#0d1f24' }}>
                        {doctorLabel}
                      </div>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.58rem', opacity: .55, color: '#0d1f24' }}>
                        {visit.reason}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#0d1f24' }}>
                        {day} {month}
                      </div>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.58rem', opacity: .5, color: '#0d1f24' }}>
                        {year}
                      </div>
                    </div>
                  </div>

                  {(visit.soap_note || visit.management_plan || visit.patient_summary || (visit.lab_tests && visit.lab_tests.length > 0)) && (
                    <div style={{
                      borderTop: '1px solid rgba(13,31,36,.08)',
                      paddingTop: 10,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ fontSize: '0.78rem', color: '#1f7d6b' }}>
                        ⛁ {visit.reason}
                      </span>
                      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.7rem', color: '#1f7d6b' }}>
                        {isExpanded ? 'close ↑' : 'open →'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(13,31,36,.10)' }}>
                    {/* Patient Summary */}
                    {visit.patient_summary && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{
                          fontFamily: "'Space Mono', monospace",
                          fontSize: '0.62rem',
                          letterSpacing: '.1em',
                          textTransform: 'uppercase',
                          opacity: .5,
                          marginBottom: 6
                        }}>Summary</div>
                        <div style={{
                          background: 'rgba(55,181,155,.08)',
                          borderRadius: 10,
                          padding: 12,
                          fontSize: '0.8rem',
                          lineHeight: 1.5,
                          color: '#0d1f24'
                        }}>
                          {visit.patient_summary}
                        </div>
                      </div>
                    )}

                    {/* SOAP Note */}
                    {visit.soap_note && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{
                          fontFamily: "'Space Mono', monospace",
                          fontSize: '0.62rem',
                          letterSpacing: '.1em',
                          textTransform: 'uppercase',
                          opacity: .5,
                          marginBottom: 6
                        }}>Clinical Notes (SOAP)</div>
                        <div style={{
                          fontSize: '0.75rem',
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                          color: '#0d1f24',
                          opacity: .8
                        }}>
                          {visit.soap_note}
                        </div>
                      </div>
                    )}

                    {/* Management Plan */}
                    {visit.management_plan && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{
                          fontFamily: "'Space Mono', monospace",
                          fontSize: '0.62rem',
                          letterSpacing: '.1em',
                          textTransform: 'uppercase',
                          opacity: .5,
                          marginBottom: 6
                        }}>Management Plan</div>
                        <div style={{
                          background: 'rgba(90,143,168,.08)',
                          borderRadius: 10,
                          padding: 12,
                          fontSize: '0.8rem',
                          lineHeight: 1.5,
                          color: '#0d1f24'
                        }}>
                          {visit.management_plan}
                        </div>
                      </div>
                    )}

                    {/* Lab Tests */}
                    {visit.lab_tests && visit.lab_tests.length > 0 && (
                      <div>
                        <div style={{
                          fontFamily: "'Space Mono', monospace",
                          fontSize: '0.62rem',
                          letterSpacing: '.1em',
                          textTransform: 'uppercase',
                          opacity: .5,
                          marginBottom: 6
                        }}>Lab Tests</div>
                        {visit.lab_tests.map((test) => (
                          <div key={test.id} style={{
                            background: test.abnormal_flag ? 'rgba(194,103,94,.08)' : 'rgba(13,31,36,.04)',
                            border: `1px solid ${test.abnormal_flag ? 'rgba(194,103,94,.2)' : 'rgba(13,31,36,.08)'}`,
                            borderRadius: 10,
                            padding: 10,
                            marginBottom: 8
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#0d1f24' }}>
                                  {test.test_name}
                                  {test.abnormal_flag && (
                                    <span style={{
                                      marginLeft: 6,
                                      fontFamily: "'Space Mono', monospace",
                                      fontSize: '0.55rem',
                                      background: 'rgba(194,103,94,.14)',
                                      color: '#c2675e',
                                      padding: '2px 6px',
                                      borderRadius: 8
                                    }}>⚠️ abnormal</span>
                                  )}
                                </div>
                                {test.interpretation && (
                                  <div style={{ fontSize: '0.7rem', opacity: .7, marginTop: 4, lineHeight: 1.4 }}>
                                    {test.interpretation}
                                  </div>
                                )}
                              </div>
                              {test.result_date && (
                                <div style={{
                                  fontFamily: "'Space Mono', monospace",
                                  fontSize: '0.6rem',
                                  opacity: .5,
                                  whiteSpace: 'nowrap',
                                  marginLeft: 8
                                }}>
                                  {test.result_date}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div style={{
            background: '#fff',
            border: '1px solid rgba(13,31,36,.10)',
            borderRadius: 14,
            padding: 20,
            textAlign: 'center',
            marginBottom: 11,
          }}>
            <div style={{ fontSize: '0.85rem', opacity: 0.6, color: '#0d1f24' }}>
              No past visits
            </div>
          </div>
        )}

      </div>

      <TabBar />

      {/* Incoming call overlay */}
      {(callPhase === 'incoming' || callPhase === 'connecting') && (
        <IncomingCallOverlay
          doctorName="Dr. Rao"
          appointmentLabel="Lipid review · 26 Jun"
          isConnecting={callPhase === 'connecting'}
          onDecline={handleDecline}
          onAccept={handleAccept}
        />
      )}

      {/* Active call / text chat screen */}
      {callPhase === 'active' && sessionId && (
        <ActiveCallScreen
          sessionId={sessionId}
          greeting={greeting}
          doctorName="Dr. Rao"
          lang={lang}
          textOnly={!hasVoice}
          onEnd={handleEndCall}
        />
      )}

      {showSheet && (
        <PersonSheet onClose={() => setShowSheet(false)} />
      )}
    </PhoneShell>
  );
}
