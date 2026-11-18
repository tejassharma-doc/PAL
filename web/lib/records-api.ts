/**
 * Records + lab-tests REST client. House style matches lib/family-api.ts:
 *   - relative `/api/...` paths (proxied by app/api/[...proxy]/route.ts)
 *   - bearer from localStorage `pal_token`
 *   - list helpers soft-fail to []; single-fetch throws
 *
 * Promotes the previously-inline/untyped fetches in app/page.tsx (records bundle)
 * and app/lab-reports/page.tsx (lab list) into typed functions.
 */

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const token = localStorage.getItem('pal_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function patientId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('pal_patient_id')
}

export interface LabTest {
  id: string
  report_name: string
  test_category: string
  ordered_date: string
  result_date: string | null
  status: string
  results: Record<string, unknown> | null
  has_abnormal_values: boolean
  interpretation: string | null
  ordered_by: string | null
  lab_name: string | null
}

/** Loose shape of the /api/records/patient/{id} bundle (fields vary by backend). */
export interface RecordsBundle {
  lab_tests?: LabTest[]
  documents?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export async function getPatientLabTests(pid?: string): Promise<LabTest[]> {
  const id = pid || patientId()
  if (!id) return []
  try {
    const res = await fetch(`/api/lab-tests/patient/${id}`, { headers: authHeaders() })
    if (!res.ok) return []
    const data = await res.json()
    return (data.lab_tests || []) as LabTest[]
  } catch {
    return []
  }
}

export async function getLabTest(id: string, pid?: string): Promise<LabTest | null> {
  const tests = await getPatientLabTests(pid)
  return tests.find(t => t.id === id) || null
}

export async function getPatientRecords(pid?: string): Promise<RecordsBundle | null> {
  const id = pid || patientId()
  if (!id) return null
  try {
    const res = await fetch(`/api/records/patient/${id}`, { headers: authHeaders() })
    if (!res.ok) return null
    return (await res.json()) as RecordsBundle
  } catch {
    return null
  }
}
