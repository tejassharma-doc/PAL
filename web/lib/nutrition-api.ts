/**
 * Nutrition plan REST client (iNutriMon prescription).
 * House style matches lib/records-api.ts: relative `/api/...` paths (proxied),
 * bearer from localStorage `pal_token`, soft-fail to a no-plan shape.
 *
 * Backend: api/routers/nutrition.py — GET /nutrition/patient/{id}.
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

export interface NutritionMenuItem {
  feed_time: string | null
  recipe_id: string | null
  recipe_name: string | null
  servings: number | null
  energy_kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
  fibre_g: number | null
  sugar_g: number | null
}

export interface NutritionDayTotals {
  energy_kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
  fibre_g: number | null
  sugar_g: number | null
}

export interface NutritionDay {
  day_number: number | null
  day_label: string | null
  totals: NutritionDayTotals | null
  items: NutritionMenuItem[]
}

export interface NutritionGuidance { kind: string | null; text: string | null; source: string | null }
export interface NutritionInstruction { text: string | null; source: string | null }
export interface NutritionDiagnosis { code: string | null; description: string | null }
export interface NutritionLab {
  analyte: string | null
  display_name: string | null
  result: string | null
  numeric_value: number | null
  unit: string | null
  flag: string | null
  stale: boolean | null
  age_days: number | null
  collected_at: string | null
}
export interface NutritionCheckin { label: string | null; prompt: string | null; stream: string | null; frequency: string | null }

export interface NutritionPrescription {
  id: string
  status: string | null
  version: number | null
  is_current: boolean | null
  dietitian_name: string | null
  clinic_name: string | null
  issued_at: string | null
  goal: { label: string | null; direction: string | null; summary: string | null }
  diet_pattern: string | null
  cuisine: string | null
  cycle_days: number | null
  targets: { energy_kcal_min: number | null; energy_kcal_max: number | null; protein_g: number | null; carb_g: number | null; fat_g: number | null }
  anthropometry: { bmi: number | null; bmi_status: string | null; height_cm: number | null; weight_kg: number | null; ree_kcal: number | null }
  consultation_summary: string | null
  followup: unknown
  diagnoses: NutritionDiagnosis[]
  days: NutritionDay[]
  instructions: NutritionInstruction[]
  guidance: NutritionGuidance[]
  labs: NutritionLab[]
  checkins: NutritionCheckin[]
}

export interface NutritionResponse {
  has_plan: boolean
  prescription?: NutritionPrescription
}

export async function getPatientNutrition(pid?: string): Promise<NutritionResponse> {
  const id = pid || patientId()
  if (!id) return { has_plan: false }
  try {
    const res = await fetch(`/api/nutrition/patient/${id}`, { headers: authHeaders() })
    if (!res.ok) return { has_plan: false }
    return (await res.json()) as NutritionResponse
  } catch {
    return { has_plan: false }
  }
}
