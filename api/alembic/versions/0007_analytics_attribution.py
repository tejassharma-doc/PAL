"""Add analytics_events and attributions tables

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-30
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS analytics_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID,
            event_type VARCHAR(64) NOT NULL,
            source VARCHAR(32),
            ref_code VARCHAR(128),
            doctor_id VARCHAR(128),
            clinic_id VARCHAR(128),
            metadata JSONB,
            ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX ON analytics_events (event_type, ts);
        CREATE INDEX ON analytics_events (doctor_id, ts);
        CREATE INDEX ON analytics_events (user_id);

        CREATE TABLE IF NOT EXISTS attributions (
            user_id UUID PRIMARY KEY,
            source VARCHAR(32) NOT NULL,
            ref_code VARCHAR(128),
            doctor_id VARCHAR(128),
            clinic_id VARCHAR(128),
            app_store VARCHAR(32),
            install_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX ON attributions (doctor_id);
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS analytics_events;
        DROP TABLE IF EXISTS attributions;
    """)
