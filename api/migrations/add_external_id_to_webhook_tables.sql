-- Migration: Add external_id columns to webhook-related tables
-- This enables idempotent webhook processing by tracking external system IDs

-- Add external_id to consultations table
ALTER TABLE consultations
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_consultations_external_id
ON consultations(external_id);

-- Add external_id to clinical_outputs table
ALTER TABLE clinical_outputs
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_clinical_outputs_external_id
ON clinical_outputs(external_id);

-- Add external_id to prescriptions table
ALTER TABLE prescriptions
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_prescriptions_external_id
ON prescriptions(external_id);

-- Add external_id to patient_documents table
ALTER TABLE patient_documents
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_patient_documents_external_id
ON patient_documents(external_id);

-- Add external_id to patients table (for webhook deduplication)
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_patients_external_id
ON patients(external_id);

-- Add external_id to clinics table (for webhook deduplication)
ALTER TABLE clinics
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_clinics_external_id
ON clinics(external_id);

COMMENT ON COLUMN consultations.external_id IS 'External system ID for idempotent webhook processing';
COMMENT ON COLUMN clinical_outputs.external_id IS 'External system ID for idempotent webhook processing';
COMMENT ON COLUMN prescriptions.external_id IS 'External system ID for idempotent webhook processing';
COMMENT ON COLUMN patient_documents.external_id IS 'External system ID for idempotent webhook processing';
COMMENT ON COLUMN patients.external_id IS 'External system ID for idempotent webhook processing';
COMMENT ON COLUMN clinics.external_id IS 'External system ID for idempotent webhook processing';
