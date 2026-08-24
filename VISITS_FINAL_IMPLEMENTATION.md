# 🏥 Visits Section - Final Database-Driven Implementation

## ✅ Complete Flow: Database → FastAPI → Frontend

---

## 📊 **Database Structure**

### **Appointments Table**
```sql
appointments
├─ id (uuid)
├─ patient_id (uuid) → patients.id
├─ doctor_id (uuid) -- stored but no doctors table yet
├─ slot_time (timestamptz)
├─ reason_for_visit (text)
├─ status (varchar)
└─ notes (text)
```

### **Clinical Outputs Table**
```sql
clinical_outputs
├─ id (uuid)
├─ consultation_id (uuid) → appointments.id
├─ soap_note (text) -- S.O.A.P format clinical notes
├─ management_plan (text)
├─ patient_summary (text)
└─ processed_at (timestamptz)
```

### **Lab Tests Table**
```sql
lab_tests
├─ id (uuid)
├─ patient_id (uuid) → patients.id
├─ appointment_id (uuid) → appointments.id
├─ test_name (varchar)
├─ result_date (date)
├─ abnormal_flag (boolean)
├─ interpretation (text)
└─ results (jsonb)
```

---

## 🔗 **Data Relationships**

```
appointments (1) ──< (1) clinical_outputs
    via: clinical_outputs.consultation_id = appointments.id

appointments (1) ──< (N) lab_tests
    via: lab_tests.appointment_id = appointments.id
```

---

## 🚀 **Backend API**

### **Endpoint**
```
GET /visits/patient/{patient_id}
```

### **File**: `api/routers/visits.py`

### **What It Does**:
1. Fetches all appointments for patient
2. Joins with clinical_outputs via `consultation_id`
3. Joins with lab_tests via `appointment_id`
4. Returns structured JSON with:
   - Appointment details (doctor_id, reason, date, status)
   - SOAP notes from clinical_outputs
   - Management plan from clinical_outputs
   - Patient summary from clinical_outputs
   - Lab test results with abnormal flags

### **Response Structure**:
```json
{
  "upcoming": [],
  "past": [
    {
      "id": "293c4606-9a94-4cb7-8505-3c44b6d5186a",
      "doctor_id": null,
      "date": "10 Jul 2026",
      "reason": "Fever and cough",
      "status": "completed",
      "soap_note": "S: Patient reports fever (101°F)...\nO: Temperature 101.2°F...\nA: Upper respiratory infection...\nP: Prescribed Amoxicillin...",
      "management_plan": "Lower LDL toward <100 mg/dL over 12 weeks...",
      "patient_summary": "Patient with elevated LDL cholesterol...",
      "lab_tests": [
        {
          "id": "...",
          "test_name": "Lipid Panel",
          "result_date": "2026-07-03",
          "abnormal_flag": true,
          "interpretation": "Elevated LDL cholesterol"
        }
      ]
    }
  ]
}
```

---

## 🎨 **Frontend Implementation**

### **File**: `web/app/visits/page.tsx`

### **What It Does**:
1. Fetches visits from `/visits/patient/{patient_id}` on page load
2. Separates into `upcomingVisits` and `pastVisits` arrays
3. Displays expandable cards for each visit

### **Card Structure**:

#### **Collapsed State**:
```
┌─────────────────────────────────────┐
│  D   Doctor 1          10 Jul       │
│      Fever and cough    2026        │
│  ──────────────────────────────────│
│  ⛁ Fever and cough      open →     │
└─────────────────────────────────────┘
```

