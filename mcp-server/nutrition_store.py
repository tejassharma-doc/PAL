"""
Parse an iNutriMon `nutrition_prescription.published` webhook payload and store it
in the relational nutrition tables (see create_nutrition_tables.py). The raw event
is still saved to webhook_events separately; this adds the queryable projection.

Idempotent per handover id: re-publishing the same id replaces its rows (children
cascade-delete via the FK). Best-effort — callers should guard with try/except so a
projection failure never fails the webhook ack.
"""
import json
from datetime import datetime, timezone
from typing import Any, Optional


def _num(x: Any) -> Optional[float]:
    try:
        if x is None or x == "":
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


def _int(x: Any) -> Optional[int]:
    v = _num(x)
    return int(v) if v is not None else None


def _dt(x: Any) -> Optional[datetime]:
    if not x or not isinstance(x, str):
        return None
    s = x.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _jsonb(x: Any) -> Optional[str]:
    return None if x is None else json.dumps(x)


async def _resolve_pal_patient_id(conn, phone: Optional[str]) -> Optional[str]:
    """Best-effort: match the iNutriMon phone (e.g. 917766554433) to a PAL patient
    by its last 10 digits. Never raises."""
    if not phone:
        return None
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) < 10:
        return None
    last10 = digits[-10:]
    try:
        row = await conn.fetchrow(
            "SELECT id FROM patients "
            "WHERE regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE '%' || $1 "
            "LIMIT 1",
            last10,
        )
        return str(row["id"]) if row else None
    except Exception:
        return None


