# ✅ Visits Section - Final Database Structure

## 📊 **Database Tables & Relationships**

---

## **Table Structure**

### 1. **APPOINTMENTS** (Main table)
```sql
appointments
├─ id (uuid) PRIMARY KEY
├─ patient_id (uuid) → patients.id
├─ doctor_id (uuid) -- ⚠️ No doctors table exists!
├─ slot_time (timestamptz)
├─ reason_for_visit (text)
├─ status (varchar)
└─ notes (text)
```

### 2. **CLINICAL_OUTPUTS** (SOAP notes & plans)
```sql
clinical_outputs
├─ id (uuid) PRIMARY KEY
├─ consultation_id (uuid) -- Legacy field
├─ appointment_id (uuid) → appointments.id ✅ NEW!
├─ soap_note (text)
├─ management_plan (text)
└─ patient_summary (text)
```

### 3. **LAB_TESTS** (Lab results)
```sql
lab_tests
├─ id (uuid) PRIMARY KEY
├─ patient_id (uuid) → patients.id
├─ appointment_id (uuid) → appointments.id
├─ test_name (varchar)
├─ result_date (date)
├─ abnormal_flag (boolean)
└─ interpretation (text)
```

---

## 🔗 **Correct Relationships**

```
appointments (id)
    │
    ├─→ clinical_outputs (appointment_id) ✅ CORRECT LINK
    │       ├─ soap_note
    │       ├─ management_plan
    │       └─ patient_summary
    │
    └─→ lab_tests (appointment_id) ✅ CORRECT LINK
            ├─ test_name
            ├─ abnormal_flag
            └─ interpretation
```

**OLD (Incorrect)**:
```
❌ clinical_outputs.consultation_id → appointments.id
```

**NEW (Correct)**:
```
✅ clinical_outputs.appointment_id → appointments.id
```

---

## 📋 **Current Data Verification**

```sql
SELECT 
    a.id as appointment_id,
    a.reason_for_visit,
    co.appointment_id as co_appt_link,
    lt.appointment_id as lt_appt_link
FROM appointments a
LEFT JOIN clinical_outputs co ON co.appointment_id = a.id
LEFT JOIN lab_tests lt ON lt.appointment_id = a.id
WHERE a.patient_id = '4a6ebef6-0e47-42f9-94f4-e907c8ed845d';
```

**Result**:
```
appointment_id                       | reason_for_visit | co_appt_link                         | lt_appt_link
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
293c4606-9a94-4cb7-8505-3c44b6d5186a | Fever and cough  | 293c4606-9a94-4cb7-8505-3c44b6d5186a | 293c4606-9a94-4cb7-8505-3c44b6d5186a
ce462777-b128-486d-a358-579f0e4477a2 | Routine checkup  | NULL                                 | NULL
```

✅ **Both tables now correctly link via `appointment_id`!**

---

## 🔄 **Database Changes Made**

### **1. Added Column**:
```sql
ALTER TABLE clinical_outputs 
ADD COLUMN appointment_id UUID 
REFERENCES appointments(id) ON DELETE CASCADE;
```

### **2. Created Index**:
```sql
CREATE INDEX idx_clinical_outputs_appointment_id 
ON clinical_outputs(appointment_id);
```

### **3. Migrated Data**:
```sql
UPDATE clinical_outputs 
SET appointment_id = consultation_id 
WHERE appointment_id IS NULL;
```

---

## 🚀 **Backend API Changes**

### **File**: `api/routers/visits.py`

**OLD**:
```python
clinical_output_result = await db.execute(
    select(ClinicalOutput)
    .where(ClinicalOutput.consultation_id == appt.id)
)
```

**NEW**:
```python
clinical_output_result = await db.execute(
    select(ClinicalOutput)
    .where(ClinicalOutput.appointment_id == appt.id)
)
```

### **File**: `api/models/clinical_output.py`

**Added**:
```python
appointment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
    ForeignKey("appointments.id", ondelete="CASCADE")
)
```

---

## ✅ **Summary**

### **What Changed**:
1. ✅ Added `appointment_id` to `clinical_outputs` table
2. ✅ Updated backend to use `appointment_id` instead of `consultation_id`
3. ✅ Created proper foreign key relationship
4. ✅ Migrated existing data to new column

### **Tables Used**:
1. **appointments** - Visit records (doctor_id, reason, date)
2. **clinical_outputs** - SOAP notes (via `appointment_id` ✅)
3. **lab_tests** - Lab results (via `appointment_id` ✅)

### **Both Link Correctly Now**:
```
appointments.id
    ├─→ clinical_outputs.appointment_id ✅
    └─→ lab_tests.appointment_id ✅
```

### **Legacy Field**:
- `consultation_id` still exists but is **not used** anymore
- Can be removed in future cleanup

---

## 🎯 **Final Join Query**

```sql
SELECT 
    a.id,
    a.doctor_id,
    a.reason_for_visit,
    a.slot_time,
    co.soap_note,
    co.management_plan,
    co.patient_summary,
    json_agg(
        json_build_object(
            'test_name', lt.test_name,
            'abnormal_flag', lt.abnormal_flag,
            'interpretation', lt.interpretation
        )
    ) as lab_tests
FROM appointments a
LEFT JOIN clinical_outputs co ON co.appointment_id = a.id
LEFT JOIN lab_tests lt ON lt.appointment_id = a.id
WHERE a.patient_id = '...'
GROUP BY a.id, co.id
ORDER BY a.slot_time DESC;
```

✅ **All tables now properly linked via `appointment_id`!**
