'use client';

/**
 * Medication schedule manager.
 *
 * Lists the active patient's medicine schedules and lets them add / deactivate /
 * delete one. The Celery worker reads these rows and fires reminders at each
 * listed time (see api/tasks/medication_tasks.py). Reminder prompts themselves
 * are shown globally by components/medications/MedicationReminderHost.tsx.
 */
import { useCallback, useEffect, useState } from 'react';
import PhoneShell from '@/components/layout/PhoneShell';
import AppBar from '@/components/layout/AppBar';
import TabBar from '@/components/layout/TabBar';
import {
  listMedicationSchedules,
  createMedicationSchedule,
  updateMedicationSchedule,
  deleteMedicationSchedule,
  type MedicationSchedule,
} from '@/lib/medications-api';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function activePatient(): { id: string | null; name: string } {
  if (typeof window === 'undefined') return { id: null, name: 'You' };
  return {
    id: localStorage.getItem('pal_patient_id'),
    name: localStorage.getItem('pal_patient_name') || 'You',
  };
}

export default function MedicationsPage() {
  const [patientId, setPatientId] = useState<string | null>(null);
  const [personName, setPersonName] = useState('You');
  const [schedules, setSchedules] = useState<MedicationSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [medicine, setMedicine] = useState('');
  const [dosage, setDosage] = useState('');
  const [times, setTimes] = useState<string[]>(['09:00']);
  const [days, setDays] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

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
      setSchedules(await listMedicationSchedules(patientId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const updateTime = (i: number, v: string) =>
    setTimes((prev) => prev.map((t, idx) => (idx === i ? v : t)));

  const addTimeRow = () => setTimes((prev) => [...prev, '12:00']);
  const removeTimeRow = (i: number) => setTimes((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!patientId || !medicine.trim()) return;
    setSaving(true);
    try {
      await createMedicationSchedule({
        patient_id: patientId,
        medicine_name: medicine.trim(),
        dosage: dosage.trim() || undefined,
        times: times.filter(Boolean),
        days_of_week: days,
      });
      setMedicine('');
      setDosage('');
      setTimes(['09:00']);
      setDays([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: MedicationSchedule) => {
    await updateMedicationSchedule(s.id, { active: !s.active });
    await load();
  };

  const remove = async (s: MedicationSchedule) => {
    await deleteMedicationSchedule(s.id);
    await load();
  };

  const person = {
    initial: personName.charAt(0).toUpperCase() || 'Y',
    grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
    name: personName,
    sub: 'medication schedule',
  };

  const label = { fontSize: 13, opacity: 0.8, marginBottom: 4, display: 'block' } as const;
  const input = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #27423a',
    background: '#0c2429',
    color: '#eaf5f1',
    fontSize: 14,
  } as const;
  const card = {
    background: 'linear-gradient(160deg,#13343b,#0c2429)',
    borderRadius: 16,
    padding: 16,
    margin: '0 0 14px',
  } as const;

  return (
    <PhoneShell>
      <AppBar person={person} />

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '10px 18px 92px' }}>
        <h2 style={{ fontSize: 20, margin: '6px 0 14px' }}>Medication reminders</h2>

        {!patientId && (
          <div style={card}>Select a patient to manage medication reminders.</div>
        )}
        {error && (
          <div style={{ ...card, color: '#ffb4ab' }}>{error}</div>
        )}

        {patientId && (
          <div style={card}>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.58rem',
              textTransform: 'uppercase',
              color: '#37b59b',
              marginBottom: 12,
            }}>
              ✶ add a medicine
            </div>

            <label style={label}>Medicine name</label>
            <input style={input} value={medicine} onChange={(e) => setMedicine(e.target.value)}
                   placeholder="e.g. Atorvastatin" />

            <div style={{ height: 12 }} />
            <label style={label}>Dosage (optional)</label>
            <input style={input} value={dosage} onChange={(e) => setDosage(e.target.value)}
                   placeholder="e.g. 1 tablet" />

            <div style={{ height: 12 }} />
            <label style={label}>Times</label>
            {times.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input type="time" style={{ ...input, flex: 1 }} value={t}
                       onChange={(e) => updateTime(i, e.target.value)} />
                {times.length > 1 && (
                  <button onClick={() => removeTimeRow(i)}
                          style={{ ...input, width: 44, cursor: 'pointer' }}>✕</button>
                )}
              </div>
            ))}
            <button onClick={addTimeRow}
                    style={{ ...input, width: 'auto', cursor: 'pointer', fontSize: 13 }}>
              + add another time
            </button>

            <div style={{ height: 14 }} />
            <label style={label}>Days (none = every day)</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAYS.map((d, i) => (
                <button key={d} onClick={() => toggleDay(i)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 999,
                          border: '1px solid #27423a',
                          background: days.includes(i) ? '#37b59b' : 'transparent',
                          color: days.includes(i) ? '#06201a' : '#eaf5f1',
                          fontSize: 13,
                          cursor: 'pointer',
                        }}>
                  {d}
                </button>
              ))}
            </div>

            <div style={{ height: 16 }} />
            <button onClick={() => void submit()} disabled={saving || !medicine.trim()}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: 10,
                      border: 'none',
                      background: '#37b59b',
                      color: '#06201a',
                      fontWeight: 700,
                      fontSize: 15,
                      cursor: saving ? 'default' : 'pointer',
                      opacity: saving || !medicine.trim() ? 0.6 : 1,
                    }}>
              {saving ? 'Saving…' : 'Add reminder'}
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ opacity: 0.7 }}>Loading…</div>
        ) : (
          schedules.map((s) => (
            <div key={s.id} style={{ ...card, opacity: s.active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{s.medicine_name}</div>
                  {s.dosage && <div style={{ fontSize: 13, opacity: 0.8 }}>{s.dosage}</div>}
                  <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
                    ⏰ {(s.times || []).join(', ') || '—'}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                    {s.days_of_week?.length
                      ? s.days_of_week.map((d) => DAYS[d]).join(', ')
                      : 'Every day'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button onClick={() => void toggleActive(s)}
                          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8,
                                   border: '1px solid #27423a', background: 'transparent',
                                   color: '#eaf5f1', cursor: 'pointer' }}>
                    {s.active ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => void remove(s)}
                          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8,
                                   border: '1px solid #5a2b2b', background: 'transparent',
                                   color: '#ffb4ab', cursor: 'pointer' }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}

        {!loading && patientId && schedules.length === 0 && (
          <div style={{ opacity: 0.7, textAlign: 'center', marginTop: 24 }}>
            No medication reminders yet.
          </div>
        )}
      </div>

      <TabBar />
    </PhoneShell>
  );
}
