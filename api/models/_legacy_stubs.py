"""
Legacy model stubs for backward compatibility.
These tables have been removed from the database but some code still references them.
These are stub classes to prevent import errors.
"""
import enum
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Mapped


# Enums (used in type hints and conditionals)
class ConsentBasis(str, enum.Enum):
    """REMOVED - consent_grants table deleted"""
    session = "session"
    standing = "standing"
    per_query = "per_query"
    family_relationship = "family_relationship"
    provider_grant = "provider_grant"


class ConsentScope(str, enum.Enum):
    """REMOVED - consent_grants table deleted"""
    full_record = "full_record"
    specific_dossiers = "specific_dossiers"
    read_only = "read_only"
    annotate = "annotate"


class RelationshipType(str, enum.Enum):
    """REMOVED - member_relationships table deleted"""
    spouse = "SPOUSE"
    parent_of = "PARENT_OF"
    child_of = "CHILD_OF"


class AppointmentRequestStatus(str, enum.Enum):
    """REMOVED - appointment_requests table deleted"""
    pending = "pending"
    confirmed = "confirmed"
    dispatched = "dispatched"
    cancelled = "cancelled"


# Stub classes (for code that instantiates or queries these models)
class AppointmentRequest:
    """REMOVED - appointment_requests table deleted. Stub class for compatibility."""
    def __init__(self, **kwargs):
        raise RuntimeError("AppointmentRequest table has been deleted. Use Appointment model instead.")


class CallSession:
    """REMOVED - call_sessions table deleted. Stub class for compatibility."""
    def __init__(self, **kwargs):
        raise RuntimeError("CallSession table has been deleted.")


class ConsentGrant:
    """REMOVED - consent_grants table deleted. Stub class for compatibility."""
    def __init__(self, **kwargs):
        raise RuntimeError("ConsentGrant table has been deleted.")


class MemberRelationship:
    """REMOVED - member_relationships table deleted. Stub class for compatibility."""
    def __init__(self, **kwargs):
        raise RuntimeError("MemberRelationship table has been deleted.")


class PHIAuditLog:
    """REMOVED - phi_audit_log table deleted. Stub class for compatibility."""
    def __init__(self, **kwargs):
        raise RuntimeError("PHIAuditLog table has been deleted.")
