-- Create consultations table
-- Migration: create_consultations_table
-- Date: 2026-08-05

CREATE TABLE IF NOT EXISTS consultations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign keys
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
    doctor_id UUID,

    -- Content
    note_text TEXT,
    voice_transcript TEXT,

    -- Status
    status VARCHAR(50) DEFAULT 'in_progress',

    -- Timestamps
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_consultations_appointment ON consultations(appointment_id);
CREATE INDEX idx_consultations_doctor ON consultations(doctor_id);
CREATE INDEX idx_consultations_status ON consultations(status);
CREATE INDEX idx_consultations_created ON consultations(created_at);

-- Add comments
COMMENT ON TABLE consultations IS 'Medical consultations linked to appointments';
COMMENT ON COLUMN consultations.appointment_id IS 'Reference to appointment';
COMMENT ON COLUMN consultations.doctor_id IS 'Doctor conducting the consultation';
COMMENT ON COLUMN consultations.note_text IS 'Consultation notes text';
COMMENT ON COLUMN consultations.voice_transcript IS 'Transcript of voice consultation';
COMMENT ON COLUMN consultations.status IS 'Status: in_progress, completed, cancelled';
COMMENT ON COLUMN consultations.finished_at IS 'When consultation was finished';

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_consultations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_consultations_updated_at
    BEFORE UPDATE ON consultations
    FOR EACH ROW
    EXECUTE FUNCTION update_consultations_updated_at();

-- Verify table structure
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'consultations'
ORDER BY ordinal_position;
