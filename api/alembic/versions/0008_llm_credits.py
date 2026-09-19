"""Add user_llm_credits and credit_transactions tables

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-30
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_llm_credits (
            user_id UUID PRIMARY KEY,
            balance INTEGER NOT NULL DEFAULT 20,
            last_refill_date DATE NOT NULL DEFAULT CURRENT_DATE,
            total_purchased INTEGER NOT NULL DEFAULT 0,
            total_used INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS credit_transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            delta INTEGER NOT NULL,
            kind VARCHAR(32) NOT NULL,
            pack_id VARCHAR(32),
            tokens_used INTEGER,
            llm_model VARCHAR(64),
            amount_inr INTEGER,
            balance_after INTEGER NOT NULL,
            ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX ON credit_transactions (user_id, ts);
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS credit_transactions;
        DROP TABLE IF EXISTS user_llm_credits;
    """)
