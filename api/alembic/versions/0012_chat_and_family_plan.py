"""Realtime chat + Family Plan

Revision ID: 0012_chat_and_family_plan
Revises: 0011_chat_family
Create Date: 2026-08-11

STRICTLY ADDITIVE. This migration only CREATEs. It does not ALTER, DROP or
back-fill any pre-existing table, so `alembic upgrade head` on a live PAL
database cannot change the behaviour of any existing endpoint.

Head selection: PAL has two historical chains (0001..0009 and
001_patients..004_lab_tests) that were merged by 005_lab_reports
(down_revision = '0011_chat_family'
single head, and this revision extends it.

`downgrade()` drops exactly the eleven tables created here, in FK-safe order,
and restores the database to its pre-migration state.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012_chat_and_family_plan"
down_revision = '0011_chat_family'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pgcrypto provides gen_random_uuid(), which the service-layer raw SQL calls
    # explicitly (chat_room_members, receipts, reactions). PAL's init_db creates
    # the vector and pg_trgm extensions the same way.
    #
    # NOTE: primary keys deliberately carry NO server_default. PAL's UUIDMixin
    # generates ids in Python, so every other table in the app is built that way
    # by create_all(). Matching it keeps the two build paths byte-identical —
    # see api/tests/test_schema_parity.py, which enforces exactly that.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # ── chat_rooms ───────────────────────────────────────────────────────────
    op.create_table(
        "chat_rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("slug", sa.String(300), nullable=False, unique=True),
        sa.Column("room_type", sa.String(50), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("is_private", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_moderated", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("max_members", sa.Integer()),
        sa.Column("member_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("owner_org_type", sa.String(20)),
        sa.Column("owner_org_id", postgresql.UUID(as_uuid=True)),
        sa.Column("created_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_chat_rooms_slug", "chat_rooms", ["slug"])
    op.create_index("ix_chat_rooms_owner", "chat_rooms", ["owner_org_type", "owner_org_id"])
    op.create_index("ix_chat_rooms_owner_org_id", "chat_rooms", ["owner_org_id"])
    op.create_index("ix_chat_rooms_owner_org_type", "chat_rooms", ["owner_org_type"])

    # ── chat_room_members ────────────────────────────────────────────────────
    op.create_table(
        "chat_room_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("room_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chat_rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("is_muted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("left_at", sa.DateTime(timezone=True)),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("room_id", "user_id", name="uq_chat_room_member"),
    )
    op.create_index("ix_chat_room_members_room_id", "chat_room_members", ["room_id"])
    op.create_index("ix_chat_room_members_user_id", "chat_room_members", ["user_id"])

    # ── chat_messages ────────────────────────────────────────────────────────
    # sender_id/recipient_id/room_id are VARCHAR(36) with NO foreign keys — the
    # chat kit's deliberate decoupling so one table holds DMs, room messages and
    # system messages (whose sender is the literal 'pal-system').
    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sender_id", sa.String(36), nullable=False),
        sa.Column("recipient_id", sa.String(36)),
        sa.Column("room_id", sa.String(36)),
        sa.Column("message_type", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(20), nullable=False, server_default="text"),
        sa.Column("media_url", sa.String(500)),
        sa.Column("reply_to_id", sa.String(36)),
        sa.Column("msg_source", sa.String(20)),
        sa.Column("payload", postgresql.JSONB()),
        sa.Column("subject_member_id", postgresql.UUID(as_uuid=True)),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_chat_messages_room_created", "chat_messages", ["room_id", "created_at"])
    op.create_index("ix_chat_messages_dm", "chat_messages",
                    ["sender_id", "recipient_id", "created_at"])
    op.create_index("ix_chat_messages_sender_id", "chat_messages", ["sender_id"])
    op.create_index("ix_chat_messages_recipient_id", "chat_messages", ["recipient_id"])
    op.create_index("ix_chat_messages_room_id", "chat_messages", ["room_id"])
    op.create_index("ix_chat_messages_subject_member_id", "chat_messages", ["subject_member_id"])

    # ── message_read_receipts ────────────────────────────────────────────────
    op.create_table(
        "message_read_receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reader_id", sa.String(36), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("message_id", "reader_id", name="uq_read_receipt"),
    )
    op.create_index("ix_message_read_receipts_message_id", "message_read_receipts", ["message_id"])
    op.create_index("ix_message_read_receipts_reader_id", "message_read_receipts", ["reader_id"])

    # ── chat_message_reactions ───────────────────────────────────────────────
    op.create_table(
        "chat_message_reactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("message_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("reaction", sa.String(16), nullable=False, server_default="like"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("message_id", "user_id", "reaction", name="uq_chat_msg_reaction"),
    )
    op.create_index("ix_chat_message_reactions_message_id", "chat_message_reactions", ["message_id"])

    # ── notifications ────────────────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("body", sa.Text()),
        sa.Column("notification_type", sa.String(50), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False, server_default="in_app"),
        sa.Column("link", sa.String(500)),
        sa.Column("ref_id", postgresql.UUID(as_uuid=True)),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_user_unread", "notifications",
                    ["user_id", "is_read", "created_at"])

    # ── family_plans ─────────────────────────────────────────────────────────
    op.create_table(
        "family_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True)),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("primary_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("hub_room_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chat_rooms.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("max_members", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("billing_currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("hub_share_ceiling", sa.String(20), nullable=False, server_default="minimal"),
        sa.Column("settings", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_family_plans_primary_user_id", "family_plans", ["primary_user_id"])
    op.create_index("ix_family_plans_tenant_id", "family_plans", ["tenant_id"])
    op.create_index("ix_family_plans_hub_room_id", "family_plans", ["hub_room_id"])

    # ── family_members ───────────────────────────────────────────────────────
    op.create_table(
        "family_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("family_plan_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("family_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patients.id", ondelete="SET NULL")),
        sa.Column("phone", sa.String(30)),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("relationship_type", sa.String(30), nullable=False, server_default="other"),
        sa.Column("role", sa.String(30), nullable=False, server_default="adult"),
        sa.Column("status", sa.String(20), nullable=False, server_default="invited"),
        sa.Column("date_of_birth", sa.Date()),
        sa.Column("guardian_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("guardianship_expires_at", sa.DateTime(timezone=True)),
        sa.Column("is_billing_delegate", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
        sa.Column("hub_share_level", sa.String(20), nullable=False, server_default="minimal"),
        sa.Column("hub_muted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("invited_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("invited_at", sa.DateTime(timezone=True)),
        sa.Column("joined_at", sa.DateTime(timezone=True)),
        sa.Column("removed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("family_plan_id", "phone", name="uq_family_member_phone"),
        sa.UniqueConstraint("family_plan_id", "user_id", name="uq_family_member_user"),
    )
    op.create_index("ix_family_members_family_plan_id", "family_members", ["family_plan_id"])
    op.create_index("ix_family_members_user_id", "family_members", ["user_id"])
    op.create_index("ix_family_members_patient_id", "family_members", ["patient_id"])
    op.create_index("ix_family_members_phone", "family_members", ["phone"])
    op.create_index("ix_family_members_guardian_user_id", "family_members", ["guardian_user_id"])
    op.create_index("ix_family_members_guardianship_expires_at", "family_members",
                    ["guardianship_expires_at"])
    op.create_index("ix_family_members_plan_status", "family_members",
                    ["family_plan_id", "status"])

    # ── family_invites ───────────────────────────────────────────────────────
    op.create_table(
        "family_invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("family_plan_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("family_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("family_member_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("family_members.id", ondelete="CASCADE")),
        sa.Column("phone", sa.String(30), nullable=False),
        sa.Column("code_hash", sa.String(255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("accepted_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_family_invites_family_plan_id", "family_invites", ["family_plan_id"])
    op.create_index("ix_family_invites_family_member_id", "family_invites", ["family_member_id"])
    op.create_index("ix_family_invites_phone", "family_invites", ["phone"])

    # ── family_access_grants ─────────────────────────────────────────────────
    op.create_table(
        "family_access_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("family_plan_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("family_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_member_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("family_members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("grantee_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("basis", sa.String(30), nullable=False, server_default="consent_handshake"),
        sa.Column("request_message", sa.Text()),
        sa.Column("requested_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("decided_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("decision_channel", sa.String(30)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("revocation_reason", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_family_access_grants_family_plan_id", "family_access_grants",
                    ["family_plan_id"])
    op.create_index("ix_family_access_grants_subject_member_id", "family_access_grants",
                    ["subject_member_id"])
    op.create_index("ix_family_access_grants_grantee_user_id", "family_access_grants",
                    ["grantee_user_id"])
    op.create_index("ix_family_access_grants_status", "family_access_grants", ["status"])
    op.create_index("ix_family_access_grants_expires_at", "family_access_grants", ["expires_at"])
    op.create_index("ix_family_grants_lookup", "family_access_grants",
                    ["subject_member_id", "grantee_user_id", "status"])

    # ── family_payment_requests ──────────────────────────────────────────────
    op.create_table(
        "family_payment_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("family_plan_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("family_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_member_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("family_members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("appointments.id", ondelete="SET NULL")),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("payment_url", sa.String(1000)),
        sa.Column("provider", sa.String(50)),
        sa.Column("provider_ref", sa.String(200)),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("requested_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("paid_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("hub_message_id", postgresql.UUID(as_uuid=True)),
        sa.Column("idempotency_key", sa.String(120), unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_family_payment_requests_family_plan_id", "family_payment_requests",
                    ["family_plan_id"])
    op.create_index("ix_family_payment_requests_subject_member_id", "family_payment_requests",
                    ["subject_member_id"])
    op.create_index("ix_family_payment_requests_appointment_id", "family_payment_requests",
                    ["appointment_id"])
    op.create_index("ix_family_payment_requests_status", "family_payment_requests", ["status"])
    op.create_index("ix_family_payment_requests_paid_by_user_id", "family_payment_requests",
                    ["paid_by_user_id"])
    op.create_index("ix_family_payment_requests_provider_ref", "family_payment_requests",
                    ["provider_ref"])


def downgrade() -> None:
    # FK-safe order. family_plans.hub_room_id -> chat_rooms must go before
    # chat_rooms, and everything family_* before family_plans.
    op.drop_table("family_payment_requests")
    op.drop_table("family_access_grants")
    op.drop_table("family_invites")
    op.drop_table("family_members")
    op.drop_table("family_plans")
    op.drop_table("notifications")
    op.drop_table("chat_message_reactions")
    op.drop_table("message_read_receipts")
    op.drop_table("chat_messages")
    op.drop_table("chat_room_members")
    op.drop_table("chat_rooms")
    # pgcrypto is intentionally NOT dropped — other things may rely on it and
    # dropping an extension is not a safe reversal.
