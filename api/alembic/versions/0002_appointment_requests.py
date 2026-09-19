"""Add appointment_requests table

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TYPE appointmentrequeststatus AS ENUM (
            'pending', 'confirmed', 'dispatched', 'cancelled'
        );

        CREATE TABLE IF NOT EXISTS appointment_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            member_id UUID NOT NULL,
            requesting_user_id UUID NOT NULL,
            session_id VARCHAR(255) NOT NULL,
            action_type VARCHAR(50) NOT NULL,
            action_payload JSONB NOT NULL,
            status appointmentrequeststatus NOT NULL DEFAULT 'confirmed',
            confirmed_at TIMESTAMPTZ,
            dispatched_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX ON appointment_requests (tenant_id);
        CREATE INDEX ON appointment_requests (member_id);
        CREATE INDEX ON appointment_requests (status);
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS appointment_requests;
        DROP TYPE IF EXISTS appointmentrequeststatus;
    """)
