"""Medication reminder models.

Powers the Celery-driven reminder system: a recurring plan (MedicationSchedule),
one row per fired dose (MedicationDoseEvent, the source of truth for whether the
patient acknowledged taking it), and push device tokens (DeviceToken).

Keyed on patient_id AND phone_user_id (the latter denormalized so the Celery
worker can resolve the realtime/push recipient without a join). We deliberately
do NOT reuse the shared `notifications` table, whose user_id FK targets users.id
and would reject phone-user recipients.
"""
import uuid
from datetime import date, datetime, time
from typing import Optional

from sqlalchemy import (
    String, Boolean, Integer, Text, Date, Time, DateTime, ForeignKey,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from models.base import Base, UUIDMixin, TimestampMixin


class MedicationSchedule(Base, UUIDMixin, TimestampMixin):
    """A recurring medicine plan for one patient."""
    __tablename__ = "medication_schedules"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Denormalized recipient — the realtime channel id + push lookup key.
    phone_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("phone_users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    medicine_name: Mapped[str] = mapped_column(String(300), nullable=False)
    dosage: Mapped[Optional[str]] = mapped_column(String(200))  # e.g. "1 tablet"
    # List of "HH:MM" local times, e.g. ["09:00", "21:00"].
    times: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    # List of ints 0-6 (Mon=0). Empty list => every day.
    days_of_week: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    start_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)

    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text)

    dose_events: Mapped[list["MedicationDoseEvent"]] = relationship(
        "MedicationDoseEvent", back_populates="schedule", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<MedicationSchedule(id={self.id}, medicine={self.medicine_name})>"


class MedicationDoseEvent(Base, UUIDMixin, TimestampMixin):
    """One fired dose. Status tracks the reminder -> ack lifecycle."""
    __tablename__ = "medication_dose_events"
    __table_args__ = (
        # The 60s scan is idempotent: a dose for (schedule, date, time) is created
        # once, so a tick that runs twice in a minute cannot double-remind.
        UniqueConstraint(
            "schedule_id", "scheduled_date", "scheduled_time",
            name="uq_dose_event_slot",
        ),
    )

    schedule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("medication_schedules.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    phone_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), index=True)

    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    scheduled_time: Mapped[time] = mapped_column(Time, nullable=False)

    # reminded | awaiting_ack | taken | skipped | snoozed | missed
    status: Mapped[str] = mapped_column(String(20), default="reminded", nullable=False, index=True)
    reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    ack_prompt_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    responded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # yes | no | take_now | snooze_10
    response: Mapped[Optional[str]] = mapped_column(String(20))
    snooze_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    schedule: Mapped["MedicationSchedule"] = relationship(
        "MedicationSchedule", back_populates="dose_events"
    )

    def __repr__(self):
        return f"<MedicationDoseEvent(id={self.id}, status={self.status})>"


class DeviceToken(Base, UUIDMixin, TimestampMixin):
    """FCM/APNs push token for a phone user's device."""
    __tablename__ = "device_tokens"

    phone_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("phone_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    platform: Mapped[str] = mapped_column(String(10), nullable=False)  # ios | android | web
    token: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    def __repr__(self):
        return f"<DeviceToken(id={self.id}, platform={self.platform})>"
