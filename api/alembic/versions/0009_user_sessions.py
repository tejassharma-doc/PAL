"""Add user_sessions table for encrypted JWT storage

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-07
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

            -- Encrypted JWT token
            encrypted_token TEXT NOT NULL,

            -- Session metadata
            session_name VARCHAR(100),
            ip_address VARCHAR(45),
            user_agent VARCHAR(500),

            -- Session lifecycle
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            last_activity TIMESTAMPTZ NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            revoked_at TIMESTAMPTZ,

            -- Indexes for efficient queries
            CONSTRAINT user_sessions_pkey PRIMARY KEY (id)
        );

        -- Index for finding user's active sessions
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active, expires_at) WHERE is_active = TRUE;
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active ON user_sessions(user_id, is_active) WHERE is_active = TRUE;
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS idx_user_sessions_user_active;
        DROP INDEX IF EXISTS idx_user_sessions_active;
        DROP INDEX IF EXISTS idx_user_sessions_user_id;
        DROP TABLE IF EXISTS user_sessions;
    """)
