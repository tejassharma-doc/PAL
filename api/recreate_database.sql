-- Recreate database schema with new table structure
-- WARNING: This will DELETE all existing data

-- Drop existing tables if they exist (in correct order to avoid foreign key conflicts)
DROP TABLE IF EXISTS prescriptions CASCADE;
DROP TABLE IF EXISTS clinical_outputs CASCADE;
DROP TABLE IF EXISTS patient_documents CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS patients CASCADE;
DROP TABLE IF EXISTS clinics CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CLINICS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE clinics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    subscription_tier VARCHAR(50),
    address TEXT,
    phone VARCHAR(30),
    email VARCHAR(320),
    gstin VARCHAR(50),
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    code VARCHAR(50) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_clinics_code ON clinics(code);
CREATE INDEX idx_clinics_is_active ON clinics(is_active);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. PATIENTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    mrn VARCHAR(100),
    abha_id VARCHAR(100) UNIQUE,
    abha_address VARCHAR(255),
    full_name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    phone VARCHAR(30),
    email VARCHAR(320),
    blood_group VARCHAR(10),
    address TEXT,
    allergies TEXT,
    chronic_conditions TEXT,
    current_medications TEXT,
    emergency_contact JSONB,
    photo_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_patients_clinic_id ON patients(clinic_id);
CREATE INDEX idx_patients_mrn ON patients(mrn);
CREATE INDEX idx_patients_abha_id ON patients(abha_id);
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_email ON patients(email);
CREATE INDEX idx_patients_is_active ON patients(is_active);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. APPOINTMENTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id UUID,
    slot_time TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    type VARCHAR(50),
    status VARCHAR(50) DEFAULT 'scheduled',
    reason_for_visit TEXT,
    notes TEXT,
    intake JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_appointments_clinic_id ON appointments(clinic_id);
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor_id ON appointments(doctor_id);
CREATE INDEX idx_appointments_slot_time ON appointments(slot_time);
CREATE INDEX idx_appointments_status ON appointments(status);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. CLINICAL_OUTPUTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE clinical_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID,
    soap_note TEXT,
    icd_codes JSONB DEFAULT '[]',
    snomed_codes JSONB DEFAULT '[]',
    management_plan TEXT,
    patient_summary TEXT,
    interactions JSONB,
    raw_api_response JSONB,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_clinical_outputs_consultation_id ON clinical_outputs(consultation_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. PATIENT_DOCUMENTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE patient_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    kind VARCHAR(50),
    title VARCHAR(255),
    file_name VARCHAR(500),
    mime_type VARCHAR(100),
    size_bytes BIGINT,
    data_url TEXT,
    uploaded_by_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_patient_documents_clinic_id ON patient_documents(clinic_id);
CREATE INDEX idx_patient_documents_patient_id ON patient_documents(patient_id);
CREATE INDEX idx_patient_documents_kind ON patient_documents(kind);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. PRESCRIPTIONS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID,
    items JSONB DEFAULT '[]',
    interaction_acknowledged BOOLEAN DEFAULT FALSE,
    refillable BOOLEAN DEFAULT FALSE,
    refills_remaining INTEGER DEFAULT 0,
    pdf_url TEXT,
    shared_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prescriptions_consultation_id ON prescriptions(consultation_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════

-- List all tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Show table row counts
SELECT
    'clinics' as table_name, COUNT(*) as row_count FROM clinics
UNION ALL SELECT 'patients', COUNT(*) FROM patients
UNION ALL SELECT 'appointments', COUNT(*) FROM appointments
UNION ALL SELECT 'clinical_outputs', COUNT(*) FROM clinical_outputs
UNION ALL SELECT 'patient_documents', COUNT(*) FROM patient_documents
UNION ALL SELECT 'prescriptions', COUNT(*) FROM prescriptions;
