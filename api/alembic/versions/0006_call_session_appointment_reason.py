"""Add appointment_reason to call_sessions

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-30
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE call_sessions
        ADD COLUMN IF NOT EXISTS appointment_reason VARCHAR(512);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE call_sessions
        DROP COLUMN IF EXISTS appointment_reason;
    """)
