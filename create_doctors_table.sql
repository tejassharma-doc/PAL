-- Create doctors table
-- Migration: create_doctors_table
-- Date: 2026-08-05

CREATE TABLE IF NOT EXISTS doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- External ID from source system
    external_id VARCHAR(255) UNIQUE,

    -- Doctor information
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(320),
    phone VARCHAR(30),

    -- Additional fields
    specialization VARCHAR(255),
    license_number VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_doctors_external_id ON doctors(external_id);
CREATE INDEX IF NOT EXISTS idx_doctors_email ON doctors(email);
CREATE INDEX IF NOT EXISTS idx_doctors_phone ON doctors(phone);
CREATE INDEX IF NOT EXISTS idx_doctors_active ON doctors(is_active);

-- Add comments
COMMENT ON TABLE doctors IS 'Doctor profiles from external systems';
COMMENT ON COLUMN doctors.external_id IS 'External system doctor ID for deduplication';
COMMENT ON COLUMN doctors.full_name IS 'Doctor full name';
COMMENT ON COLUMN doctors.email IS 'Doctor email address';
COMMENT ON COLUMN doctors.phone IS 'Doctor phone number';

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_doctors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_doctors_updated_at
    BEFORE UPDATE ON doctors
    FOR EACH ROW
    EXECUTE FUNCTION update_doctors_updated_at();

-- Verify table structure
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'doctors'
ORDER BY ordinal_position;
