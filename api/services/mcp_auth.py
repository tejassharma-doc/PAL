"""Service-to-service auth for the PAL MCP (FastMCP) tool server.

WHY THIS EXISTS
---------------
The FastMCP server (``http://fastmcp:8002``) exposes tools that return PHI —
``get_patient_records``, ``get_lab_results`` and friends — and until now it ran
with NO authentication at all. Anything that could reach the port could POST
``/tools/call`` with any ``patient_id`` and read that patient's full record.

So every PAL-MCP-related call now carries a short-lived JWT that this module
mints. The API has already authenticated the human user (``get_current_user``);
this token vouches for that decision to the MCP, and — critically — pins the
call to the patient ids the user actually owns. The MCP re-verifies the
signature, the expiry, the audience/type and the patient scope before it runs a
tool, so a stolen or replayed token buys at most ``mcp_jwt_ttl`` seconds against
exactly one user's own data.

The token is signed with the shared ``secret_key`` (the MCP is handed the same
secret via env), so there is no second key to rotate or leak.
"""
from __future__ import annotations

import time
import uuid
from typing import List, Union

from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models.patient import Patient
from models.phone_user import PhoneUser
from models.user import User

settings = get_settings()


async def owned_patient_ids(db: AsyncSession, user: Union[PhoneUser, User]) -> List[str]:
    """Every active patient record the authenticated user is allowed to read.

    PAL's primary auth is phone OTP, and ``patients.phone_user_id`` is the
    ownership link: a phone user owns the patient records tied to their id. That
    set is the ONLY data the minted token will authorise, which is what closes
    the "any patient_id" hole in the chat endpoint.
    """
    if not isinstance(user, PhoneUser):
        # Legacy email/staff accounts have no phone_user_id link to patients, so
        # they own nothing through this path. They therefore cannot drive the
        # patient assistant against arbitrary records — a deliberate denial, not
        # an oversight. A staff-facing grant would be a separate, reviewed change.
        return []
    rows = (
        await db.execute(
            select(Patient.id).where(
                Patient.phone_user_id == user.id,
                Patient.is_active == True,  # noqa: E712 — SQL boolean, not Python
            )
        )
    ).scalars().all()
    return [str(r) for r in rows]


def mint_mcp_token(user_id: str, patient_ids: List[str]) -> str:
    """Mint a short-lived, patient-scoped JWT for one MCP hop."""
    now = int(time.time())
    return jwt.encode(
        {
            "sub": str(user_id),
            "pids": [str(p) for p in patient_ids],
            "aud": settings.mcp_jwt_aud,
            "typ": settings.mcp_jwt_typ,
            "iat": now,
            "exp": now + settings.mcp_jwt_ttl,
        },
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def _norm(value: str) -> str:
    """Normalise an id for comparison; UUIDs may differ only in case/format."""
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        return str(value)


def user_owns_patient(patient_id: str, allowed: List[str]) -> bool:
    """True if ``patient_id`` is within the user's allowed set (UUID-normalised)."""
    target = _norm(patient_id)
    return any(_norm(a) == target for a in allowed)
