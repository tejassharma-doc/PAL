# 📊 Records Section - Complete Database Schema

## ✅ All Required Tables

### 1. **appointments** ✅
**Purpose**: Store patient visit history

```sql
Table "public.appointments"
      Column      |           Type           | Nullable | Default
------------------+--------------------------+----------+---------
 id               | uuid                     | not null | gen_random_uuid()
 clinic_id        | uuid                     |          |
 patient_id       | uuid                     |          |
 doctor_id        | uuid                     |          |
 slot_time        | timestamptz              | not null |
 duration_minutes | integer                  |          | 30
 type             | varchar(50)              |          |
 status           | varchar(50)              |          | 'scheduled'
 reason_for_visit | text                     |          |
 notes            | text                     |          |
 intake           | jsonb                    |          |
 created_at       | timestamptz              |          | now()
 updated_at       | timestamptz              |          | now()
```

**Indexes**:
- Primary key: `id`
- Foreign keys: `clinic_id` → clinics, `patient_id` → patients
- Indexed: `clinic_id`, `doctor_id`, `patient_id`, `slot_time`, `status`

**Sample Data**:
```sql
INSERT INTO appointments (patient_id, slot_time, status, reason_for_visit, notes, type)
VALUES (
    '4a6ebef6-0e47-42f9-94f4-e907c8ed845d',
    '2026-07-10 14:00:00+05:30',
    'completed',
    'Fever and cough',
    'Prescribed antibiotics for upper respiratory infection',
    'consultation'
);
```

---

### 2. **lab_tests** ✅
**Purpose**: Store lab test results and history

```sql
Table "public.lab_tests"
        Column         |       Type        | Nullable | Default
-----------------------+-------------------+----------+---------
 id                    | uuid              | not null |
 patient_id            | uuid              | not null |
 appointment_id        | uuid              |          |
 document_id           | uuid              |          |
 test_name             | varchar(255)      | not null |
 test_category         | varchar(100)      |          |
 test_type             | varchar(100)      |          |
 ordered_date          | date              | not null |
 sample_collected_date | date              |          |
 result_date           | date              |          |
 status                | varchar(50)       | not null | 'ordered'
 results               | jsonb             |          |
 reference_range       | text              |          |
 abnormal_flag         | boolean           | not null | false
 interpretation        | text              |          |
 ordered_by            | varchar(255)      |          |
 lab_name              | varchar(255)      |          |
 lab_location          | varchar(255)      |          |
 notes                 | text              |          |
 created_at            | timestamptz       | not null | now()
 updated_at            | timestamptz       | not null | now()
```

**Indexes**:
- Primary key: `id`
- Foreign keys: `patient_id` → patients, `appointment_id` → appointments, `document_id` → patient_documents
- Indexed: `patient_id`, `appointment_id`, `ordered_date`, `abnormal_flag`

**Sample Data**:
```sql
INSERT INTO lab_tests (
    patient_id, test_name, test_category, ordered_date, result_date, 
    status, results, abnormal_flag, interpretation, ordered_by, lab_name
) VALUES (
    '4a6ebef6-0e47-42f9-94f4-e907c8ed845d',
    'Lipid Panel',
    'blood',
    '2026-07-01',
    '2026-07-03',
    'completed',
    '{"ldl": {"value": 162, "unit": "mg/dL", "range": "<100", "abnormal": true}, 
      "hdl": {"value": 45, "unit": "mg/dL", "range": ">40"}}'::jsonb,
    true,
    'Elevated LDL cholesterol - lifestyle modification recommended',
    'Dr. Rao',
    'City Lab'
);
```

---

### 3. **prescriptions** ✅ (UPDATED)
**Purpose**: Store medication prescriptions

```sql
Table "public.prescriptions"
          Column          |     Type      | Nullable | Default
--------------------------+---------------+----------+---------
 id                       | uuid          | not null | gen_random_uuid()
 patient_id               | uuid          |          |  ← NEW COLUMN ADDED
 consultation_id          | uuid          |          |
 items                    | jsonb         |          | '[]'
 interaction_acknowledged | boolean       |          | false
 refillable               | boolean       |          | false
 refills_remaining        | integer       |          | 0
 pdf_url                  | text          |          |
 shared_at                | timestamptz   |          |
 created_at               | timestamptz   |          | now()
 updated_at               | timestamptz   |          | now()
```

**Indexes**:
- Primary key: `id`
- Indexed: `consultation_id`, `patient_id` ← NEW

