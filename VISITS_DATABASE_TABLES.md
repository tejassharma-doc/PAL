# 📊 Visits Section - Database Tables Used

## **3 Main Tables**

---

## 1️⃣ **APPOINTMENTS** (Primary Table)

### **Columns Used**:
```sql
appointments
├─ id               (uuid)           -- Primary key
├─ patient_id       (uuid)           -- Links to patients table
├─ doctor_id        (uuid)           -- ⚠️ NO doctors table exists yet!
├─ slot_time        (timestamptz)    -- Visit date/time
├─ reason_for_visit (text)           -- "Fever and cough", etc.
├─ status           (varchar)        -- "completed", "scheduled", etc.
└─ notes            (text)           -- Additional notes
```

### **What We Use**:
- ✅ `id` - Appointment identifier
- ✅ `patient_id` - To filter visits by patient
- ✅ `doctor_id` - Currently stored but **NO doctors table exists**
- ✅ `slot_time` - Display visit date
- ✅ `reason_for_visit` - Display as main card text
- ✅ `status` - Show if completed/scheduled

### **Current Data**:
```sql
SELECT id, doctor_id, reason_for_visit, slot_time, status
FROM appointments
WHERE patient_id = '4a6ebef6-0e47-42f9-94f4-e907c8ed845d';
```

**Result**:
```
id                                   | doctor_id | reason_for_visit | slot_time           | status
─────────────────────────────────────────────────────────────────────────────────────────────────────
293c4606-9a94-4cb7-8505-3c44b6d5186a | NULL      | Fever and cough  | 2026-07-10 08:30:00 | completed
ce462777-b128-486d-a358-579f0e4477a2 | NULL      | Routine checkup  | 2026-06-15 05:00:00 | completed
```

---

## 2️⃣ **CLINICAL_OUTPUTS** (Medical Documentation)

### **Columns Used**:
```sql
clinical_outputs
├─ id              (uuid)   -- Primary key
├─ consultation_id (uuid)   -- Links to appointments.id
├─ soap_note       (text)   -- S.O.A.P format clinical notes
├─ management_plan (text)   -- Treatment plan
└─ patient_summary (text)   -- Patient summary
```

### **How It Links**:
```sql
clinical_outputs.consultation_id = appointments.id
```

### **What We Use**:
- ✅ `consultation_id` - Join with appointments
- ✅ `soap_note` - Display in expanded card (S.O.A.P format)
- ✅ `management_plan` - Display in blue box
- ✅ `patient_summary` - Display in green box

### **Current Data**:
```sql
SELECT consultation_id, 
       LEFT(soap_note, 50) as soap_preview,
       LEFT(patient_summary, 50) as summary_preview
FROM clinical_outputs
WHERE consultation_id = '293c4606-9a94-4cb7-8505-3c44b6d5186a';
```

**Result**:
```
consultation_id                      | soap_preview                                       | summary_preview
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
293c4606-9a94-4cb7-8505-3c44b6d5186a | S: Patient reports fever (101°F) and dry cough... | Patient with elevated LDL cholesterol (162 mg...
```

---

## 3️⃣ **LAB_TESTS** (Lab Results)

### **Columns Used**:
```sql
lab_tests
├─ id              (uuid)     -- Primary key
├─ patient_id      (uuid)     -- Links to patients
├─ appointment_id  (uuid)     -- Links to appointments
├─ test_name       (varchar)  -- "Lipid Panel", etc.
├─ result_date     (date)     -- When results came
├─ abnormal_flag   (boolean)  -- Highlights in red if true
└─ interpretation  (text)     -- "Elevated LDL", etc.
```

### **How It Links**:
```sql
lab_tests.appointment_id = appointments.id
```

### **What We Use**:
- ✅ `appointment_id` - Join with appointments
- ✅ `test_name` - Display test name
- ✅ `result_date` - Show when results came
- ✅ `abnormal_flag` - Red border if true
- ✅ `interpretation` - Display explanation

### **Current Data**:
```sql
SELECT appointment_id, test_name, result_date, abnormal_flag, interpretation
FROM lab_tests
WHERE patient_id = '4a6ebef6-0e47-42f9-94f4-e907c8ed845d';
```

