'use client';

import { useState, useEffect } from 'react';
import PhoneShell from '@/components/layout/PhoneShell';
import AppBar from '@/components/layout/AppBar';
import TabBar from '@/components/layout/TabBar';
import { getPatientVisits, type Visit } from '@/lib/api-auth';

const ANIL = {
  initial: 'A',
  grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
  name: 'Anil',
  sub: 'your record · active',
};

export default function VisitsPage() {
  const [upcomingVisits, setUpcomingVisits] = useState<Visit[]>([]);
  const [pastVisits, setPastVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null);

  useEffect(() => {
    async function loadVisits() {
      try {
        const patientId = localStorage.getItem('pal_patient_id');
        if (!patientId) {
          setLoading(false);
          return;
        }

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

  function getDoctorGradient(index: number): string {
    const gradients = [
      'linear-gradient(150deg,#5a8fa8,#33607a)',
      'linear-gradient(150deg,#37b59b,#1f7d6b)',
      'linear-gradient(150deg,#d8a24a,#b07d2c)',
    ];
    return gradients[index % gradients.length];
  }

  function getDoctorInitial(doctorId?: string): string {
    if (!doctorId) return 'D';
    return doctorId.substring(0, 1).toUpperCase();
  }

  return (
    <PhoneShell>
      <AppBar
        person={ANIL}
        badgeCount={3}
        onAvatarTap={() => {}}
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

        {/* UPCOMING SECTION */}
        {upcomingVisits.length > 0 && (
          <>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.62rem',
              textTransform: 'uppercase',
              opacity: .5,
              margin: '2px 2px 12px',
              color: '#0d1f24',
            }}>
              Upcoming
            </div>
            {upcomingVisits.map((visit) => (
              <div key={visit.id} style={{
                background: 'linear-gradient(160deg,#13343b,#0c2429)',
                borderRadius: 14,
                padding: 15,
                color: '#f6f3ec',
                marginBottom: 14,
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
                <div style={{ fontSize: '0.76rem', opacity: .7 }}>
                  {visit.date}
                </div>
              </div>
            ))}
          </>
        )}

        {/* CARE PLANS (PAST VISITS) */}
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

            const doctorLabel = visit.doctor_id
              ? `Dr. ${visit.doctor_id.substring(0, 8)}`
              : `Doctor ${index + 1}`;
            const doctorInitial = getDoctorInitial(visit.doctor_id);

            const hasDetails = visit.soap_note || visit.management_plan || visit.patient_summary || (visit.lab_tests && visit.lab_tests.length > 0);

            return (
              <div key={visit.id} style={{
                background: '#fff',
                border: '1px solid rgba(13,31,36,.10)',
                borderRadius: 14,
                padding: 14,
                marginBottom: 11,
              }}>
                <div
                  onClick={() => hasDetails && setExpandedVisitId(isExpanded ? null : visit.id)}
                  style={{ cursor: hasDetails ? 'pointer' : 'default' }}
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

                  {hasDetails && (
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

                {/* EXPANDED DETAILS */}
                {isExpanded && hasDetails && (
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

                    {/* SOAP Notes */}
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
    </PhoneShell>
  );
}
