/**
 * Medication reminder REST client.
 *
 * House style, matching lib/family-api.ts:
 *   - relative `/api/...` paths (proxied by app/api/[...proxy]/route.ts)
 *   - bearer from localStorage `pal_token`
 *   - throwing helpers unwrap `detail`
 *
 * Backend: routers/medications.py (mounted when MEDICATION_REMINDER_ENABLED=true).
 */

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('pal_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeaders() };
}

async function unwrap<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).detail || `${what} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

// ── types ────────────────────────────────────────────────────────────────────
export interface MedicationSchedule {
  id: string;
  patient_id: string;
  medicine_name: string;
  dosage: string | null;
  times: string[];           // ["09:00", "21:00"]
  days_of_week: number[];    // [] => daily; Mon=0
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  active: boolean;
  notes: string | null;
}

export interface ScheduleInput {
  patient_id: string;
  medicine_name: string;
  dosage?: string;
  times: string[];
  days_of_week?: number[];
  start_date?: string | null;
  end_date?: string | null;
  timezone?: string;
  notes?: string;
}

export type DoseResponse = 'yes' | 'no' | 'take_now' | 'snooze_10';

export interface PendingDose {
  id: string;
  schedule_id: string;
  patient_id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  response: string | null;
}

// ── schedules ──────────────────────────────────────────────────────────────────
export async function listMedicationSchedules(patientId: string): Promise<MedicationSchedule[]> {
  const res = await fetch(`/api/medications/schedules?patient_id=${encodeURIComponent(patientId)}`, {
    headers: authHeaders(),
  });
  const data = await unwrap<{ schedules: MedicationSchedule[] }>(res, 'List schedules');
  return data.schedules;
}

export async function createMedicationSchedule(input: ScheduleInput): Promise<MedicationSchedule> {
  const res = await fetch('/api/medications/schedules', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  return unwrap<MedicationSchedule>(res, 'Create schedule');
}

export async function updateMedicationSchedule(
  id: string,
  patch: Partial<ScheduleInput> & { active?: boolean },
): Promise<MedicationSchedule> {
  const res = await fetch(`/api/medications/schedules/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify(patch),
  });
  return unwrap<MedicationSchedule>(res, 'Update schedule');
}

export async function deleteMedicationSchedule(id: string): Promise<void> {
  const res = await fetch(`/api/medications/schedules/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await unwrap(res, 'Delete schedule');
}

// ── doses ──────────────────────────────────────────────────────────────────────
export async function pendingDoses(patientId: string): Promise<PendingDose[]> {
  const res = await fetch(`/api/medications/doses/pending?patient_id=${encodeURIComponent(patientId)}`, {
    headers: authHeaders(),
  });
  const data = await unwrap<{ doses: PendingDose[] }>(res, 'Pending doses');
  return data.doses;
}

export async function respondToDose(doseId: string, response: DoseResponse): Promise<void> {
  const res = await fetch(`/api/medications/doses/${doseId}/respond`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ response }),
  });
  await unwrap(res, 'Respond to dose');
}

// ── push device tokens (mobile app) ──────────────────────────────────────────────
export async function registerDeviceToken(platform: 'ios' | 'android' | 'web', token: string): Promise<void> {
  const res = await fetch('/api/medications/device-tokens', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ platform, token }),
  });
  await unwrap(res, 'Register device token');
}
