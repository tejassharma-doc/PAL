-- Handwritten-document extraction pipeline (Gemini Flash → MDT).
-- Manual DDL — apply by hand (no Alembic). Safe to re-run (IF NOT EXISTS).
--
--   docker exec -i pal-prod-db psql -U pal -d pal < add_handwriting_extraction.sql
-- or paste the statements into psql.

-- 1) Provenance columns on lab_tests ------------------------------------------
ALTER TABLE lab_tests
  ADD COLUMN IF NOT EXISTS extraction_method   VARCHAR(32)  DEFAULT 'mdt_direct',
  ADD COLUMN IF NOT EXISTS source_modality     VARCHAR(16)  DEFAULT 'printed',
  ADD COLUMN IF NOT EXISTS transcription_text  TEXT,
  ADD COLUMN IF NOT EXISTS transcription_model VARCHAR(64),
  ADD COLUMN IF NOT EXISTS needs_review        BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reviewed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_source_id       UUID;

-- 2) Extraction audit / provenance table --------------------------------------
-- No foreign keys: patient_id holds the phone_user id (matching the upload flow);
-- raw_source_id / lab_test_id are soft references.
CREATE TABLE IF NOT EXISTS document_extractions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID        NOT NULL,
    raw_source_id       UUID,
    lab_test_id         UUID,

    source_mime         VARCHAR(100),
    source_modality     VARCHAR(16),            -- printed | handwritten
    extraction_method   VARCHAR(32),            -- mdt_direct | flash_then_mdt | flash_only
    mdt_discarded       BOOLEAN DEFAULT FALSE,

    transcription_text  TEXT,
    transcription_model VARCHAR(64),
    transcription_conf  DOUBLE PRECISION,
    rendered_pdf_path   VARCHAR(512),

    fhir_bundle         JSONB,
    status              VARCHAR(24) DEFAULT 'extracted',  -- extracted | needs_review | confirmed | failed
    warnings            JSONB,
    error_message       TEXT,

    user_edits          JSONB,                  -- [{field, from, to}, ...]
    edited_by           UUID,
    edited_at           TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_extractions_patient_idx    ON document_extractions (patient_id);
CREATE INDEX IF NOT EXISTS document_extractions_raw_source_idx ON document_extractions (raw_source_id);
CREATE INDEX IF NOT EXISTS document_extractions_lab_test_idx   ON document_extractions (lab_test_id);
