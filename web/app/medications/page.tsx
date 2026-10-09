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

  // inline edit state (per-schedule)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMed, setEditMed] = useState('');
  const [editDosage, setEditDosage] = useState('');
  const [editTimes, setEditTimes] = useState<string[]>([]);
  const [editDays, setEditDays] = useState<number[]>([]);
  const [editSaving, setEditSaving] = useState(false);

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

  // ── inline edit ──────────────────────────────────────────────────────────────
  const startEdit = (s: MedicationSchedule) => {
    setEditingId(s.id);
    setEditMed(s.medicine_name);
    setEditDosage(s.dosage || '');
    setEditTimes(s.times?.length ? [...s.times] : ['09:00']);
    setEditDays(s.days_of_week?.length ? [...s.days_of_week] : [0, 1, 2, 3, 4, 5, 6]);
  };
  const cancelEdit = () => setEditingId(null);
  const toggleEditDay = (d: number) =>
    setEditDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  const updateEditTime = (i: number, v: string) =>
    setEditTimes((prev) => prev.map((t, idx) => (idx === i ? v : t)));
  const addEditTime = () => setEditTimes((prev) => [...prev, '12:00']);
  const removeEditTime = (i: number) => setEditTimes((prev) => prev.filter((_, idx) => idx !== i));
  const saveEdit = async (s: MedicationSchedule) => {
    if (!editMed.trim()) return;
    setEditSaving(true);
    try {
      await updateMedicationSchedule(s.id, {
        medicine_name: editMed.trim(),
        dosage: editDosage.trim() || undefined,
        times: editTimes.filter(Boolean),
        days_of_week: editDays,
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setEditSaving(false);
    }
  };

  const person = {
    initial: personName.charAt(0).toUpperCase() || 'Y',
    grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
    name: personName,
    sub: 'medication schedule',
  };

  // Light theme, matching the rest of the app (PhoneShell is cream with dark ink).
  const ink = '#0d1f24';
  const jade = '#37b59b';
  const jadeD = '#1f7d6b';
  const rose = '#b4433a';
  const border = 'rgba(13,31,36,0.12)';
  const muted = 'rgba(13,31,36,0.58)';

  const label = { fontSize: 12.5, color: muted, marginBottom: 5, display: 'block', fontWeight: 600 } as const;
  const input = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${border}`,
    background: '#fff',
    color: ink,
    fontSize: 14,
    outline: 'none',
  } as const;
  const card = {
    background: '#fff',
    borderRadius: 16,
    padding: 16,
    margin: '0 0 14px',
    border: `1px solid ${border}`,
    boxShadow: '0 1px 2px rgba(13,31,36,.04)',
  } as const;

  const DOW_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function scheduleSummary(s: MedicationSchedule): string {
    const t = (s.times || []).join(', ') || '—';
    // Always list the days explicitly; an empty array means every day → list all 7.
    const dows = s.days_of_week?.length ? s.days_of_week : [0, 1, 2, 3, 4, 5, 6];
    const d = dows.map((x) => DAYS[x]).join(', ');
    return `${t} · ${d}`;
  }

  return (
    <PhoneShell>
      <AppBar person={person} />

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '10px 18px 92px', color: ink }}>
        <h2 style={{ fontSize: 20, margin: '6px 0 2px', color: ink, fontWeight: 700 }}>
          Medication reminders
        </h2>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 14 }}>
          {schedules.length > 0
            ? `${schedules.filter((s) => s.active).length} active · ${schedules.length} total`
            : 'Add medicines to get reminders at the right time'}
        </div>

        {!patientId && (
          <div style={{ ...card, color: ink }}>Select a patient to manage medication reminders.</div>
        )}
        {error && (
          <div style={{ ...card, color: rose, borderColor: 'rgba(180,67,58,.35)' }}>{error}</div>
        )}

        {patientId && (
          <div style={card}>
            <div style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.58rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: jadeD,
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
                          style={{ ...input, width: 44, cursor: 'pointer', color: rose, fontWeight: 700 }}>✕</button>
                )}
              </div>
            ))}
            <button onClick={addTimeRow}
                    style={{ background: 'transparent', border: 'none', color: jadeD,
                             fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '2px 0' }}>
              + add another time
            </button>

            <div style={{ height: 14 }} />
            <label style={label}>Days (none = every day)</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAYS.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button key={d} onClick={() => toggleDay(i)}
                          title={d}
                          style={{
                            width: 36, height: 36,
                            borderRadius: 999,
                            border: on ? 'none' : `1px solid ${border}`,
                            background: on ? jade : '#fff',
                            color: on ? '#06201a' : ink,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}>
                    {DOW_SHORT[i]}
                  </button>
                );
              })}
            </div>

            <div style={{ height: 16 }} />
            <button onClick={() => void submit()} disabled={saving || !medicine.trim()}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: 10,
                      border: 'none',
                      background: jade,
                      color: '#06201a',
                      fontWeight: 700,
                      fontSize: 15,
                      cursor: saving ? 'default' : 'pointer',
                      opacity: saving || !medicine.trim() ? 0.6 : 1,
                    }}>
              {saving ? 'Saving…' : '＋ Add reminder'}
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ color: muted }}>Loading…</div>
        ) : (
          schedules.map((s) =>
            editingId === s.id ? (
              // ── inline editor ──
              <div key={s.id} style={{ ...card, borderLeft: `3px solid ${jade}` }}>
                <div style={{
                  fontFamily: "'Space Mono', monospace", fontSize: '0.58rem',
                  letterSpacing: '0.12em', textTransform: 'uppercase', color: jadeD, marginBottom: 12,
                }}>
                  ✎ edit reminder
                </div>

                <label style={label}>Medicine name</label>
                <input style={input} value={editMed} onChange={(e) => setEditMed(e.target.value)} />

                <div style={{ height: 12 }} />
                <label style={label}>Dosage (optional)</label>
                <input style={input} value={editDosage} onChange={(e) => setEditDosage(e.target.value)}
                       placeholder="e.g. 1 tablet" />

                <div style={{ height: 12 }} />
                <label style={label}>Times</label>
                {editTimes.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input type="time" style={{ ...input, flex: 1 }} value={t}
                           onChange={(e) => updateEditTime(i, e.target.value)} />
                    {editTimes.length > 1 && (
                      <button onClick={() => removeEditTime(i)}
                              style={{ ...input, width: 44, cursor: 'pointer', color: rose, fontWeight: 700 }}>✕</button>
                    )}
                  </div>
                ))}
                <button onClick={addEditTime}
                        style={{ background: 'transparent', border: 'none', color: jadeD,
                                 fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '2px 0' }}>
                  + add another time
                </button>

                <div style={{ height: 14 }} />
                <label style={label}>Days</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DAYS.map((d, i) => {
                    const on = editDays.includes(i);
                    return (
                      <button key={d} onClick={() => toggleEditDay(i)} title={d}
                              style={{
                                width: 36, height: 36, borderRadius: 999,
                                border: on ? 'none' : `1px solid ${border}`,
                                background: on ? jade : '#fff',
                                color: on ? '#06201a' : ink,
                                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                              }}>
                        {DOW_SHORT[i]}
                      </button>
                    );
                  })}
                </div>

                <div style={{ height: 16 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => void saveEdit(s)} disabled={editSaving || !editMed.trim()}
                          style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none',
                                   background: jade, color: '#06201a', fontWeight: 700, fontSize: 14,
                                   cursor: editSaving ? 'default' : 'pointer',
                                   opacity: editSaving || !editMed.trim() ? 0.6 : 1 }}>
                    {editSaving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={cancelEdit}
                          style={{ padding: '11px 16px', borderRadius: 10, border: `1px solid ${border}`,
                                   background: '#fff', color: ink, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              // ── normal card ──
              <div key={s.id} style={{
                ...card,
                opacity: s.active ? 1 : 0.6,
                borderLeft: `3px solid ${s.active ? jade : border}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: ink, wordBreak: 'break-word' }}>
                      {s.medicine_name}
                    </div>
                    {s.dosage && <div style={{ fontSize: 13, color: muted, marginTop: 2 }}>{s.dosage}</div>}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8,
                      background: 'rgba(55,181,155,.12)', color: jadeD,
                      borderRadius: 8, padding: '4px 9px', fontSize: 12.5, fontWeight: 600,
                    }}>
                      ⏰ {scheduleSummary(s)}
                    </div>
                    {!s.active && (
                      <div style={{ fontSize: 11.5, color: muted, marginTop: 6, fontStyle: 'italic' }}>Paused</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => startEdit(s)}
                            style={{ fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8,
                                     border: 'none', background: jade, color: '#06201a', cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button onClick={() => void toggleActive(s)}
                            style={{ fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8,
                                     border: `1px solid ${border}`, background: '#fff',
                                     color: ink, cursor: 'pointer' }}>
                      {s.active ? 'Pause' : 'Resume'}
                    </button>
                    <button onClick={() => void remove(s)}
                            style={{ fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8,
                                     border: `1px solid rgba(180,67,58,.35)`, background: '#fff',
                                     color: rose, cursor: 'pointer' }}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          )
        )}

        {!loading && patientId && schedules.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 32, color: muted }}>
            <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>💊</div>
            <div style={{ fontSize: 14, color: ink, fontWeight: 600 }}>No medication reminders yet</div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>Add one above, or upload a prescription.</div>
          </div>
        )}
      </div>

      <TabBar />
    </PhoneShell>
  );
}
