#!/usr/bin/env python3
"""
Create the iNutriMon nutrition-prescription tables.

Run this once (idempotent — safe to re-run) to create the relational tables that
store the `nutrition_prescription.published` webhook payload in a queryable shape,
alongside the raw `webhook_events` row.

Usage (inside the mcp container, which can reach the `db` service):
    docker compose -f docker-compose.prod.yml exec mcp-api python create_nutrition_tables.py

Or anywhere with DB access by setting DATABASE_URL:
    DATABASE_URL=postgresql://pal:PASS@HOST:5432/pal python create_nutrition_tables.py

Connection: uses DATABASE_URL if set, else builds it from the same POSTGRES_*
env vars the mcp-server uses (host defaults to the compose service name `db`).
"""
import asyncio
import os
import sys


def _dsn() -> str:
    url = os.getenv("DATABASE_URL")
    if url:
        # asyncpg wants a plain postgresql:// DSN, not postgresql+asyncpg://
        return url.replace("postgresql+asyncpg://", "postgresql://")
    user = os.getenv("POSTGRES_USER", "pal")
    password = os.getenv("POSTGRES_PASSWORD", "change_me_in_prod")
    host = os.getenv("POSTGRES_HOST", "db")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "pal")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


# One prescription (handover) per published event; children cascade from it.
DDL = """
CREATE TABLE IF NOT EXISTS nutrition_prescriptions (
    id                   TEXT PRIMARY KEY,            -- handover.id (the published handover)
    event                TEXT,
    event_id             TEXT,
    prescription_id      TEXT,                        -- nutritionPrescription.id
    assessment_id        TEXT,
    version              INTEGER,
    status               TEXT,                        -- APPROVED, ...
    is_current           BOOLEAN,
    supersedes_id        TEXT,

    -- patient (as sent by iNutriMon; patient_phone is the join key to PAL)
    inutrimon_patient_id TEXT,
    patient_mrn          TEXT,
    patient_name         TEXT,
    patient_phone        TEXT,
    patient_dob          TIMESTAMPTZ,
    patient_gender       TEXT,
    pal_patient_id       UUID,                        -- resolved PAL patient, if matched (nullable)

    -- clinic / dietitian
    clinic_id            TEXT,
    clinic_name          TEXT,
    dietitian_id         TEXT,
    dietitian_name       TEXT,

    -- goal
    goal_label           TEXT,
    goal_direction       TEXT,
    goal_summary         TEXT,

    -- plan shape / targets / anthropometry
    diet_pattern         TEXT,
    cuisine              TEXT,
    cycle_days           INTEGER,
    energy_kcal_min      NUMERIC,
    energy_kcal_max      NUMERIC,
    protein_g            NUMERIC,
    carb_g               NUMERIC,
    fat_g                NUMERIC,
    bmi                  NUMERIC,
    bmi_status           TEXT,
    height_cm            NUMERIC,
    weight_kg            NUMERIC,
    ree_kcal             NUMERIC,

    -- consultation summary from the assessment capture (patient-facing)
    consultation_summary TEXT,
    followup             JSONB,                       -- escalateIf / reviewInDays
    diet_instructions    JSONB,                       -- instructions[] (kept whole for convenience)

    -- timestamps
    approved_at          TIMESTAMPTZ,
    published_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ,                 -- prescription createdAt
    updated_at           TIMESTAMPTZ,
    received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when PAL ingested it

    raw_payload          JSONB                        -- full webhook payload (source of truth)
);
CREATE INDEX IF NOT EXISTS ix_nutri_presc_phone   ON nutrition_prescriptions (patient_phone);
CREATE INDEX IF NOT EXISTS ix_nutri_presc_palpid  ON nutrition_prescriptions (pal_patient_id);
CREATE INDEX IF NOT EXISTS ix_nutri_presc_current ON nutrition_prescriptions (patient_phone, is_current);

CREATE TABLE IF NOT EXISTS nutrition_diagnoses (
    id              BIGSERIAL PRIMARY KEY,
    prescription_id TEXT NOT NULL REFERENCES nutrition_prescriptions(id) ON DELETE CASCADE,
    code            TEXT,
    description     TEXT
);
CREATE INDEX IF NOT EXISTS ix_nutri_diag_presc ON nutrition_diagnoses (prescription_id);

CREATE TABLE IF NOT EXISTS nutrition_menu_items (
    id              BIGSERIAL PRIMARY KEY,
    prescription_id TEXT NOT NULL REFERENCES nutrition_prescriptions(id) ON DELETE CASCADE,
    day_number      INTEGER,
    day_label       TEXT,
    feed_time       TEXT,        -- EM / BF / MM / L / T / ME ...
    recipe_id       TEXT,
    recipe_name     TEXT,
    servings        NUMERIC,
    energy_kcal     NUMERIC,
    protein_g       NUMERIC,
    carb_g          NUMERIC,
    fat_g           NUMERIC,
    fibre_g         NUMERIC,
    sugar_g         NUMERIC,
    nutrients       JSONB        -- full per-item nutrient block
);
CREATE INDEX IF NOT EXISTS ix_nutri_menu_presc     ON nutrition_menu_items (prescription_id);
CREATE INDEX IF NOT EXISTS ix_nutri_menu_presc_day ON nutrition_menu_items (prescription_id, day_number);

CREATE TABLE IF NOT EXISTS nutrition_day_totals (
    id              BIGSERIAL PRIMARY KEY,
    prescription_id TEXT NOT NULL REFERENCES nutrition_prescriptions(id) ON DELETE CASCADE,
    day_number      INTEGER,
    day_label       TEXT,
    energy_kcal     NUMERIC,
    protein_g       NUMERIC,
    carb_g          NUMERIC,
    fat_g           NUMERIC,
    fibre_g         NUMERIC,
    sugar_g         NUMERIC,
    totals          JSONB
);
CREATE INDEX IF NOT EXISTS ix_nutri_daytot_presc ON nutrition_day_totals (prescription_id);

CREATE TABLE IF NOT EXISTS nutrition_instructions (
    id              BIGSERIAL PRIMARY KEY,
    prescription_id TEXT NOT NULL REFERENCES nutrition_prescriptions(id) ON DELETE CASCADE,
    text            TEXT,
    source          TEXT
);
CREATE INDEX IF NOT EXISTS ix_nutri_instr_presc ON nutrition_instructions (prescription_id);

CREATE TABLE IF NOT EXISTS nutrition_guidance (
    id              BIGSERIAL PRIMARY KEY,
    prescription_id TEXT NOT NULL REFERENCES nutrition_prescriptions(id) ON DELETE CASCADE,
    kind            TEXT,        -- EAT / AVOID
    text            TEXT,
    source          TEXT
);
CREATE INDEX IF NOT EXISTS ix_nutri_guid_presc ON nutrition_guidance (prescription_id);

CREATE TABLE IF NOT EXISTS nutrition_labs (
    id              BIGSERIAL PRIMARY KEY,
    prescription_id TEXT NOT NULL REFERENCES nutrition_prescriptions(id) ON DELETE CASCADE,
    analyte         TEXT,
    display_name    TEXT,
    result          TEXT,
    numeric_value   NUMERIC,
    unit            TEXT,
    flag            TEXT,
    stale           BOOLEAN,
    age_days        INTEGER,
    collected_at    TIMESTAMPTZ,
    relevance       JSONB
);
CREATE INDEX IF NOT EXISTS ix_nutri_labs_presc ON nutrition_labs (prescription_id);

CREATE TABLE IF NOT EXISTS nutrition_checkins (
    id              BIGSERIAL PRIMARY KEY,
    prescription_id TEXT NOT NULL REFERENCES nutrition_prescriptions(id) ON DELETE CASCADE,
    label           TEXT,
    prompt          TEXT,
    stream          TEXT,        -- MEAL_ADHERENCE / SYMPTOMS / WEIGHT / BLOOD_GLUCOSE
    frequency       TEXT         -- DAILY / WEEKLY
);
CREATE INDEX IF NOT EXISTS ix_nutri_checkin_presc ON nutrition_checkins (prescription_id);
"""

TABLES = [
    "nutrition_prescriptions", "nutrition_diagnoses", "nutrition_menu_items",
    "nutrition_day_totals", "nutrition_instructions", "nutrition_guidance",
    "nutrition_labs", "nutrition_checkins",
]


async def main() -> int:
    import asyncpg  # imported here so the file parses even without the dep installed
    dsn = _dsn()
    safe = dsn.split("@")[-1] if "@" in dsn else dsn
    print(f"Connecting to …@{safe}")
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(DDL)
        rows = await conn.fetch(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name",
            TABLES,
        )
        present = {r["table_name"] for r in rows}
        print("Tables ready:")
        for t in TABLES:
            print(f"  {'✓' if t in present else '✗'} {t}")
        missing = [t for t in TABLES if t not in present]
        if missing:
            print(f"ERROR: missing tables: {missing}", file=sys.stderr)
            return 1
        print("All nutrition tables created / verified.")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
