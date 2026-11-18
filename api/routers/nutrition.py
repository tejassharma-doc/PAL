"""Nutrition API — serves the iNutriMon nutrition prescription for a patient.

  GET /nutrition/patient/{patient_id}  -> current nutrition plan (menu, targets, guidance)

The data is projected from the iNutriMon `nutrition_prescription.published` webhook
into the relational `nutrition_*` tables (see mcp-server/create_nutrition_tables.py and
nutrition_store.py). Those tables are NOT SQLAlchemy models, so this router reads them
with raw SQL on the shared async session.

Matching: the webhook best-effort resolves `pal_patient_id` by phone, but it can be
null if the plan arrived before the PAL patient existed. So we match on pal_patient_id
OR the patient phone's last 10 digits (same approach as visits.py).
"""
from __future__ import annotations

import json
import re
from typing import Union, Optional, Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_unified as get_current_user
from database import get_db
from dependencies.authz import verify_patient_ownership
from models.phone_user import PhoneUser
from models.user import User

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


def _iso(v: Any) -> Optional[str]:
    try:
        return v.isoformat() if v is not None and hasattr(v, "isoformat") else v
    except Exception:
        return None


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 2)
    except (TypeError, ValueError):
        return None


def _jsonb(v: Any) -> Any:
    """asyncpg returns JSONB columns as str; parse to objects for the API."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except (ValueError, TypeError):
            return v
    return v


@router.get("/patient/{patient_id}")
async def get_patient_nutrition(
    patient_id: str,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current nutrition prescription for a patient, or {has_plan: False}."""
    patient = await verify_patient_ownership(patient_id, current_user, db)

    phone10 = ""
    for cand in (getattr(patient, "phone", None), getattr(current_user, "phone_number", None)):
        d = re.sub(r"\D", "", cand or "")[-10:]
        if len(d) == 10:
            phone10 = d
            break

    presc = (await db.execute(
        text(
            """
            SELECT * FROM nutrition_prescriptions
            WHERE pal_patient_id::text = :pid
               OR (:phone10 <> '' AND right(regexp_replace(coalesce(patient_phone,''), '\\D', '', 'g'), 10) = :phone10)
            ORDER BY is_current DESC NULLS LAST, coalesce(published_at, received_at) DESC
            LIMIT 1
            """
        ),
        {"pid": patient_id, "phone10": phone10},
    )).mappings().first()

    if not presc:
        return {"has_plan": False}

    pid = presc["id"]

    async def _rows(sql: str):
        return (await db.execute(text(sql), {"pid": pid})).mappings().all()

    menu_rows = await _rows(
        "SELECT day_number, day_label, feed_time, recipe_id, recipe_name, servings, "
        "energy_kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g, nutrients "
        "FROM nutrition_menu_items WHERE prescription_id = :pid "
        "ORDER BY day_number, id"
    )
    daytotal_rows = await _rows(
        "SELECT day_number, day_label, energy_kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g "
        "FROM nutrition_day_totals WHERE prescription_id = :pid ORDER BY day_number"
    )
    diagnosis_rows = await _rows(
        "SELECT code, description FROM nutrition_diagnoses WHERE prescription_id = :pid ORDER BY id"
    )
    instruction_rows = await _rows(
        "SELECT text, source FROM nutrition_instructions WHERE prescription_id = :pid ORDER BY id"
    )
    guidance_rows = await _rows(
        "SELECT kind, text, source FROM nutrition_guidance WHERE prescription_id = :pid ORDER BY id"
    )
    lab_rows = await _rows(
        "SELECT analyte, display_name, result, numeric_value, unit, flag, stale, age_days, collected_at "
        "FROM nutrition_labs WHERE prescription_id = :pid ORDER BY id"
    )
    checkin_rows = await _rows(
        "SELECT label, prompt, stream, frequency FROM nutrition_checkins WHERE prescription_id = :pid ORDER BY id"
    )

    # Group menu items by day, keyed by day_number, preserving order.
    totals_by_day = {r["day_number"]: r for r in daytotal_rows}
    days: dict = {}
    for r in menu_rows:
        dn = r["day_number"]
        if dn not in days:
            tot = totals_by_day.get(dn)
            days[dn] = {
                "day_number": dn,
                "day_label": r["day_label"],
                "totals": {
                    "energy_kcal": _num(tot["energy_kcal"]) if tot else None,
                    "protein_g": _num(tot["protein_g"]) if tot else None,
                    "carb_g": _num(tot["carb_g"]) if tot else None,
                    "fat_g": _num(tot["fat_g"]) if tot else None,
                    "fibre_g": _num(tot["fibre_g"]) if tot else None,
                    "sugar_g": _num(tot["sugar_g"]) if tot else None,
                } if tot else None,
                "items": [],
            }
        days[dn]["items"].append({
            "feed_time": r["feed_time"],
            "recipe_id": r["recipe_id"],
            "recipe_name": r["recipe_name"],
            "servings": _num(r["servings"]),
            "energy_kcal": _num(r["energy_kcal"]),
            "protein_g": _num(r["protein_g"]),
            "carb_g": _num(r["carb_g"]),
            "fat_g": _num(r["fat_g"]),
            "fibre_g": _num(r["fibre_g"]),
            "sugar_g": _num(r["sugar_g"]),
        })

    return {
        "has_plan": True,
        "prescription": {
            "id": presc["id"],
            "status": presc["status"],
            "version": presc["version"],
            "is_current": presc["is_current"],
            "dietitian_name": presc["dietitian_name"],
            "clinic_name": presc["clinic_name"],
            "issued_at": _iso(presc["published_at"]) or _iso(presc["created_at"]) or _iso(presc["received_at"]),
            "goal": {
                "label": presc["goal_label"],
                "direction": presc["goal_direction"],
                "summary": presc["goal_summary"],
            },
            "diet_pattern": presc["diet_pattern"],
            "cuisine": presc["cuisine"],
            "cycle_days": presc["cycle_days"],
            "targets": {
                "energy_kcal_min": _num(presc["energy_kcal_min"]),
                "energy_kcal_max": _num(presc["energy_kcal_max"]),
                "protein_g": _num(presc["protein_g"]),
                "carb_g": _num(presc["carb_g"]),
                "fat_g": _num(presc["fat_g"]),
            },
            "anthropometry": {
                "bmi": _num(presc["bmi"]),
                "bmi_status": presc["bmi_status"],
                "height_cm": _num(presc["height_cm"]),
                "weight_kg": _num(presc["weight_kg"]),
                "ree_kcal": _num(presc["ree_kcal"]),
            },
            "consultation_summary": presc["consultation_summary"],
            "followup": _jsonb(presc["followup"]),
            "diagnoses": [{"code": r["code"], "description": r["description"]} for r in diagnosis_rows],
            "days": list(days.values()),
            "instructions": [{"text": r["text"], "source": r["source"]} for r in instruction_rows],
            "guidance": [{"kind": r["kind"], "text": r["text"], "source": r["source"]} for r in guidance_rows],
            "labs": [{
                "analyte": r["analyte"],
                "display_name": r["display_name"],
                "result": r["result"],
                "numeric_value": _num(r["numeric_value"]),
                "unit": r["unit"],
                "flag": r["flag"],
                "stale": r["stale"],
                "age_days": r["age_days"],
                "collected_at": _iso(r["collected_at"]),
            } for r in lab_rows],
            "checkins": [{
                "label": r["label"],
                "prompt": r["prompt"],
                "stream": r["stream"],
                "frequency": r["frequency"],
            } for r in checkin_rows],
        },
    }
