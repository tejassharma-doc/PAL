"""Add call_sessions table for Hermes Voice Agent multi-turn calls

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-23
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS call_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL,
            member_id UUID NOT NULL,
            doctor_id VARCHAR(128),
            doctor_name VARCHAR(256),
            patient_name VARCHAR(256),
            status VARCHAR(32) NOT NULL DEFAULT 'ringing',
            call_state VARCHAR(32) NOT NULL DEFAULT 'greeting',
            transcript JSONB,
            appointment_booked BOOLEAN NOT NULL DEFAULT FALSE,
            appointment_details JSONB,
            lab_tests JSONB,
            started_at TIMESTAMPTZ,
            ended_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX ON call_sessions (tenant_id);
        CREATE INDEX ON call_sessions (member_id);
        CREATE INDEX ON call_sessions (status);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS call_sessions;")