#### **Expanded State** (onClick):
```
┌─────────────────────────────────────┐
│  D   Doctor 1          10 Jul       │
│      Fever and cough    2026        │
│  ──────────────────────────────────│
│  ⛁ Fever and cough     close ↑     │
│  ───────────────────────────────────│
│  SUMMARY                             │
│  ┌─────────────────────────────────┐│
│  │ Patient with elevated LDL...    ││
│  │ Started on Atorvastatin 20mg... ││
│  └─────────────────────────────────┘│
│                                      │
│  CLINICAL NOTES (SOAP)               │
│  S: Patient reports fever (101°F)    │
│     and dry cough for 3 days.       │
│  O: Temperature 101.2°F, BP 128/82  │
│  A: Upper respiratory infection...   │
│  P: Prescribed Amoxicillin 500mg... │
│                                      │
│  MANAGEMENT PLAN                     │
│  ┌─────────────────────────────────┐│
│  │ Lower LDL toward <100 mg/dL     ││
│  │ over 12 weeks, keep BP in range ││
│  └─────────────────────────────────┘│
│                                      │
│  LAB TESTS                           │
│  ┌─────────────────────────────────┐│
│  │ Lipid Panel        ⚠️ abnormal  ││
│  │ Elevated LDL cholesterol         │
│  │                      2026-07-03 ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

---

## 📋 **Current Sample Data**

### **Visit 1**: 10 Jul 2026
- **Appointment ID**: 293c4606-9a94-4cb7-8505-3c44b6d5186a
- **Doctor ID**: NULL (displays as "Doctor 1")
- **Reason**: Fever and cough
- **Status**: completed
- **Has SOAP**: ✅ YES
- **Has Lab Tests**: ✅ 1 test (Lipid Panel - abnormal)

**Clinical Output**:
```
S: Patient reports fever (101°F) and dry cough for 3 days. No shortness of breath.
O: Temperature 101.2°F, BP 128/82, HR 88. Lung sounds clear bilaterally.
A: Upper respiratory tract infection, likely viral.
P: Prescribed Amoxicillin 500mg TID x 7 days, Paracetamol PRN for fever.
```

**Management Plan**: Lower LDL toward <100 mg/dL over 12 weeks, keep BP in range.

**Lab Test**: Lipid Panel (abnormal) - Elevated LDL cholesterol

---

### **Visit 2**: 15 Jun 2026
- **Appointment ID**: ce462777-b128-486d-a358-579f0e4477a2
- **Doctor ID**: NULL (displays as "Doctor 2")
- **Reason**: Routine checkup
- **Status**: completed
- **Has SOAP**: ❌ NO
- **Has Lab Tests**: ❌ 0 tests

*This visit won't show the expandable section since there's no clinical data*

---

## ✅ **Features Implemented**

### **Backend**:
- ✅ Uses ONLY database fields (no hardcoded data)
- ✅ Fetches appointments by patient_id
- ✅ Joins clinical_outputs via consultation_id = appointment.id
- ✅ Joins lab_tests via appointment_id = appointment.id
- ✅ Returns doctor_id (not doctor_name)
- ✅ Returns SOAP notes from clinical_outputs
- ✅ Returns management_plan from clinical_outputs
- ✅ Returns patient_summary from clinical_outputs
- ✅ Returns lab tests with abnormal flags

### **Frontend**:
- ✅ Fetches from `/visits/patient/{patient_id}`
- ✅ Displays doctor_id (as "Dr. [first 8 chars]" or "Doctor N")
- ✅ Shows reason_for_visit as main text
- ✅ Click to expand/collapse full details
- ✅ Shows patient summary in green box
- ✅ Shows SOAP notes with proper formatting (preserves S.O.A.P structure)
- ✅ Shows management plan in blue box
- ✅ Shows lab tests with red border if abnormal
- ✅ Only shows expand option if clinical data exists

---

## 🎯 **How to Use**

1. **Open browser**: http://localhost:3000 or http://localhost:3001
2. **Login** with your patient account
3. **Go to Visits tab** (calendar icon)
4. **Scroll to "Care plans" section**
5. **Click on a visit card** to expand
6. **View**:
   - Patient Summary
   - Clinical Notes (SOAP)
   - Management Plan
   - Lab Tests (if any)

---

## 📊 **Database Query to Verify**

```sql
SELECT 
    a.id,
    a.doctor_id,
    a.reason_for_visit,
    a.slot_time,
    CASE WHEN co.id IS NOT NULL THEN 'HAS SOAP' ELSE 'NO SOAP' END as soap_status,
    (SELECT COUNT(*) FROM lab_tests WHERE appointment_id = a.id) as lab_count
FROM appointments a
LEFT JOIN clinical_outputs co ON co.consultation_id = a.id
WHERE a.patient_id = '4a6ebef6-0e47-42f9-94f4-e907c8ed845d';
```

**Result**:
```
appointment_id | doctor_id | reason_for_visit | slot_time  | soap_status | lab_count
─────────────────────────────────────────────────────────────────────────────────────
293c4606...    | NULL      | Fever and cough  | 2026-07-10 | HAS SOAP    | 1
ce462777...    | NULL      | Routine checkup  | 2026-06-15 | NO SOAP     | 0
```

---

## 🔮 **What's NOT Hardcoded**

- ❌ No doctor names (uses doctor_id from database)
- ❌ No specialty (removed from response)
- ❌ No care_plan_name (removed from response)
- ✅ **Everything comes from database**:
  - appointments.doctor_id
  - appointments.reason_for_visit
  - appointments.slot_time
  - appointments.status
  - clinical_outputs.soap_note
  - clinical_outputs.management_plan
  - clinical_outputs.patient_summary
  - lab_tests.*

---

## ✅ **Final Summary**

The Visits section is now **100% database-driven**:

1. **Backend** fetches real data from 3 tables
2. **API** returns structured JSON with no hardcoded values
3. **Frontend** displays only what comes from the database
4. **SOAP notes** are properly formatted and displayed
5. **Lab tests** are linked to appointments and shown with abnormal flags
6. **No frontend-only mock data**

Refresh your browser to see the **real medical visit history** from the database! 🎉