async def store_nutrition_prescription(conn, payload: dict) -> Optional[str]:
    """Project a nutrition_prescription.published payload into the nutrition tables.
    Returns the stored prescription (handover) id, or None if the payload isn't a
    nutrition prescription."""
    if not isinstance(payload, dict):
        return None

    handover = payload.get("handover") or {}
    presc = payload.get("nutritionPrescription") or {}
    patient = payload.get("patient") or {}
    clinic = payload.get("clinic") or {}
    dietitian = payload.get("dietitian") or {}
    assessment = payload.get("nutritionAssessment") or {}

    pid = handover.get("id") or payload.get("eventId") or presc.get("id")
    if not pid:
        return None  # not a shape we store

    hpayload = handover.get("payload") or {}
    targets = presc.get("targets") or {}
    anth = targets.get("anthropometry") or {}
    energy = (targets.get("targets") or {}).get("energyKcal") or {}
    macro = {m.get("key"): m.get("grams") for m in (targets.get("macroTargets") or [])}
    goal = assessment.get("goal") or hpayload.get("goal") or {}
    capture = assessment.get("capture") or {}
    menu = presc.get("menu") or {}

    diet_pattern = presc.get("dietaryPattern") or assessment.get("dietaryPattern") or handover.get("dietaryPattern")
    instructions = menu.get("instructions") or hpayload.get("instructions") or []
    guidance = presc.get("guidance") or hpayload.get("guidance") or []
    labs = (presc.get("labs") or {}).get("markers") or []
    checkins = hpayload.get("checkIns") or []
    diagnoses = assessment.get("diagnoses") or []

    pal_patient_id = await _resolve_pal_patient_id(conn, patient.get("phone"))

    async with conn.transaction():
        # Replace any prior version of this handover id (children cascade).
        await conn.execute("DELETE FROM nutrition_prescriptions WHERE id = $1", pid)

        await conn.execute(
            """
            INSERT INTO nutrition_prescriptions (
                id, event, event_id, prescription_id, assessment_id, version, status,
                is_current, supersedes_id,
                inutrimon_patient_id, patient_mrn, patient_name, patient_phone, patient_dob,
                patient_gender, pal_patient_id,
                clinic_id, clinic_name, dietitian_id, dietitian_name,
                goal_label, goal_direction, goal_summary,
                diet_pattern, cuisine, cycle_days,
                energy_kcal_min, energy_kcal_max, protein_g, carb_g, fat_g,
                bmi, bmi_status, height_cm, weight_kg, ree_kcal,
                consultation_summary, followup, diet_instructions,
                approved_at, published_at, created_at, updated_at, raw_payload
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,
                $8,$9,
                $10,$11,$12,$13,$14,
                $15,$16,
                $17,$18,$19,$20,
                $21,$22,$23,
                $24,$25,$26,
                $27,$28,$29,$30,$31,
                $32,$33,$34,$35,$36,
                $37,$38::jsonb,$39::jsonb,
                $40,$41,$42,$43,$44::jsonb
            )
            """,
            pid, payload.get("event"), payload.get("eventId"), presc.get("id"), presc.get("assessmentId"),
            _int(presc.get("version") or handover.get("version")), presc.get("status"),
            handover.get("isCurrent"), handover.get("supersedesId"),
            patient.get("id"), patient.get("mrn"), patient.get("fullName"), patient.get("phone"), _dt(patient.get("dateOfBirth")),
            patient.get("gender"), pal_patient_id,
            clinic.get("id"), clinic.get("name"), dietitian.get("id"), dietitian.get("fullName"),
            goal.get("label"), goal.get("direction"), goal.get("summary"),
            diet_pattern, menu.get("cuisine"), _int(menu.get("cycleDays")),
            _num(energy.get("min")), _num(energy.get("max")), _num(macro.get("proteinG")), _num(macro.get("carbG")), _num(macro.get("fatG")),
            _num(anth.get("bmi")), anth.get("bmiStatus"), _num(anth.get("heightCm")), _num(anth.get("measuredWeightKg") or assessment.get("weightKg")), _num(anth.get("reeKcal")),
            capture.get("consultationSummary"), _jsonb(hpayload.get("followUp")), _jsonb(instructions),
            _dt(presc.get("approvedAt")), _dt(handover.get("publishedAt")), _dt(presc.get("createdAt")), _dt(presc.get("updatedAt")), _jsonb(payload),
        )

        for d in diagnoses:
            await conn.execute(
                "INSERT INTO nutrition_diagnoses (prescription_id, code, description) VALUES ($1,$2,$3)",
                pid, d.get("code"), d.get("description"),
            )

        for day in menu.get("days") or []:
            dn = _int(day.get("day"))
            dl = day.get("label")
            for item in day.get("menu") or []:
                n = item.get("nutrients") or {}
                await conn.execute(
                    """INSERT INTO nutrition_menu_items (
                        prescription_id, day_number, day_label, feed_time, recipe_id, recipe_name,
                        servings, energy_kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g, nutrients
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)""",
                    pid, dn, dl, item.get("feedTime"), item.get("recipeId"), item.get("recipeName"),
                    _num(item.get("servings")), _num(n.get("energyKcal")), _num(n.get("proteinG")),
                    _num(n.get("carbG")), _num(n.get("fatG")), _num(n.get("fibreG")), _num(n.get("sugarG")), _jsonb(n),
                )
            dt_tot = day.get("dayTotals") or {}
            if dt_tot:
                await conn.execute(
                    """INSERT INTO nutrition_day_totals (
                        prescription_id, day_number, day_label, energy_kcal, protein_g, carb_g,
                        fat_g, fibre_g, sugar_g, totals
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)""",
                    pid, dn, dl, _num(dt_tot.get("energyKcal")), _num(dt_tot.get("proteinG")),
                    _num(dt_tot.get("carbG")), _num(dt_tot.get("fatG")), _num(dt_tot.get("fibreG")),
                    _num(dt_tot.get("sugarG")), _jsonb(dt_tot),
                )

        for ins in instructions:
            await conn.execute(
                "INSERT INTO nutrition_instructions (prescription_id, text, source) VALUES ($1,$2,$3)",
                pid, ins.get("text"), ins.get("source"),
            )

        for g in guidance:
            await conn.execute(
                "INSERT INTO nutrition_guidance (prescription_id, kind, text, source) VALUES ($1,$2,$3,$4)",
                pid, g.get("kind"), g.get("text"), g.get("source"),
            )

        for lab in labs:
            await conn.execute(
                """INSERT INTO nutrition_labs (
                    prescription_id, analyte, display_name, result, numeric_value, unit,
                    flag, stale, age_days, collected_at, relevance
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)""",
                pid, lab.get("analyte"), lab.get("displayName"), lab.get("result"), _num(lab.get("numeric")),
                lab.get("unit"), lab.get("flag"), lab.get("stale"), _int(lab.get("ageDays")),
                _dt(lab.get("collectedAt")), _jsonb(lab.get("relevance")),
            )

        for c in checkins:
            await conn.execute(
                "INSERT INTO nutrition_checkins (prescription_id, label, prompt, stream, frequency) VALUES ($1,$2,$3,$4,$5)",
                pid, c.get("label"), c.get("prompt"), c.get("stream"), c.get("frequency"),
            )

    return pid
