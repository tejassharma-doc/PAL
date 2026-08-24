-- Add webhook-related fields to appointments table
-- Migration: add_appointment_webhook_fields
-- Date: 2026-08-05

-- Add external appointment ID for webhook deduplication
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS external_appointment_id VARCHAR(255);

-- Add unique index for external appointment ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_external_id
ON appointments(external_appointment_id)
WHERE external_appointment_id IS NOT NULL;

-- Add appointment_date field (separate from slot_time)
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS appointment_date TIMESTAMPTZ;

-- Add doctor and clinic info from webhooks
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS doctor_name VARCHAR(255);

ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS clinic_name VARCHAR(255);

-- Add chief_complaint field (different from reason_for_visit)
ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS chief_complaint TEXT;

-- Make slot_time nullable (webhooks may not have exact slot times)
ALTER TABLE appointments
ALTER COLUMN slot_time DROP NOT NULL;

-- Add comment
COMMENT ON COLUMN appointments.external_appointment_id IS 'External appointment ID from webhook source (for deduplication)';
COMMENT ON COLUMN appointments.appointment_date IS 'Appointment date from webhook (may differ from slot_time)';
COMMENT ON COLUMN appointments.doctor_name IS 'Doctor name from webhook';
COMMENT ON COLUMN appointments.clinic_name IS 'Clinic name from webhook';
COMMENT ON COLUMN appointments.chief_complaint IS 'Chief complaint from webhook';

-- Verify changes
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'appointments'
ORDER BY ordinal_position;
