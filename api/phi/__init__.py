"""
PHI Module — the single enforcement perimeter.

Every surface that touches Protected Health Information routes through this package.
It is the "PHI in-perimeter · consent · BAAs · isolation · audit" box.

Public API:
  - phi_guard          FastAPI dependency: checks access and raises 403 if denied
  - require_phi_access Function/guard for non-route contexts
  - consent_registry   CRUD + lifecycle for consent grants
  - egress_control     Single chokepoint for sending PHI to an external AI provider
  - phi_audit          Append-only structured audit log
  - isolation          Tenant + member scoping primitives

CI contract: every PHI-touching route MUST declare `Depends(phi_guard)`.
A CI lint step (tests/test_phi_ci_guard.py) fails the build if any route
under /records, /search (personal scope), /facts, /conversations (personal)
is registered without it.
"""

from .guard import phi_guard, require_phi_access, PHIAccessContext, PHIAccessDecision
from .consent import ConsentRegistry
from .egress import EgressControl, EgressDecision
from .audit import PHIAudit, AuditEvent
from .isolation import TenantScope, member_scope_filter

__all__ = [
    "phi_guard",
    "require_phi_access",
    "PHIAccessContext",
    "PHIAccessDecision",
    "ConsentRegistry",
    "EgressControl",
    "EgressDecision",
    "PHIAudit",
    "AuditEvent",
    "TenantScope",
    "member_scope_filter",
]