**Items JSONB Structure**:
```json
[
  {
    "name": "Amoxicillin",
    "dosage": "500mg",
    "frequency": "3 times daily",
    "duration": "7 days",
    "instructions": "Take with food"
  }
]
```

**Sample Data**:
```sql
INSERT INTO prescriptions (patient_id, items, pdf_url)
VALUES (
    '4a6ebef6-0e47-42f9-94f4-e907c8ed845d',
    '[
      {"name": "Amoxicillin", "dosage": "500mg", "frequency": "3x daily", "duration": "7 days"},
      {"name": "Paracetamol", "dosage": "500mg", "frequency": "as needed", "duration": "5 days"}
    ]'::jsonb,
    'https://example.com/prescriptions/rx_001.pdf'
);
```

---

### 4. **patient_documents** ✅
**Purpose**: Store uploaded documents (PDFs, images, reports)

```sql
Table "public.patient_documents"
     Column     |       Type        | Nullable | Default
----------------+-------------------+----------+---------
 id             | uuid              | not null | gen_random_uuid()
 clinic_id      | uuid              |          |
 patient_id     | uuid              |          |
 kind           | varchar(50)       |          |
 title          | varchar(255)      |          |
 file_name      | varchar(500)      |          |
 mime_type      | varchar(100)      |          |
 size_bytes     | bigint            |          |
 data_url       | text              |          |
 uploaded_by_id | uuid              |          |
 created_at     | timestamptz       |          | now()
```

**Indexes**:
- Primary key: `id`
- Foreign keys: `clinic_id` → clinics, `patient_id` → patients
- Indexed: `clinic_id`, `patient_id`, `kind`

**Document Kinds**:
- `lab_report` - Lab test results
- `prescription` - Prescription documents
- `radiology` - X-rays, MRIs, CT scans
- `discharge_summary` - Hospital discharge papers
- `consent_form` - Patient consent forms
- `insurance` - Insurance documents
- `other` - Miscellaneous

**Sample Data**:
```sql
INSERT INTO patient_documents (patient_id, kind, title, file_name, mime_type, size_bytes, data_url)
VALUES (
    '4a6ebef6-0e47-42f9-94f4-e907c8ed845d',
    'lab_report',
    'Lipid Panel Results',
    'lipid_panel_2026_07_03.pdf',
    'application/pdf',
    245678,
    'https://example.com/reports/lipid_panel.pdf'
);
```

---

## 🔗 Table Relationships

```
patients (1) ──< (N) appointments
patients (1) ──< (N) lab_tests
patients (1) ──< (N) prescriptions      ← NEWLY LINKED
patients (1) ──< (N) patient_documents

appointments (1) ──< (N) lab_tests
patient_documents (1) ──< (N) lab_tests
```

---

## 📊 Current Data Count

```sql
SELECT 
    (SELECT COUNT(*) FROM appointments WHERE patient_id = '4a6ebef6-0e47-42f9-94f4-e907c8ed845d') as appointments,
    (SELECT COUNT(*) FROM lab_tests WHERE patient_id = '4a6ebef6-0e47-42f9-94f4-e907c8ed845d') as lab_tests,
    (SELECT COUNT(*) FROM prescriptions WHERE patient_id = '4a6ebef6-0e47-42f9-94f4-e907c8ed845d') as prescriptions,
    (SELECT COUNT(*) FROM patient_documents WHERE patient_id = '4a6ebef6-0e47-42f9-94f4-e907c8ed845d') as documents;
```

**Current Status**:
- ✅ 2 appointments
- ✅ 1 lab test
- ✅ 1 prescription
- ✅ 1 document

---

## 🛠️ Schema Changes Made

### ✅ Added `patient_id` to prescriptions
```sql
ALTER TABLE prescriptions ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
CREATE INDEX idx_prescriptions_patient_id ON prescriptions(patient_id);
```

**Why**: Prescriptions need direct link to patients for efficient querying in Records API

---

## 🎯 API Endpoint

**GET** `/records/patient/{patient_id}`

**Returns**:
```json
{
  "appointments": [...],
  "lab_tests": [...],
  "prescriptions": [...],
  "documents": [...]
}
```

**File**: `api/routers/records.py`

---

## ✅ Complete Database Setup

All tables are ready:
1. ✅ **appointments** - Visit history
2. ✅ **lab_tests** - Lab results
3. ✅ **prescriptions** - Medications (with patient_id added)
4. ✅ **patient_documents** - File uploads

All foreign key relationships established.
Sample data inserted for testing.
API endpoint ready and tested.

🎉 **Records section database is complete!**
