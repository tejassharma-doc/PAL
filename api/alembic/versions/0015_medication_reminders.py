"""Medication reminders (Celery) — schedules, dose events, device tokens

Revision ID: 0015_medication_reminders
Revises: 0014_add_external_ids_rels
Create Date: 2026-10-04

STRICTLY ADDITIVE. Only CREATEs three new tables; no existing table is altered,
dropped or back-filled, so `alembic upgrade head` cannot change the behaviour of
any existing endpoint. Primary keys carry NO server_default to match PAL's
Python-side UUIDMixin (see api/tests/test_schema_parity.py).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0015_medication_reminders"
down_revision = "0014_add_external_ids_rels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── medication_schedules ───────────────────────────────────────────────────
    op.create_table(
        "medication_schedules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("phone_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("phone_users.id", ondelete="CASCADE")),
        sa.Column("medicine_name", sa.String(300), nullable=False),
        sa.Column("dosage", sa.String(200)),
        sa.Column("times", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("days_of_week", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("start_date", sa.Date()),
        sa.Column("end_date", sa.Date()),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="Asia/Kolkata"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_medication_schedules_patient_id", "medication_schedules", ["patient_id"])
    op.create_index("ix_medication_schedules_phone_user_id", "medication_schedules", ["phone_user_id"])
    op.create_index("ix_medication_schedules_active", "medication_schedules", ["active"])

    # ── medication_dose_events ─────────────────────────────────────────────────
    op.create_table(
        "medication_dose_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("schedule_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("medication_schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("phone_user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("scheduled_date", sa.Date(), nullable=False),
        sa.Column("scheduled_time", sa.Time(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="reminded"),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True)),
        sa.Column("ack_prompt_sent_at", sa.DateTime(timezone=True)),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
        sa.Column("response", sa.String(20)),
        sa.Column("snooze_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("schedule_id", "scheduled_date", "scheduled_time",
                            name="uq_dose_event_slot"),
    )
    op.create_index("ix_medication_dose_events_schedule_id", "medication_dose_events", ["schedule_id"])
    op.create_index("ix_medication_dose_events_patient_id", "medication_dose_events", ["patient_id"])
    op.create_index("ix_medication_dose_events_phone_user_id", "medication_dose_events", ["phone_user_id"])
    op.create_index("ix_medication_dose_events_status", "medication_dose_events", ["status"])

    # ── device_tokens ──────────────────────────────────────────────────────────
    op.create_table(
        "device_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("phone_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("phone_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.String(10), nullable=False),
        sa.Column("token", sa.Text(), nullable=False, unique=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_device_tokens_phone_user_id", "device_tokens", ["phone_user_id"])


def downgrade() -> None:
    op.drop_table("device_tokens")
    op.drop_table("medication_dose_events")
    op.drop_table("medication_schedules")