**Result**:
```
appointment_id                       | test_name   | result_date | abnormal_flag | interpretation
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
293c4606-9a94-4cb7-8505-3c44b6d5186a | Lipid Panel | 2026-07-03  | true          | Elevated LDL cholesterol
```

---

## 🔗 **Table Relationships**

```
patients (id)
    ↓
appointments (patient_id)
    ├─→ clinical_outputs (consultation_id → appointments.id)
    │       ├─ soap_note
    │       ├─ management_plan
    │       └─ patient_summary
    │
    └─→ lab_tests (appointment_id → appointments.id)
            ├─ test_name
            ├─ abnormal_flag
            └─ interpretation
```

---

## 🚨 **IMPORTANT: Doctor Information**

### **Current Status**:
```
appointments.doctor_id = uuid (stores doctor ID)
```

### **Problem**:
❌ **NO `doctors` table exists in the database!**

### **What Happens Now**:
- `doctor_id` is stored as UUID in appointments table
- Currently all `doctor_id` values are NULL
- Frontend displays as:
  - If `doctor_id` exists: `"Dr. [first 8 chars of UUID]"`
  - If `doctor_id` is NULL: `"Doctor 1"`, `"Doctor 2"`, etc.

### **To Add Doctor Names** (Future):
You need to create a `doctors` table:

```sql
CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    specialty VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Add foreign key to appointments
ALTER TABLE appointments 
ADD CONSTRAINT fk_appointments_doctor 
FOREIGN KEY (doctor_id) REFERENCES doctors(id);

-- Insert sample doctors
INSERT INTO doctors (id, name, specialty) VALUES
    (gen_random_uuid(), 'Dr. Rao', 'Physician · OPD'),
    (gen_random_uuid(), 'Sneha', 'Nutritionist · iNutriMon');

-- Update appointments with doctor references
UPDATE appointments SET doctor_id = (SELECT id FROM doctors WHERE name = 'Dr. Rao' LIMIT 1)
WHERE reason_for_visit = 'Fever and cough';
```

---

## 📋 **Complete SQL Join Query**

This is what the backend API does:

```sql
SELECT 
    a.id as appointment_id,
    a.doctor_id,
    a.slot_time,
    a.reason_for_visit,
    a.status,
    co.soap_note,
    co.management_plan,
    co.patient_summary,
    (
        SELECT json_agg(
            json_build_object(
                'id', lt.id,
                'test_name', lt.test_name,
                'result_date', lt.result_date,
                'abnormal_flag', lt.abnormal_flag,
                'interpretation', lt.interpretation
            )
        )
        FROM lab_tests lt
        WHERE lt.appointment_id = a.id
    ) as lab_tests
FROM appointments a
LEFT JOIN clinical_outputs co ON co.consultation_id = a.id
WHERE a.patient_id = '4a6ebef6-0e47-42f9-94f4-e907c8ed845d'
ORDER BY a.slot_time DESC;
```

---

## ✅ **Summary**

### **Tables Used**:
1. ✅ **appointments** - Visit records (doctor_id, reason, date, status)
2. ✅ **clinical_outputs** - SOAP notes, management plans, summaries
3. ✅ **lab_tests** - Lab results with abnormal flags

### **Tables NOT Used** (but referenced):
- ❌ **doctors** - Does NOT exist! `doctor_id` is just a UUID with no lookup table

### **Current Doctor Retrieval**:
```
appointments.doctor_id (UUID, currently NULL)
    ↓
No doctors table exists
    ↓
Frontend shows: "Doctor 1", "Doctor 2", etc.
```

### **To Show Real Doctor Names**:
You must:
1. Create `doctors` table
2. Insert doctor records
3. Update `appointments.doctor_id` to reference `doctors.id`
4. Update backend API to join with `doctors` table
5. Update frontend to display `doctor.name` instead of doctor_id

---

**Current Implementation**: ✅ Working, but doctor names are placeholders  
**Next Step**: Create doctors table for real doctor names
