from .hindsight import Hindsight
from .vectorize_hindsight import VectorizeHindsight, is_running as _vh_running
from . import vectorize_hindsight as vectorize_hindsight_module

import uuid
from sqlalchemy.ext.asyncio import AsyncSession


def get_hindsight(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    member_id: uuid.UUID,
):
    """
    Factory: returns VectorizeHindsight if the embedded server is up,
    otherwise the pgvector Hindsight (always available).
    """
    if _vh_running():
        return VectorizeHindsight(tenant_id, member_id)
    return Hindsight(db, tenant_id, member_id)


__all__ = ["Hindsight", "VectorizeHindsight", "get_hindsight", "vectorize_hindsight_module"]
