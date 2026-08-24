# 🏥 Visits Section - Complete Implementation

## ✅ Backend Implementation

### **New API Endpoint**

**GET** `/visits/patient/{patient_id}`

Returns visits with clinical outputs and lab test results.

**File**: [api/routers/visits.py](api/routers/visits.py)

**Response Structure**:
```json
{
  "upcoming": [
    {
      "id": "uuid",
      "doctor_id": "uuid",
      "doctor_name": "Dr. Rao",
      "specialty": "Physician · OPD",
      "date": "10 Jul 2026",
      "reason": "Fever and cough",
      "status": "scheduled",
      "care_plan_name": "Cardiometabolic care plan",
      "soap_note": "S: Patient reports...\nO: Temperature...\nA: Upper respiratory...\nP: Prescribed...",
      "management_plan": "Lower LDL toward <100 mg/dL over 12 weeks, keep BP in range.",
      "patient_summary": "Patient with elevated LDL cholesterol (162 mg/dL)...",
      "lab_tests": [
        {
          "id": "uuid",
          "test_name": "Lipid Panel",
          "result_date": "2026-07-03",
          "abnormal_flag": true,
          "interpretation": "Elevated LDL cholesterol"
        }
      ]
    }
  ],
  "past": [...]
}
```

### **Database Tables Used**

1. **appointments** - Visit records
   - `patient_id`, `doctor_id`, `slot_time`, `reason_for_visit`, `status`, `notes`

2. **clinical_outputs** - SOAP notes and clinical data
   - `consultation_id` (links to appointment.id)
   - `soap_note`, `management_plan`, `patient_summary`

3. **lab_tests** - Lab test results linked to appointments
   - `appointment_id`, `test_name`, `result_date`, `abnormal_flag`, `interpretation`

---

## 🎨 Frontend Implementation

### **Visits Page Structure**

**File**: [web/app/visits/page.tsx](web/app/visits/page.tsx)

### **Features Implemented**

#### 1. **Care Plans Cards** (Collapsed View)
```
┌─────────────────────────────────────┐
│  R   Dr. Rao               12 May   │
│      Physician · OPD        2026    │
│  ──────────────────────────────────│
│  ⛁ Cardiometabolic care plan        │
│                          open →     │
└─────────────────────────────────────┘
```

#### 2. **Expanded View** (On Click)
```
┌─────────────────────────────────────┐
│  R   Dr. Rao               12 May   │
│      Physician · OPD        2026    │
│  ──────────────────────────────────│
│  ⛁ Cardiometabolic care plan        │
│                         close ↑     │
│  ───────────────────────────────────│
│  SUMMARY                             │
│  ┌─────────────────────────────────┐│
│  │ Patient with elevated LDL...    ││
│  └─────────────────────────────────┘│
│  CLINICAL NOTES (SOAP)               │
│  S: Patient reports fever...         │
│  O: Temperature 101.2°F...          │
│  A: Upper respiratory infection...   │
│  P: Prescribed Amoxicillin...       │
│                                      │
│  MANAGEMENT PLAN                     │
│  ┌─────────────────────────────────┐│
│  │ Lower LDL toward <100 mg/dL...  ││
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

### **Key UI Elements**

1. **Doctor Avatar**: Colored gradient circle with initial
2. **Date Display**: Right-aligned, `DD MMM YYYY` format
3. **Care Plan Badge**: `⛁ Care plan name` in jade green
4. **Expandable**: Click to toggle detailed view
5. **SOAP Notes**: Pre-formatted clinical notes
6. **Lab Tests**: Highlighted if abnormal (red border)

---

## 🔗 Data Flow

```
Database (appointments + clinical_outputs + lab_tests)
    ↓
FastAPI (/visits/patient/{patient_id})
    ↓
Frontend (getPatientVisits)
    ↓
Visits Page (expandable cards)
```

---

## 📊 Sample Data

### **Appointment**
```sql
INSERT INTO appointments (patient_id, slot_time, status, reason_for_visit, notes)
VALUES (
    '4a6ebef6-0e47-42f9-94f4-e907c8ed845d',
    '2026-07-10 14:00:00+05:30',
    'completed',
    'Fever and cough',
    'Patient prescribed antibiotics for upper respiratory infection'
);
```

### **Clinical Output**
```sql
INSERT INTO clinical_outputs (consultation_id, soap_note, management_plan, patient_summary)
VALUES (
    '<appointment_id>',
    'S: Patient reports fever (101°F) and dry cough for 3 days.
O: Temperature 101.2°F, BP 128/82, HR 88.
A: Upper respiratory tract infection, likely viral.
P: Prescribed Amoxicillin 500mg TID x 7 days.',
    'Lower LDL toward <100 mg/dL over 12 weeks, keep BP in range.',
    'Patient with elevated LDL cholesterol (162 mg/dL). Started on Atorvastatin 20mg daily.'
);
```

---

## ✅ Implementation Checklist

- ✅ Created `/visits/patient/{patient_id}` API endpoint
- ✅ Linked appointments → clinical_outputs → lab_tests
- ✅ Updated frontend to fetch from new API
- ✅ Implemented expandable card UI
- ✅ Display SOAP notes, management plan, patient summary
- ✅ Show lab tests with abnormal flags
- ✅ Inserted sample clinical data
- ✅ Separated upcoming vs past visits

---

## 🎯 Current Status

### **Working Features**:
- ✅ Backend API returns visits with clinical data
- ✅ Frontend displays care plan cards
- ✅ Click to expand shows full details
- ✅ SOAP notes formatted and readable
- ✅ Lab tests highlighted if abnormal
- ✅ Doctor info and date displayed

### **Placeholders** (No doctors table yet):
- Doctor name: Uses `doctor_id` or defaults to "Dr. Rao"
- Specialty: Hardcoded to "Physician · OPD"

---

## 🔮 Future Enhancements

1. **Add doctors table** - Store doctor names, specialties, photos
2. **Care plan names** - Extract from clinical outputs or separate table
3. **Upcoming appointments** - Full integration with booking system
4. **Document attachments** - Link prescriptions, reports to visits
5. **Edit/Add notes** - Allow patients to add their own notes

---

## 🚀 How to Use

1. **View visits**: Navigate to Visits tab (📋 icon)
2. **See care plans**: Scroll to "CARE PLANS" section
3. **Expand details**: Click any card to see full SOAP notes
4. **View lab results**: Lab tests appear at bottom of expanded view
5. **Close details**: Click again to collapse

The Visits section now shows **real medical visit history** from the database with proper clinical documentation! 🎉
