from .base import Base
from .tenant import Tenant, DeploymentMode, AIProvider, PrivacyMode
from .user import User, TenantMembership, TenantRole, OPERATOR_PERMISSIONS, OTPSession
from .patient import Patient
from .phone_user import PhoneUser
from .health_record import (
    RawSource, HealthFact, EvidenceClass, SourceType,
    Conversation, ConversationTurn, ModelRunAudit,
)
from .analytics import AnalyticsEvent, Attribution
from .credits import UserLLMCredits, CreditTransaction
from .session import UserSession

# Legacy stubs for deleted tables (prevent import errors)
from ._legacy_stubs import (
    ConsentBasis, ConsentScope, RelationshipType, AppointmentRequestStatus,
    AppointmentRequest, CallSession, ConsentGrant, MemberRelationship, PHIAuditLog
)

# New clinic-based models
from .clinic import Clinic
from .doctor import Doctor
from .appointment import Appointment
from .consultation import Consultation
from .clinical_output import ClinicalOutput
from .patient_document import PatientDocument
from .prescription import Prescription
from .lab_test import LabTest
from .audit_log import AuditLog

# Family Plan & Chat models (realtime chat kit + PAL family features)
from .chat import (
    ChatRoom, ChatRoomMember, ChatMessage, MessageReadReceipt,
    ChatMessageReaction, Notification, RoomType, MessageType, ContentType
)
from .family import (
    FamilyPlan, FamilyMember, FamilyInvite, FamilyAccessGrant, FamilyPaymentRequest,
    FamilyRole, FamilyMemberStatus, FamilyRelationship, AccessScope, AccessGrantStatus,
    AccessGrantBasis, HubShareLevel, PaymentRequestStatus, scope_satisfies
)

__all__ = [
    "Base",
    "Tenant", "DeploymentMode", "AIProvider", "PrivacyMode",
    "User", "Patient", "PhoneUser", "TenantMembership", "TenantRole", "OPERATOR_PERMISSIONS", "OTPSession",
    "RawSource", "HealthFact", "EvidenceClass", "SourceType",
    "Conversation", "ConversationTurn", "ModelRunAudit",
    "AnalyticsEvent", "Attribution",
    "UserLLMCredits", "CreditTransaction",
    "UserSession",
    # New clinic-based models
    "Clinic",
    "Doctor",
    "Appointment",
    "Consultation",
    "ClinicalOutput",
    "PatientDocument",
    "Prescription",
    "LabTest",
    "AuditLog",
    # Chat & Notifications
    "ChatRoom", "ChatRoomMember", "ChatMessage", "MessageReadReceipt",
    "ChatMessageReaction", "Notification", "RoomType", "MessageType", "ContentType",
    # Family Plan
    "FamilyPlan", "FamilyMember", "FamilyInvite", "FamilyAccessGrant", "FamilyPaymentRequest",
    "FamilyRole", "FamilyMemberStatus", "FamilyRelationship", "AccessScope", "AccessGrantStatus",
    "AccessGrantBasis", "HubShareLevel", "PaymentRequestStatus", "scope_satisfies",
    # Legacy stubs (tables deleted but enums/classes kept for compatibility)
    "ConsentBasis", "ConsentScope", "RelationshipType", "AppointmentRequestStatus",
    "AppointmentRequest", "CallSession", "ConsentGrant", "MemberRelationship", "PHIAuditLog",
]
