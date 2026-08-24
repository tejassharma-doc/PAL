-- Remove foreign key constraint from lab_tests.patient_id
-- This allows storing phone_user_id directly without needing patients table

ALTER TABLE lab_tests DROP CONSTRAINT IF EXISTS lab_tests_patient_id_fkey;

-- Add comment to document the change
COMMENT ON COLUMN lab_tests.patient_id IS 'Stores phone_user_id directly (not a foreign key to patients table)';
