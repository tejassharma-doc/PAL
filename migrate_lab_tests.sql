-- Migrate lab_tests to report-based structure
-- Run with: docker exec pal-db-1 psql -U pal -d pal -f /path/to/migrate_lab_tests.sql

BEGIN;

-- Step 1: Add new columns
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS report_name VARCHAR(255);
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS report_type VARCHAR(100);
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS has_abnormal_values BOOLEAN DEFAULT false;
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS report_format VARCHAR(50);
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS file_name VARCHAR(512);
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS mime_type VARCHAR(128);
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS storage_path VARCHAR(512);
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS confidence_score FLOAT;
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS extraction_model VARCHAR(100);
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS extraction_version VARCHAR(50);
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS raw_extracted_json JSONB;
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS fhir_json JSONB;
ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS verified_date DATE;

-- Step 2: Migrate existing data
UPDATE lab_tests
SET
    report_name = test_name,
    report_type = COALESCE(test_category, 'Unknown'),
    has_abnormal_values = abnormal_flag,
    processing_status = 'completed',
    processed_at = created_at
WHERE report_name IS NULL;

-- Step 3: Drop old indexes
DROP INDEX IF EXISTS ix_lab_tests_test_name;
DROP INDEX IF EXISTS ix_lab_tests_abnormal_flag;

-- Step 4: Drop old columns
ALTER TABLE lab_tests DROP COLUMN IF EXISTS test_name;
ALTER TABLE lab_tests DROP COLUMN IF EXISTS reference_range;
ALTER TABLE lab_tests DROP COLUMN IF EXISTS abnormal_flag;

-- Step 5: Make report_name NOT NULL
ALTER TABLE lab_tests ALTER COLUMN report_name SET NOT NULL;

-- Step 6: Create new indexes
CREATE INDEX IF NOT EXISTS idx_lab_tests_report_name ON lab_tests(report_name);
CREATE INDEX IF NOT EXISTS idx_lab_tests_report_type ON lab_tests(report_type);
CREATE INDEX IF NOT EXISTS idx_lab_tests_has_abnormal ON lab_tests(has_abnormal_values);
CREATE INDEX IF NOT EXISTS idx_lab_tests_processing_status ON lab_tests(processing_status);
CREATE INDEX IF NOT EXISTS idx_lab_tests_report_format ON lab_tests(report_format);

COMMIT;

-- Verify migration
SELECT
    id,
    report_name,
    report_type,
    has_abnormal_values,
    processing_status
FROM lab_tests
LIMIT 5;
