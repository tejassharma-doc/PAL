/**
 * Hermes voice-call client, kept as-is for the Hermes call components
 * (components/HermesChatScreen.tsx, screens/legacy/VisitsScreen.tsx).
 *
 * NOTE: the PAL FastAPI backend in this repo does not mount a /calls router,
 * so these endpoints 404 against palcare.life/api today. They are not wired
 * into the app's navigation; they are preserved for the separate Hermes
 * agent work and must not be removed without that team.
 */
import { DEFAULT_TENANT_ID } from '../config'
import { request } from './http'
import { loadSession } from './session'

export interface AppointmentSlot {
  slot_id: string
  doctor_id: string
  doctor_name: string
  clinic: string
  datetime: string
  duration_minutes: number
  available: boolean
}

export interface CallSession {
  session_id: string
  status: 'ringing' | 'active' | 'ended' | 'missed'
  hermes_response?: string
  call_state: string
  call_ended: boolean
  available_slots?: AppointmentSlot[]
  appointment_agreed?: boolean
  slot_id?: string | null
  booking_done?: boolean
}

async function memberId(): Promise<string> {
  const s = await loadSession()
  return s?.userId ?? DEFAULT_TENANT_ID
}

export async function initiateCall(params: {
  doctorId: string
  doctorName: string
  patientName?: string
  appointmentReason?: string
}): Promise<CallSession> {
  return request('/calls/initiate', {
    method: 'POST',
    body: {
      tenant_id: DEFAULT_TENANT_ID,
      member_id: await memberId(),
      doctor_id: params.doctorId,
      doctor_name: params.doctorName,
      patient_name: params.patientName,
      appointment_reason: params.appointmentReason ?? null,
    },
  })
}

export async function sendCallTurn(sessionId: string, patientInput: string): Promise<CallSession> {
  return request(`/calls/${sessionId}/turn`, {
    method: 'POST',
    body: { patient_input: patientInput, tenant_id: DEFAULT_TENANT_ID, member_id: await memberId() },
  })
}

export async function endCall(sessionId: string): Promise<void> {
  await request(`/calls/${sessionId}/end`, {
    method: 'POST',
    query: { tenant_id: DEFAULT_TENANT_ID, member_id: await memberId() },
  }).catch(() => {})
}
