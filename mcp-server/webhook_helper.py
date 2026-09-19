"""
Clinical Webhook Processing Helper - Production Ready
====================================================
Processes incoming clinical webhooks and stores data in the database.

Works with existing database schema (no source_id columns required).
Uses external_id/external_appointment_id where available, creates new records otherwise.

Features:
- Idempotent processing (safe re-delivery via payload hashing)
- Transactional (all or nothing)
- Robust error handling
- Works with existing schema
- Handles partial data gracefully
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("webhook_helper")


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------

class WebhookProcessingError(Exception):
    """Raised for any failure while processing a webhook."""


class WebhookValidationError(WebhookProcessingError):
    """Raised when the payload is missing required fields."""


# --------------------------------------------------------------------------
# Entry point / orchestrator (transaction boundary lives here)
# --------------------------------------------------------------------------

async def process_webhook(
    webhook_id: str,
    payload: Dict[str, Any],
    headers: Dict[str, Any],
    db: AsyncSession,
) -> Dict[str, Any]:
    """
    Orchestrates processing of one clinical webhook.

    - Idempotent: re-delivering the same webhook_id + payload is a no-op.
    - Transactional: all entities commit together, or nothing does.
    - On failure: rolled back, webhook_events row marked failed.
    """
    event_name = payload.get("event", "unknown")
    payload_hash = _hash_payload(payload)

    logger.info(f"[Webhook] Processing: {webhook_id} - Event: {event_name}")

    # Check for duplicate
    is_duplicate = await _check_duplicate(webhook_id, payload_hash, db)
    if is_duplicate:
        logger.info(f"[Webhook] Duplicate detected: {webhook_id}")
        return {"success": True, "webhook_id": webhook_id, "duplicate": True}

    try:
        _validate_payload(payload)

        # Process phone_user first (for patient.phone_user_id and document.uploaded_by_id)
        phone_user_id = await process_phone_user(payload.get("patient") or {}, db)

        # Process clinic first to get UUID for patient/appointment lookups
        clinic_id = await process_clinic(payload.get("clinic") or {}, db)
        patient_id = await process_patient(payload.get("patient") or {}, clinic_id, phone_user_id, db)
        doctor_id = await process_doctor(payload.get("doctor") or {}, db)

        appointment_id = await process_appointment(
            payload.get("appointment") or {}, patient_id, doctor_id, clinic_id, db
        )

        consultation_id = await process_consultation(
            payload.get("consultation") or {}, appointment_id, doctor_id, db
        )

        clinical_output_id = await process_clinical_output(
            payload.get("clinical_output") or {}, consultation_id, patient_id, db
        )

        prescription_ids = await process_prescriptions(
            payload.get("prescriptions") or [], patient_id, appointment_id, consultation_id, db
        )

        document_ids = await process_documents(
            payload.get("documents") or [], patient_id, appointment_id, clinic_id, phone_user_id, db
        )

        await _mark_webhook_processed(webhook_id, payload_hash, patient_id, db)

        await db.commit()

        result = {
            "success": True,
            "webhook_id": webhook_id,
            "event": event_name,
            "patient_id": str(patient_id) if patient_id else None,
            "doctor_id": str(doctor_id) if doctor_id else None,
            "clinic_id": str(clinic_id) if clinic_id else None,
            "appointment_id": str(appointment_id) if appointment_id else None,
            "consultation_id": str(consultation_id) if consultation_id else None,
            "clinical_output_id": str(clinical_output_id) if clinical_output_id else None,
            "prescriptions_processed": len(prescription_ids),
            "documents_processed": len(document_ids),
        }
        logger.info(f"[Webhook] Success: {webhook_id}")
        return result

    except WebhookValidationError as exc:
        await db.rollback()
        await _mark_webhook_failed(webhook_id, payload_hash, str(exc), db)
        logger.warning(f"[Webhook] Validation failed: {webhook_id} - {exc}")
        raise

    except Exception as exc:
        await db.rollback()
        await _mark_webhook_failed(webhook_id, payload_hash, str(exc), db)
        logger.exception(f"[Webhook] Failed: {webhook_id}")
        raise WebhookProcessingError(f"Processing failed: {exc}") from exc


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def _validate_payload(payload: Dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise WebhookValidationError("Payload must be a JSON object")

    if not payload.get("event"):
        raise WebhookValidationError("Missing 'event' in payload")

    patient = payload.get("patient")
    if not patient or not patient.get("id"):
        raise WebhookValidationError("Missing patient.id in payload")


# --------------------------------------------------------------------------
# process_phone_user
# --------------------------------------------------------------------------

async def process_phone_user(patient_data: Dict[str, Any], db: AsyncSession) -> Optional[UUID]:
    """Process and store phone_user from patient phone number"""
    phone = patient_data.get("phone")
    if not phone:
        return None

    # Clean phone number (remove + and country code if present)
    phone_clean = phone.replace("+", "").replace("-", "").replace(" ", "")

    # Extract country code (default to 91 for India)
    country_code = "91"
    phone_number = phone_clean

    if phone_clean.startswith("91") and len(phone_clean) > 10:
        country_code = "91"
        phone_number = phone_clean[2:]  # Remove country code
    elif len(phone_clean) == 10:
        phone_number = phone_clean
    else:
        # Keep full number if format is unclear
        phone_number = phone_clean[-10:]  # Last 10 digits

    # Find existing by phone_number
    result = await db.execute(
        text("SELECT id FROM phone_users WHERE phone_number = :phone LIMIT 1"),
        {"phone": phone_number}
    )
    row = result.fetchone()
    phone_user_id = row[0] if row else None

    if phone_user_id:
        logger.info(f"[PhoneUser] Found existing: {phone_user_id}")
        return phone_user_id

    # Create new phone_user
    external_id = patient_data.get("id")  # Use patient's external_id

    query = """
        INSERT INTO phone_users (id, external_id, phone_number, country_code, is_verified, is_active)
        VALUES (gen_random_uuid(), :external_id, :phone_number, :country_code, :is_verified, :is_active)
        RETURNING id
    """
    result = await db.execute(
        text(query),
        {
            "external_id": str(external_id) if external_id else None,
            "phone_number": phone_number,
            "country_code": country_code,
            "is_verified": True,  # Assume verified from external system
            "is_active": True,
        }
    )
    row = result.fetchone()
    phone_user_id = row[0] if row else None
    logger.info(f"[PhoneUser] Created: {phone_user_id} ({country_code} {phone_number})")

    await db.flush()
    return phone_user_id


# --------------------------------------------------------------------------
# process_patient
# --------------------------------------------------------------------------

async def process_patient(patient_data: Dict[str, Any], clinic_id: Optional[UUID], phone_user_id: Optional[UUID], db: AsyncSession) -> Optional[UUID]:
    """Process and store patient data"""
    if not patient_data.get("id"):
        return None

    external_id = str(patient_data["id"])

    # Try to find by external_id first
    patient_id = None
    result = await db.execute(
        text("SELECT id FROM patients WHERE external_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    if row:
        patient_id = row[0]

    # If not found by external_id, try phone (most reliable identifier)
    phone = patient_data.get("phone")
    if not patient_id and phone:
        result = await db.execute(
            text("SELECT id FROM patients WHERE phone = :phone LIMIT 1"),
            {"phone": phone}
        )
        row = result.fetchone()
        if row:
            patient_id = row[0]

    # If not found by phone and has MRN + clinic UUID, try that
    if not patient_id and patient_data.get("mrn") and clinic_id:
        result = await db.execute(
            text("SELECT id FROM patients WHERE mrn = :mrn AND clinic_id = :clinic_id LIMIT 1"),
            {"mrn": patient_data["mrn"], "clinic_id": clinic_id}
        )
        row = result.fetchone()
        if row:
            patient_id = row[0]

    # Parse emergency contact
    emergency_contact = patient_data.get("emergencyContact")
    if emergency_contact and isinstance(emergency_contact, dict):
        emergency_contact_json = json.dumps(emergency_contact)
    else:
        emergency_contact_json = None

    # Prepare data - serialize array fields as JSON
    allergies = patient_data.get("allergies")
    allergies_json = json.dumps(allergies) if isinstance(allergies, list) else allergies

    chronic_conditions = patient_data.get("chronicConditions")
    chronic_conditions_json = json.dumps(chronic_conditions) if isinstance(chronic_conditions, list) else chronic_conditions

    current_medications = patient_data.get("currentMedications")
    current_medications_json = json.dumps(current_medications) if isinstance(current_medications, list) else current_medications

    fields = {
        "external_id": external_id,
        "clinic_id": clinic_id,
        "phone_user_id": phone_user_id,
        "mrn": patient_data.get("mrn"),
        "abha_id": patient_data.get("abhaId"),
        "abha_address": patient_data.get("abhaAddress"),
        "full_name": patient_data.get("fullName"),
        "date_of_birth": _parse_date(patient_data.get("dateOfBirth")),
        "gender": patient_data.get("gender"),
        "phone": phone,
        "email": patient_data.get("email"),
        "blood_group": patient_data.get("bloodGroup"),
        "address": patient_data.get("address"),
        "allergies": allergies_json,
        "chronic_conditions": chronic_conditions_json,
        "current_medications": current_medications_json,
        "emergency_contact": emergency_contact_json,
        "photo_url": patient_data.get("photoUrl"),
        "is_active": patient_data.get("isActive", True),
    }

    if patient_id:
        # Update existing
        set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
        if set_clause:
            query = f"UPDATE patients SET {set_clause}, updated_at = NOW() WHERE id = :patient_id"
            fields["patient_id"] = patient_id
            await db.execute(text(query), fields)
        logger.info(f"[Patient] Updated: {patient_id}")
    else:
        # Insert new
        columns = ["id"] + [k for k, v in fields.items() if v is not None]
        values = ["gen_random_uuid()"] + [f":{k}" for k, v in fields.items() if v is not None]
        query = f"""
            INSERT INTO patients ({', '.join(columns)})
            VALUES ({', '.join(values)})
            RETURNING id
        """
        result = await db.execute(text(query), {k: v for k, v in fields.items() if v is not None})
        row = result.fetchone()
        patient_id = row[0] if row else None
        logger.info(f"[Patient] Created: {patient_id}")

    await db.flush()
    return patient_id


# --------------------------------------------------------------------------
# process_doctor
# --------------------------------------------------------------------------

async def process_doctor(doctor_data: Dict[str, Any], db: AsyncSession) -> Optional[UUID]:
    """Process and store doctor data"""
    if not doctor_data.get("id"):
        return None

    external_id = str(doctor_data["id"])

    # Find existing by external_id
    result = await db.execute(
        text("SELECT id FROM doctors WHERE external_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    doctor_id = row[0] if row else None

    fields = {
        "external_id": external_id,
        "full_name": doctor_data.get("fullName"),
        "email": doctor_data.get("email"),
        "phone": doctor_data.get("phone"),
        "specialization": doctor_data.get("specialization"),
        "license_number": doctor_data.get("licenseNumber"),
        "is_active": doctor_data.get("isActive", True),
    }

    if doctor_id:
        # Update
        set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
        if set_clause:
            query = f"UPDATE doctors SET {set_clause}, updated_at = NOW() WHERE id = :doctor_id"
            fields["doctor_id"] = doctor_id
            await db.execute(text(query), fields)
        logger.info(f"[Doctor] Updated: {doctor_id}")
    else:
        # Insert
        columns = ["id"] + [k for k, v in fields.items() if v is not None]
        values = ["gen_random_uuid()"] + [f":{k}" for k, v in fields.items() if v is not None]
        query = f"""
            INSERT INTO doctors ({', '.join(columns)})
            VALUES ({', '.join(values)})
            RETURNING id
        """
        result = await db.execute(text(query), {k: v for k, v in fields.items() if v is not None})
        row = result.fetchone()
        doctor_id = row[0] if row else None
        logger.info(f"[Doctor] Created: {doctor_id}")

    await db.flush()
    return doctor_id


# --------------------------------------------------------------------------
# process_clinic
# --------------------------------------------------------------------------

async def process_clinic(clinic_data: Dict[str, Any], db: AsyncSession) -> Optional[UUID]:
    """Process and store clinic data"""
    if not clinic_data.get("id"):
        return None

    external_id = str(clinic_data["id"])

    # Try to find by external_id first
    clinic_id = None
    result = await db.execute(
        text("SELECT id FROM clinics WHERE external_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    if row:
        clinic_id = row[0]

    # If not found by external_id, try name
    name = clinic_data.get("name")
    if not clinic_id and name:
        result = await db.execute(
            text("SELECT id FROM clinics WHERE name = :name LIMIT 1"),
            {"name": name}
        )
        row = result.fetchone()
        if row:
            clinic_id = row[0]

    fields = {
        "external_id": external_id,
        "name": name,
        "address": clinic_data.get("address"),
        "phone": clinic_data.get("phone"),
        "email": clinic_data.get("email"),
        "is_active": clinic_data.get("isActive", True),
    }

    if clinic_id:
        # Update
        set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
        if set_clause:
            query = f"UPDATE clinics SET {set_clause}, updated_at = NOW() WHERE id = :clinic_id"
            fields["clinic_id"] = clinic_id
            await db.execute(text(query), fields)
        logger.info(f"[Clinic] Updated: {clinic_id}")
    else:
        # Insert
        columns = ["id"] + [k for k, v in fields.items() if v is not None]
        values = ["gen_random_uuid()"] + [f":{k}" for k, v in fields.items() if v is not None]
        query = f"""
            INSERT INTO clinics ({', '.join(columns)})
            VALUES ({', '.join(values)})
            RETURNING id
        """
        result = await db.execute(text(query), {k: v for k, v in fields.items() if v is not None})
        row = result.fetchone()
        clinic_id = row[0] if row else None
        logger.info(f"[Clinic] Created: {clinic_id}")

    await db.flush()
    return clinic_id


# --------------------------------------------------------------------------
# process_appointment
# --------------------------------------------------------------------------

async def process_appointment(
    appt_data: Dict[str, Any],
    patient_id: Optional[UUID],
    doctor_id: Optional[UUID],
    clinic_id: Optional[UUID],
    db: AsyncSession
) -> Optional[UUID]:
    """Process and store appointment data"""
    if not appt_data.get("id") or not patient_id:
        return None

    external_id = str(appt_data["id"])

    # Find existing by external_appointment_id
    result = await db.execute(
        text("SELECT id FROM appointments WHERE external_appointment_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    appointment_id = row[0] if row else None

    # Parse intake data
    intake = appt_data.get("intake", {})
    intake_json = json.dumps(intake) if intake else None

    fields = {
        "external_appointment_id": external_id,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "clinic_id": clinic_id,
        "appointment_date": _parse_datetime(appt_data.get("slotTime")),
        "slot_time": _parse_datetime(appt_data.get("slotTime")),
        "duration_minutes": appt_data.get("durationMinutes", 30),
        "type": appt_data.get("type"),
        "status": appt_data.get("status", "scheduled"),
        "reason_for_visit": appt_data.get("reasonForVisit"),
        "chief_complaint": appt_data.get("chiefComplaint"),
        "notes": appt_data.get("notes"),
        "intake": intake_json,
        "doctor_name": appt_data.get("doctorName"),
        "clinic_name": appt_data.get("clinicName"),
    }

    if appointment_id:
        # Update
        set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
        if set_clause:
            query = f"UPDATE appointments SET {set_clause}, updated_at = NOW() WHERE id = :appointment_id"
            fields["appointment_id"] = appointment_id
            await db.execute(text(query), fields)
        logger.info(f"[Appointment] Updated: {appointment_id}")
    else:
        # Insert
        columns = ["id"] + [k for k, v in fields.items() if v is not None]
        values = ["gen_random_uuid()"] + [f":{k}" for k, v in fields.items() if v is not None]
        query = f"""
            INSERT INTO appointments ({', '.join(columns)})
            VALUES ({', '.join(values)})
            RETURNING id
        """
        result = await db.execute(text(query), {k: v for k, v in fields.items() if v is not None})
        row = result.fetchone()
        appointment_id = row[0] if row else None
        logger.info(f"[Appointment] Created: {appointment_id}")

    await db.flush()
    return appointment_id


# --------------------------------------------------------------------------
# process_consultation
# --------------------------------------------------------------------------

async def process_consultation(
    consult_data: Dict[str, Any],
    appointment_id: Optional[UUID],
    doctor_id: Optional[UUID],
    db: AsyncSession
) -> Optional[UUID]:
    """Process and store consultation data"""
    if not consult_data.get("id"):
        return None

    external_id = str(consult_data["id"])

    # Find existing by external_id
    result = await db.execute(
        text("SELECT id FROM consultations WHERE external_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    consultation_id = row[0] if row else None

    fields = {
        "external_id": external_id,
        "appointment_id": appointment_id,
        "doctor_id": doctor_id,
        "note_text": consult_data.get("noteText"),
        "voice_transcript": consult_data.get("voiceTranscript"),
        "status": consult_data.get("status", "in_progress"),
        "finished_at": _parse_datetime(consult_data.get("finalisedAt")),
    }

    if consultation_id:
        # Update existing
        set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
        if set_clause:
            query = f"UPDATE consultations SET {set_clause}, updated_at = NOW() WHERE id = :consultation_id"
            fields["consultation_id"] = consultation_id
            await db.execute(text(query), fields)
        logger.info(f"[Consultation] Updated: {consultation_id}")
    else:
        # Insert new
        columns = ["id"] + [k for k, v in fields.items() if v is not None]
        values = ["gen_random_uuid()"] + [f":{k}" for k, v in fields.items() if v is not None]
        query = f"""
            INSERT INTO consultations ({', '.join(columns)})
            VALUES ({', '.join(values)})
            RETURNING id
        """
        result = await db.execute(text(query), {k: v for k, v in fields.items() if v is not None})
        row = result.fetchone()
        consultation_id = row[0] if row else None
        logger.info(f"[Consultation] Created: {consultation_id}")

    await db.flush()
    return consultation_id


# --------------------------------------------------------------------------
# process_clinical_output
# --------------------------------------------------------------------------

async def process_clinical_output(
    co_data: Dict[str, Any],
    consultation_id: Optional[UUID],
    patient_id: Optional[UUID],
    db: AsyncSession
) -> Optional[UUID]:
    """Process and store clinical output data"""
    if not co_data.get("id") or not patient_id:
        return None

    external_id = str(co_data["id"])

    # Find existing by external_id
    result = await db.execute(
        text("SELECT id FROM clinical_outputs WHERE external_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    clinical_output_id = row[0] if row else None

    # Parse JSONB fields
    soap_note_data = co_data.get("soapNote", {})
    soap_note = json.dumps(soap_note_data) if isinstance(soap_note_data, dict) else soap_note_data

    icd_codes = json.dumps(co_data.get("icdCodes", []))
    snomed_codes = json.dumps(co_data.get("snomedCodes", []))
    recommendations = json.dumps(co_data.get("recommendations", []))

    fields = {
        "external_id": external_id,
        "consultation_id": consultation_id,
        "soap_note": soap_note,
        "icd_codes": icd_codes,
        "snomed_codes": snomed_codes,
        "management_plan": recommendations,
    }

    if clinical_output_id:
        # Update existing
        set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
        if set_clause:
            query = f"UPDATE clinical_outputs SET {set_clause}, processed_at = NOW() WHERE id = :clinical_output_id"
            fields["clinical_output_id"] = clinical_output_id
            await db.execute(text(query), fields)
        logger.info(f"[ClinicalOutput] Updated: {clinical_output_id}")
    else:
        # Insert new - add processed_at as required NOT NULL field
        columns = ["id", "processed_at"] + [k for k, v in fields.items() if v is not None]
        values = ["gen_random_uuid()", "NOW()"] + [f":{k}" for k, v in fields.items() if v is not None]
        query = f"""
            INSERT INTO clinical_outputs ({', '.join(columns)})
            VALUES ({', '.join(values)})
            RETURNING id
        """
        result = await db.execute(text(query), {k: v for k, v in fields.items() if v is not None})
        row = result.fetchone()
        clinical_output_id = row[0] if row else None
        logger.info(f"[ClinicalOutput] Created: {clinical_output_id}")

    await db.flush()
    return clinical_output_id


# --------------------------------------------------------------------------
# process_prescriptions
# --------------------------------------------------------------------------

async def process_prescriptions(
    prescriptions_data: List[Dict[str, Any]],
    patient_id: Optional[UUID],
    appointment_id: Optional[UUID],
    consultation_id: Optional[UUID],
    db: AsyncSession
) -> List[UUID]:
    """Process and store prescriptions"""
    if not prescriptions_data or not patient_id:
        return []

    prescription_ids = []

    for presc_data in prescriptions_data:
        if not presc_data.get("id"):
            continue

        external_id = str(presc_data["id"])

        # Find existing by external_id
        result = await db.execute(
            text("SELECT id FROM prescriptions WHERE external_id = :ext_id LIMIT 1"),
            {"ext_id": external_id}
        )
        row = result.fetchone()
        prescription_id = row[0] if row else None

        # Serialize items
        items = json.dumps(presc_data.get("items", []))

        fields = {
            "external_id": external_id,
            "patient_id": patient_id,
            "consultation_id": consultation_id,
            "items": items,
            "interaction_acknowledged": presc_data.get("interactionAcknowledged", False),
            "refillable": presc_data.get("refillable", False),
            "refills_remaining": presc_data.get("refillsRemaining", 0),
            "pdf_url": presc_data.get("pdfUrl"),
            "shared_at": _parse_datetime(presc_data.get("sharedAt")),
        }

        if prescription_id:
            # Update existing
            set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
            if set_clause:
                query = f"UPDATE prescriptions SET {set_clause}, updated_at = NOW() WHERE id = :prescription_id"
                fields["prescription_id"] = prescription_id
                await db.execute(text(query), fields)
            logger.info(f"[Prescription] Updated: {prescription_id}")
        else:
            # Insert new
            columns = ["id"] + [k for k, v in fields.items() if v is not None]
            values = ["gen_random_uuid()"] + [f":{k}" for k, v in fields.items() if v is not None]
            query = f"""
                INSERT INTO prescriptions ({', '.join(columns)})
                VALUES ({', '.join(values)})
                RETURNING id
            """
            result = await db.execute(text(query), {k: v for k, v in fields.items() if v is not None})
            row = result.fetchone()
            prescription_id = row[0] if row else None
            logger.info(f"[Prescription] Created: {prescription_id}")

        if prescription_id:
            prescription_ids.append(prescription_id)

    await db.flush()
    return prescription_ids


# --------------------------------------------------------------------------
# process_documents
# --------------------------------------------------------------------------

async def process_documents(
    documents_data: List[Dict[str, Any]],
    patient_id: Optional[UUID],
    appointment_id: Optional[UUID],
    clinic_id: Optional[UUID],
    uploaded_by_id: Optional[UUID],
    db: AsyncSession
) -> List[UUID]:
    """Process and store documents"""
    if not documents_data or not patient_id:
        return []

    document_ids = []

    for doc_data in documents_data:
        if not doc_data.get("id"):
            continue

        external_id = str(doc_data["id"])

        # Find existing by external_id
        result = await db.execute(
            text("SELECT id FROM patient_documents WHERE external_id = :ext_id LIMIT 1"),
            {"ext_id": external_id}
        )
        row = result.fetchone()
        document_id = row[0] if row else None

        fields = {
            "external_id": external_id,
            "patient_id": patient_id,
            "clinic_id": clinic_id,
            "uploaded_by_id": uploaded_by_id,
            "kind": doc_data.get("kind"),
            "title": doc_data.get("title"),
            "file_name": doc_data.get("fileName"),
            "mime_type": doc_data.get("mimeType"),
            "data_url": doc_data.get("pdfUrl"),  # Map pdfUrl to data_url
        }

        if document_id:
            # Update existing - no updated_at column in patient_documents
            set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
            if set_clause:
                query = f"UPDATE patient_documents SET {set_clause} WHERE id = :document_id"
                fields["document_id"] = document_id
                await db.execute(text(query), fields)
            logger.info(f"[Document] Updated: {document_id}")
        else:
            # Insert new - add created_at as required NOT NULL field
            columns = ["id", "created_at"] + [k for k, v in fields.items() if v is not None]
            values = ["gen_random_uuid()", "NOW()"] + [f":{k}" for k, v in fields.items() if v is not None]
            query = f"""
                INSERT INTO patient_documents ({', '.join(columns)})
                VALUES ({', '.join(values)})
                RETURNING id
            """
            result = await db.execute(text(query), {k: v for k, v in fields.items() if v is not None})
            row = result.fetchone()
            document_id = row[0] if row else None
            logger.info(f"[Document] Created: {document_id}")

        if document_id:
            document_ids.append(document_id)

    await db.flush()
    return document_ids


# --------------------------------------------------------------------------
# Webhook Event Tracking
# --------------------------------------------------------------------------

def _hash_payload(payload: Dict[str, Any]) -> str:
    """Generate hash of payload for idempotency"""
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _check_duplicate(webhook_id: str, payload_hash: str, db: AsyncSession) -> bool:
    """Check if webhook was already processed"""
    result = await db.execute(
        text("""
            SELECT processed, payload_hash
            FROM webhook_events
            WHERE id = :webhook_id
        """),
        {"webhook_id": webhook_id}
    )
    row = result.fetchone()
    if row and row[0] and row[1] == payload_hash:
        return True
    return False


async def _mark_webhook_processed(
    webhook_id: str,
    payload_hash: str,
    patient_id: Optional[UUID],
    db: AsyncSession
) -> None:
    """Mark webhook as successfully processed"""
    await db.execute(
        text("""
            UPDATE webhook_events
            SET processed = true,
                processed_at = NOW(),
                payload_hash = :hash,
                patient_id = :patient_id,
                error_message = NULL,
                updated_at = NOW()
            WHERE id = :webhook_id
        """),
        {
            "webhook_id": webhook_id,
            "hash": payload_hash,
            "patient_id": patient_id
        }
    )
    await db.flush()


async def _mark_webhook_failed(
    webhook_id: str,
    payload_hash: str,
    error: str,
    db: AsyncSession
) -> None:
    """Mark webhook as failed"""
    try:
        await db.execute(
            text("""
                UPDATE webhook_events
                SET processed = false,
                    payload_hash = :hash,
                    error_message = :error,
                    updated_at = NOW()
                WHERE id = :webhook_id
            """),
            {
                "webhook_id": webhook_id,
                "hash": payload_hash,
                "error": error[:2000]
            }
        )
        await db.commit()
    except Exception as e:
        logger.error(f"[Webhook] Failed to mark as failed: {e}")


# --------------------------------------------------------------------------
# Utility Functions
# --------------------------------------------------------------------------

_DATE_FORMATS = (
    "%Y-%m-%dT%H:%M:%S.%fZ",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
)


def _parse_datetime(value: Any) -> Optional[datetime]:
    """Parse datetime from various formats"""
    if not value or value == "":
        return None

    if isinstance(value, datetime):
        return value

    if not isinstance(value, str):
        return None

    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue

    logger.warning(f"[Webhook] Could not parse datetime: {value}")
    return None


def _parse_date(value: Any):
    """Parse date and return as date object"""
    from datetime import date

    if not value or value == "":
        return None

    if isinstance(value, date):
        return value

    dt = _parse_datetime(value)
    if dt:
        return dt.date()
    return None
