import uuid
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, ForeignKey, Enum as SAEnum, Text, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from .base import Base, TimestampMixin, UUIDMixin


# REMOVED: AppointmentRequest table has been deleted
# class AppointmentRequestStatus(str, enum.Enum):
#     pending = "pending"
#     confirmed = "confirmed"
#     dispatched = "dispatched"
#     cancelled = "cancelled"


class EvidenceClass(str, enum.Enum):
    source_backed = "source_backed"     # from an uploaded/connected source document
    user_canonical = "user_canonical"   # user explicitly confirmed this as ground truth
    inferred = "inferred"               # AI-inferred from sources (must show derivation)
    statistical = "statistical"         # population-level / reference range
    unknown = "unknown"                 # cannot be classified


class SourceType(str, enum.Enum):
    upload = "upload"
    fhir_import = "fhir_import"
    manual_entry = "manual_entry"
    ai_extraction = "ai_extraction"


class RawSource(Base, UUIDMixin, TimestampMixin):
    """
    Immutable raw source. Original bytes/content never mutated.
    All facts derived from this source reference it.
    """
    __tablename__ = "raw_sources"

    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    source_type: Mapped[SourceType] = mapped_column(SAEnum(SourceType), nullable=False)
    filename: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # Content-addressed storage path (hash-based, immutable)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(nullable=True)

    # Upload policy classification
    is_imaging: Mapped[bool] = mapped_column(Boolean, default=False)
    is_document: Mapped[bool] = mapped_column(Boolean, default=False)

    facts: Mapped[list["HealthFact"]] = relationship(back_populates="raw_source")


class HealthFact(Base, UUIDMixin, TimestampMixin):
    """
    A single extracted health datum (lab value, medication, allergy, etc.).
    Every fact carries its evidence class and provenance chain.
    """
    __tablename__ = "health_facts"

    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    # Fact identity
    fact_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)  # lab, med, allergy, vitals…
    fact_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)   # e.g. "LDL", "metformin"
    fact_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    recorded_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Evidence contract — every fact must be classified
    evidence_class: Mapped[EvidenceClass] = mapped_column(
        SAEnum(EvidenceClass), nullable=False, default=EvidenceClass.unknown
    )

    # Provenance chain
    raw_source_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("raw_sources.id"), nullable=True
    )
    derivation_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    provenance_chain: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # pgvector embedding for RAG retrieval (Hindsight)
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(1536), nullable=True)

    raw_source: Mapped[Optional["RawSource"]] = relationship(back_populates="facts")


class Conversation(Base, UUIDMixin, TimestampMixin):
    """A search/chat thread. On by default; user can delete (real cascade)."""
    __tablename__ = "conversations"

    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    title: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    scope_tag: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # generic | personal | mixed

    # Session consent basis for this thread
    consent_basis: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    consent_grant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Hindsight rolling summary (compact; never the full transcript)
    hindsight_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hindsight_updated_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    deleted_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    turns: Mapped[list["ConversationTurn"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")


class ConversationTurn(Base, UUIDMixin, TimestampMixin):
    """One turn (user query + assistant answer) inside a conversation."""
    __tablename__ = "conversation_turns"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    role: Mapped[str] = mapped_column(String(20), nullable=False)   # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=True)

    # Classification from the on-device model
    scope: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # generic | personal | ambiguous
    safety_category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Structured provenance / citations for assistant turns
    provenance: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    citations: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # PHI flag: was PHI involved? (determines storage perimeter)
    contains_phi: Mapped[bool] = mapped_column(Boolean, default=False)

    # pgvector embedding for Hindsight RAG
    embedding: Mapped[Optional[list[float]]] = mapped_column(Vector(1536), nullable=True)

    conversation: Mapped["Conversation"] = relationship(back_populates="turns")


# REMOVED: AppointmentRequest table has been deleted
# class AppointmentRequest(Base, UUIDMixin, TimestampMixin):
#     """
#     Confirmed booking / clinic message action — written only after token validation.
#     Status tracks dispatch lifecycle (pending → dispatched when clinic connector sends).
#     """
#     __tablename__ = "appointment_requests"
#
#     tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
#     member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
#     requesting_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
#     session_id: Mapped[str] = mapped_column(String(255), nullable=False)
#     action_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "booking" | "messaging"
#     action_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
#     status: Mapped[AppointmentRequestStatus] = mapped_column(
#         SAEnum(AppointmentRequestStatus), nullable=False, default=AppointmentRequestStatus.confirmed
#     )
#     confirmed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
#     dispatched_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)


class ModelRunAudit(Base, UUIDMixin, TimestampMixin):
    """
    Append-only audit of every AI model call.
    Never contains: API keys, PHI content, prompt text.
    Contains: who, which model, provider, tokens, prompt version, requester.
    """
    __tablename__ = "model_run_audits"

    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    requesting_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    target_member_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    conversation_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    model_provider: Mapped[str] = mapped_column(String(50), nullable=False)   # anthropic | bedrock
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)        # claude-sonnet-4-6, etc.
    prompt_version: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    agent_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    input_tokens: Mapped[Optional[int]] = mapped_column(nullable=True)
    output_tokens: Mapped[Optional[int]] = mapped_column(nullable=True)
    cache_read_tokens: Mapped[Optional[int]] = mapped_column(nullable=True)

    phi_involved: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_basis: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    egress_allowed: Mapped[Optional[bool]] = mapped_column(nullable=True)

    latency_ms: Mapped[Optional[int]] = mapped_column(nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    error_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
