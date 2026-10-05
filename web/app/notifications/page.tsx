'use client';

/**
 * Notifications (bell) screen.
 *
 * Shows the active patient's real medication reminders, driven entirely by the
 * backend (routers/medications.py): today's scheduled doses derived from their
 * medication_schedules, plus any dose that is still awaiting an answer, with the
 * four response buttons wired to POST /medications/doses/{id}/respond.
 *
 * No static/sample content — when there is nothing scheduled it shows an empty
 * state that links to the medication-schedule manager.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import AppBar from '@/components/layout/AppBar';
import TabBar from '@/components/layout/TabBar';
import PersonSheet from '@/components/layout/PersonSheet';
import {
  listMedicationSchedules,
  pendingDoses,
  respondToDose,
  type MedicationSchedule,
  type PendingDose,
  type DoseResponse,
} from '@/lib/medications-api';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ACK_OPTIONS: { value: DoseResponse; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'take_now', label: 'Will take now' },
  { value: 'snooze_10', label: 'In 10 mins' },
];

function activePatient(): { id: string | null; name: string } {
  if (typeof window === 'undefined') return { id: null, name: 'You' };
  return {
    id: localStorage.getItem('pal_patient_id'),
    name: localStorage.getItem('pal_patient_name') || 'You',
  };
}

// Mon=0 .. Sun=6, matching the backend's days_of_week encoding.
function todayDow(): number {
  return (new Date().getDay() + 6) % 7;
}

interface TodayDose {
  key: string;
  medicine: string;
  dosage: string | null;
  time: string;
}

/** Flatten active schedules into the individual doses due today. */
function dosesForToday(schedules: MedicationSchedule[]): TodayDose[] {
  const dow = todayDow();
  const out: TodayDose[] = [];
  for (const s of schedules) {
    if (!s.active) continue;
    if (s.days_of_week?.length && !s.days_of_week.includes(dow)) continue;
    for (const time of s.times || []) {
      out.push({ key: `${s.id}:${time}`, medicine: s.medicine_name, dosage: s.dosage, time });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export default function NotificationsPage() {
  const router = useRouter();
  const [showSheet, setShowSheet] = useState(false);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [personName, setPersonName] = useState('You');
  const [schedules, setSchedules] = useState<MedicationSchedule[]>([]);
  const [pending, setPending] = useState<PendingDose[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const p = activePatient();
    setPatientId(p.id);
    setPersonName(p.name);
  }, []);

  const load = useCallback(async () => {
    if (!patientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [sch, doses] = await Promise.all([
        listMedicationSchedules(patientId),
        pendingDoses(patientId),
      ]);
      setSchedules(sch);
      setPending(doses);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reminders');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = async (doseId: string, value: DoseResponse) => {
    setBusy(doseId);
    try {
      await respondToDose(doseId, value);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to respond');
    } finally {
      setBusy(null);
    }
  };

  const person = {
    initial: personName.charAt(0).toUpperCase() || 'Y',
    grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
    name: personName,
    sub: 'reminders',
  };

  const awaiting = pending.filter((d) => d.status === 'awaiting_ack');
  const today = dosesForToday(schedules);

  const sectionLabel = {
    fontFamily: "'Space Mono', monospace",
    fontSize: '0.6rem',
    textTransform: 'uppercase' as const,
    opacity: 0.5,
    margin: '14px 2px 10px',
    color: '#0d1f24',
  };

  const cardBase = {
    background: '#fff',
    border: '1px solid rgba(13,31,36,.10)',
    borderRadius: 14,
    padding: 13,
    marginBottom: 10,
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start' as const,
  };

  const iconBox = {
    width: 34,
    height: 34,
    borderRadius: 10,
    background: 'rgba(90,143,168,.14)',
    color: '#33607a',
    display: 'grid',
    placeItems: 'center' as const,
    fontSize: '0.9rem',
    flexShrink: 0,
  };

  return (
    <PhoneShell>
      <AppBar person={person} onAvatarTap={() => setShowSheet(true)} />

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 92px' }}>
        <div style={{
          fontFamily: "'Newsreader', serif",
          fontSize: '1.3rem',
          color: '#0d1f24',
          margin: '10px 2px 2px',
        }}>
          Reminders
        </div>

        {!patientId && (
          <div style={{ ...cardBase, display: 'block', color: '#0d1f24', marginTop: 12 }}>
            Select a patient to see their medication reminders.
          </div>
        )}

        {error && (
          <div style={{ ...cardBase, display: 'block', color: '#b4433a', marginTop: 12 }}>
            {error}
          </div>
        )}

        {loading && patientId && (
          <div style={{ opacity: 0.6, color: '#0d1f24', marginTop: 16 }}>Loading…</div>
        )}

        {/* Awaiting acknowledgement — the "did you take it?" prompts */}
        {!loading && awaiting.length > 0 && (
          <>
            <div style={sectionLabel}>Needs your answer</div>
            {awaiting.map((d) => (
              <div key={d.id} style={{ ...cardBase, borderColor: 'rgba(55,181,155,.5)' }}>
                <div style={{ ...iconBox, background: 'rgba(55,181,155,.14)', color: '#1f7d6b' }}>💊</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0d1f24' }}>
                    Did you take your medicine?
                  </div>
                  <div style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: '0.56rem',
                    opacity: 0.45,
                    marginTop: 6,
                    color: '#0d1f24',
                  }}>
                    {d.scheduled_time?.slice(0, 5)} · {d.scheduled_date}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {ACK_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        disabled={busy === d.id}
                        onClick={() => void answer(d.id, opt.value)}
                        style={{
                          background: opt.value === 'yes' || opt.value === 'take_now' ? '#37b59b' : 'transparent',
                          color: opt.value === 'yes' || opt.value === 'take_now' ? '#0c2429' : '#0d1f24',
                          border: opt.value === 'yes' || opt.value === 'take_now'
                            ? 'none'
                            : '1px solid rgba(13,31,36,.16)',
                          borderRadius: 8,
                          padding: '7px 13px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: busy === d.id ? 'default' : 'pointer',
                          opacity: busy === d.id ? 0.6 : 1,
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Today's scheduled doses */}
        {!loading && patientId && today.length > 0 && (
          <>
            <div style={sectionLabel}>Today</div>
            {today.map((d) => (
              <div key={d.key} style={cardBase}>
                <div style={iconBox}>💊</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0d1f24' }}>
                    {d.medicine}
                  </div>
                  {d.dosage && (
                    <div style={{ fontSize: '0.76rem', opacity: 0.72, marginTop: 3, color: '#0d1f24' }}>
                      {d.dosage}
                    </div>
                  )}
                  <div style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: '0.56rem',
                    opacity: 0.45,
                    marginTop: 6,
                    color: '#0d1f24',
                  }}>
                    {d.time}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Empty state */}
        {!loading && patientId && awaiting.length === 0 && today.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 40, color: '#0d1f24' }}>
            <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>🔔</div>
            <div style={{ fontFamily: "'Newsreader', serif", fontSize: '1rem', marginBottom: 6 }}>
              No reminders right now
            </div>
            <div style={{ fontSize: '0.76rem', opacity: 0.6, marginBottom: 16 }}>
              Medicine reminders will appear here at their scheduled times.
            </div>
            <button
              onClick={() => router.push('/medications')}
              style={{
                background: '#37b59b',
                color: '#0c2429',
                border: 'none',
                borderRadius: 8,
                padding: '9px 16px',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Manage medication reminders
            </button>
          </div>
        )}

        {/* Footer link to the schedule manager when there is content above */}
        {!loading && patientId && (awaiting.length > 0 || today.length > 0) && (
          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <button
              onClick={() => router.push('/medications')}
              style={{
                background: 'transparent',
                border: '1px solid rgba(13,31,36,.16)',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: '0.74rem',
                fontWeight: 600,
                color: '#0d1f24',
                cursor: 'pointer',
              }}
            >
              Manage schedules
            </button>
          </div>
        )}
      </div>

      <TabBar />

      {showSheet && <PersonSheet onClose={() => setShowSheet(false)} />}
    </PhoneShell>
  );
}
