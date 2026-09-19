-- Add external_id fields to all tables for audit tracking
-- Migration: add_external_ids_for_audit
-- Date: 2026-08-05

-- Patients table (already has some external fields)
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_patients_external_id ON patients(external_id);

COMMENT ON COLUMN patients.external_id IS 'External system patient ID for audit and deduplication';

-- Clinics table
ALTER TABLE clinics
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_clinics_external_id ON clinics(external_id);

COMMENT ON COLUMN clinics.external_id IS 'External system clinic ID';

-- Consultations table
ALTER TABLE consultations
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_consultations_external_id ON consultations(external_id);

COMMENT ON COLUMN consultations.external_id IS 'External system consultation ID for audit';

-- Prescriptions table
ALTER TABLE prescriptions
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_prescriptions_external_id ON prescriptions(external_id);

COMMENT ON COLUMN prescriptions.external_id IS 'External system prescription ID';

-- Lab tests table
ALTER TABLE lab_tests
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_lab_tests_external_id ON lab_tests(external_id);

COMMENT ON COLUMN lab_tests.external_id IS 'External system document/lab test ID';

-- Phone users table - add external_id for doctor/user tracking
ALTER TABLE phone_users
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_phone_users_external_id ON phone_users(external_id);

COMMENT ON COLUMN phone_users.external_id IS 'External system user/doctor ID';

-- Verify changes
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE column_name = 'external_id'
AND table_schema = 'public'
ORDER BY table_name;
