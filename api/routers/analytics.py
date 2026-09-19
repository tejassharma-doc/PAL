"""
Analytics + Attribution router — /analytics

Two surfaces:
  POST /analytics/attribute   — called by mobile on first launch with referral params
  GET  /analytics/summary     — operator-admin reporting endpoint
"""
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user, CurrentMembership
from config import get_settings
from database import get_db
from models import User, TenantRole
from models.analytics import Attribution
from services.analytics.tracker import track
from services.analytics.summary import conversion_summary

router = APIRouter(prefix="/analytics", tags=["analytics"])


# ── Attribution ───────────────────────────────────────────────────────────────

class AttributeRequest(BaseModel):
    ref_code: Optional[str] = None       # DR_{doctor_id} from deep link
    clinic_id: Optional[str] = None
    app_store: Optional[str] = None      # play_store | app_store
    source: Optional[str] = None         # docehr | play_store | app_store | direct


@router.post("/attribute", status_code=204)
async def attribute_install(
    req: AttributeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Called by mobile on first authenticated launch.
    Writes an attributions row (upsert — safe for multiple calls).
    """
    settings = get_settings()
    if not settings.analytics_enabled:
        return

    # Derive doctor_id and source from ref_code when not explicitly provided
    doctor_id: Optional[str] = None
    source = req.source or "direct"

    if req.ref_code:
        if req.ref_code.startswith("DR_"):
            doctor_id = req.ref_code[3:]
            source = "docehr"

    # Upsert — first call wins; subsequent calls from same user are ignored
    await db.execute(
        text("""
            INSERT INTO attributions
                (user_id, source, ref_code, doctor_id, clinic_id, app_store)
            VALUES
                (:uid, :source, :ref_code, :doctor_id, :clinic_id, :app_store)
            ON CONFLICT (user_id) DO NOTHING
        """),
        {
            "uid": user.id,
            "source": source,
            "ref_code": req.ref_code,
            "doctor_id": doctor_id,
            "clinic_id": req.clinic_id,
            "app_store": req.app_store,
        },
    )

    await track(
        db,
        "app_install",
        user_id=user.id,
        source=source,
        ref_code=req.ref_code,
        doctor_id=doctor_id,
        clinic_id=req.clinic_id,
    )


# ── Admin summary ─────────────────────────────────────────────────────────────

@router.get("/summary")
async def analytics_summary(
    date_from: date = Query(..., description="Start date (YYYY-MM-DD)"),
    date_to: date = Query(..., description="End date (YYYY-MM-DD)"),
    group_by: str = Query("source", description="source | doctor"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Operator-admin conversion funnel summary.
    Returns install counts + Hermes conversion rates grouped by source or doctor.
    """
    settings = get_settings()
    if not settings.analytics_enabled:
        raise HTTPException(status_code=404, detail="Analytics not enabled.")

    if group_by not in ("source", "doctor"):
        raise HTTPException(status_code=400, detail="group_by must be 'source' or 'doctor'.")

    if date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from must be before date_to.")

    rows = await conversion_summary(db, date_from, date_to, group_by=group_by)
    return {"group_by": group_by, "from": str(date_from), "to": str(date_to), "rows": rows}
