"""OTP auth: phone as patient ID, passwordless support, otp_sessions table

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-23
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
-- Phone becomes the canonical patient identifier (unique where set)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN hashed_password DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial unique index: allows multiple NULLs, enforces uniqueness only when phone is set
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone
    ON users(phone) WHERE phone IS NOT NULL;

-- OTP sessions (10-minute TTL, max 3 attempts)
CREATE TABLE IF NOT EXISTS otp_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    phone           VARCHAR(30)  NOT NULL,
    delivery_channel VARCHAR(10) NOT NULL,
    delivery_address VARCHAR(320) NOT NULL,
    otp_hash        VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    verified        BOOLEAN NOT NULL DEFAULT FALSE,
    attempts        INTEGER NOT NULL DEFAULT 0,
    purpose         VARCHAR(20) NOT NULL DEFAULT 'auth'
);

CREATE INDEX IF NOT EXISTS ix_otp_sessions_phone ON otp_sessions(phone);
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS otp_sessions;
DROP INDEX IF EXISTS uq_users_phone;
ALTER TABLE users DROP COLUMN IF EXISTS phone_verified;
ALTER TABLE users ALTER COLUMN hashed_password SET NOT NULL;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
