"""Chat read watermark — makes the unread badge O(unread) instead of O(history)

Revision ID: 0011_read_watermark
Revises: 0010_chat_family
Create Date: 2026-08-14

WHY
---
`unread_total()` counted unread messages by scanning every message in every
room the user belongs to and anti-joining `message_read_receipts` for each one.
Measured on this build:

    15,000 messages in the user's rooms  ->  27.9 ms, 45,288 shared buffers
    60,000 messages in the user's rooms  ->  96 ms wall (~180 ms CPU, parallel)

...to return the number 12. The cost is linear in TOTAL HISTORY, not in the
number of unread messages, so the badge got slower every day the family chatted
— and the AppBar calls it on every screen, so it presents as "the whole app is
slow", not "chat is slow".

Counting forward from a per-membership watermark instead lets PostgreSQL use
the existing `ix_chat_messages_room_created` (room_id, created_at) index as a
range scan. Measured on the same 75k-row table: **0.094 ms**, and constant as
history grows.

    Index Scan using ix_chat_messages_room_created on chat_messages
      Index Cond: (room_id = $0 AND created_at > $1)

SAFETY
------
Additive: one nullable column, no DROP, no type change, no rewrite of an
existing column. `message_read_receipts` is untouched and still backs
per-message "seen by" — it simply stops being the source of truth for a count.

The back-fill matters. Without it every existing member's `last_read_at` would
be NULL, which reads as "never opened this room", and every user would log in
to a badge showing their entire history as unread. So we seed the watermark
from the receipts that already exist, using the newest **message created_at**
they hold a receipt for — not `read_at`, which is when they read it, a
different and wrong instant.

Rooms a member genuinely never opened have no receipts and correctly stay NULL.
"""
from alembic import op
import sqlalchemy as sa


revision = "0011_read_watermark"
down_revision = "0010_chat_family"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_room_members",
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Back-fill from existing receipts so nobody's badge spuriously lights up.
    #
    # chat_messages.room_id is VARCHAR(36) while chat_room_members.room_id is
    # uuid (inherited from the upstream chat kit), hence the ::text cast. This
    # runs once, over the whole table, so the cast costing an index here is
    # irrelevant — but it is exactly the mismatch that made the OLD query slow,
    # and it is worth aligning the types in a future migration.
    op.execute(
        """
        UPDATE chat_room_members m
           SET last_read_at = sub.watermark
          FROM (
                SELECT rr.reader_id            AS reader_id,
                       cm.room_id              AS room_id,
                       MAX(cm.created_at)      AS watermark
                  FROM message_read_receipts rr
                  JOIN chat_messages cm ON cm.id = rr.message_id
                 GROUP BY rr.reader_id, cm.room_id
               ) sub
         WHERE m.user_id::text = sub.reader_id
           AND m.room_id::text = sub.room_id
        """
    )

    # Supports "which of my rooms have anything new" without touching
    # chat_messages at all. Partial: departed members are never queried.
    op.create_index(
        "ix_chat_room_members_user_watermark",
        "chat_room_members",
        ["user_id", "last_read_at"],
        postgresql_where=sa.text("left_at IS NULL"),
    )

    # ── drop a redundant index that was actively harmful ─────────────────────
    # ix_chat_messages_room_id is (room_id). ix_chat_messages_room_created is
    # (room_id, created_at) — so the first is a strict PREFIX of the second and
    # can serve no lookup the second cannot.
    #
    # It was not merely redundant. With both present the planner preferred the
    # narrower one for the new watermark query and applied `created_at >` as a
    # post-filter, re-scanning every message in the room:
    #
    #     with    ix_chat_messages_room_id :  11.7 ms, 1,286 buffers, 14,997 rows filtered
    #     without ix_chat_messages_room_id :   0.19 ms,    19 buffers,      0 rows filtered
    #
    # Together with the watermark that is the full 57.2 ms -> 0.19 ms, ~300x on
    # 60k messages, and it stays flat as history grows instead of degrading.
    #
    # Dropping an index is safe to reverse and costs no data. IF EXISTS because
    # a database built by create_all() from the updated model never had it.
    op.execute("DROP INDEX IF EXISTS ix_chat_messages_room_id")


def downgrade() -> None:
    op.create_index("ix_chat_messages_room_id", "chat_messages", ["room_id"])
    op.drop_index("ix_chat_room_members_user_watermark", table_name="chat_room_members")
    op.drop_column("chat_room_members", "last_read_at")
