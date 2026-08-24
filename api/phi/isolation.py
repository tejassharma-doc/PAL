"""
Isolation helpers — tenant + member scoping primitives.
Makes cross-tenant / cross-member leakage structurally hard, not just convention.
"""
import uuid
from typing import TypeVar
from sqlalchemy import Select, and_
from sqlalchemy.orm import DeclarativeMeta

T = TypeVar("T")


class TenantScope:
    """Wraps a query to enforce tenant isolation."""
    def __init__(self, tenant_id: uuid.UUID):
        self.tenant_id = tenant_id

    def apply(self, stmt: Select, model) -> Select:
        """Add tenant_id filter. Every PHI query must call this."""
        return stmt.where(model.tenant_id == self.tenant_id)


def member_scope_filter(model, member_id: uuid.UUID) -> object:
    """SQLAlchemy filter expression restricting to a single member's data."""
    return model.member_id == member_id


def tenant_and_member_filter(model, tenant_id: uuid.UUID, member_id: uuid.UUID):
    """Combined tenant + member filter — the standard PHI query scope."""
    return and_(
        model.tenant_id == tenant_id,
        model.member_id == member_id,
    )
