"""
Clinical Webhook Processor - Enhanced Version
==============================================
Processes incoming clinical webhooks and stores data in the database.

Features:
- Idempotent processing (safe re-delivery)
- Transactional (all or nothing)
- Robust error handling
- Detailed logging
- Supports phone_user linking
- Handles partial data gracefully
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("webhook_processor")


# --------------------------------------------------------------------------
# Custom Errors
# --------------------------------------------------------------------------

class WebhookProcessingError(Exception):
    """Base error for webhook processing failures"""
    pass


class WebhookValidationError(WebhookProcessingError):
    """Raised when payload validation fails"""
    pass


# --------------------------------------------------------------------------
# Main Entry Point
# --------------------------------------------------------------------------

async def process_webhook(
    webhook_id: str,
    payload: Dict[str, Any],
    headers: Dict[str, Any],
    db: AsyncSession,
) -> Dict[str, Any]:
    """
    Process incoming webhook and store all data.

    Returns:
        Dict with processing results and entity IDs
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
        # Validate payload
        _validate_payload(payload)

        # Process entities in order (respecting foreign key dependencies)
        patient_id = await process_patient(payload.get("patient", {}), db)
        doctor_id = await process_doctor(payload.get("doctor", {}), db)
        clinic_id = await process_clinic(payload.get("clinic", {}), db)

        appointment_id = await process_appointment(
            payload.get("appointment", {}),
            patient_id,
            doctor_id,
            clinic_id,
            db
        )

        consultation_id = await process_consultation(
            payload.get("consultation", {}),
            appointment_id,
            doctor_id,
            db
        )

        clinical_output_id = await process_clinical_output(
            payload.get("clinical_output", {}),
            consultation_id,
            patient_id,
            db
        )

        prescription_ids = await process_prescriptions(
            payload.get("prescriptions", []),
            patient_id,
            appointment_id,
            consultation_id,
            db
        )

        document_ids = await process_documents(
            payload.get("documents", []),
            patient_id,
            appointment_id,
            db
        )

        # Mark webhook as processed
        await _mark_processed(webhook_id, payload_hash, patient_id, db)

        # Commit transaction
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
            "prescriptions_count": len(prescription_ids),
            "documents_count": len(document_ids),
        }

        logger.info(f"[Webhook] Success: {webhook_id} - Patient: {patient_id}")
        return result

    except WebhookValidationError as e:
        await db.rollback()
        await _mark_failed(webhook_id, payload_hash, str(e), db)
        logger.warning(f"[Webhook] Validation failed: {webhook_id} - {e}")
        raise

    except Exception as e:
        await db.rollback()
        await _mark_failed(webhook_id, payload_hash, str(e), db)
        logger.exception(f"[Webhook] Failed: {webhook_id}")
        raise WebhookProcessingError(f"Processing failed: {e}") from e


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def _validate_payload(payload: Dict[str, Any]) -> None:
    """Validate webhook payload has required fields"""
    if not isinstance(payload, dict):
        raise WebhookValidationError("Payload must be a JSON object")

    if not payload.get("event"):
        raise WebhookValidationError("Missing 'event' field")

    patient = payload.get("patient", {})
    if not patient:
        raise WebhookValidationError("Missing 'patient' data")

    if not patient.get("id") and not patient.get("phone"):
        raise WebhookValidationError("Patient must have 'id' or 'phone'")


# --------------------------------------------------------------------------
# Process Patient
# --------------------------------------------------------------------------

async def process_patient(data: Dict[str, Any], db: AsyncSession) -> Optional[UUID]:
    """Process and store patient data"""
    if not data:
        return None

    external_id = data.get("id")
    phone = data.get("phone")

    if not external_id and not phone:
        logger.warning("[Patient] Missing ID and phone, skipping")
        return None

    # Try to find existing patient by external_id
    patient_id = None
    if external_id:
        result = await db.execute(
            text("SELECT id FROM patients WHERE external_id = :ext_id LIMIT 1"),
            {"ext_id": str(external_id)}
        )
        row = result.fetchone()
        if row:
            patient_id = row[0]

    # If not found and phone provided, try by phone
    if not patient_id and phone:
        result = await db.execute(
            text("SELECT id FROM patients WHERE phone = :phone LIMIT 1"),
            {"phone": phone}
        )
        row = result.fetchone()
        if row:
            patient_id = row[0]

    # Parse emergency contact
    emergency_contact = data.get("emergencyContact")
    if emergency_contact and isinstance(emergency_contact, dict):
        emergency_contact_json = json.dumps(emergency_contact)
    else:
        emergency_contact_json = None

    # Prepare data
    fields = {
        "external_id": str(external_id) if external_id else None,
        "full_name": data.get("fullName"),
        "phone": phone,
        "email": data.get("email"),
        "date_of_birth": _parse_date(data.get("dateOfBirth")),
        "gender": data.get("gender"),
        "blood_group": data.get("bloodGroup"),
        "address": data.get("address"),
        "mrn": data.get("mrn"),
        "abha_id": data.get("abhaId"),
        "abha_address": data.get("abhaAddress"),
        "allergies": data.get("allergies"),
        "chronic_conditions": data.get("chronicConditions"),
        "current_medications": data.get("currentMedications"),
        "emergency_contact": emergency_contact_json,
        "photo_url": data.get("photoUrl"),
        "is_active": data.get("isActive", True),
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
# Process Doctor
# --------------------------------------------------------------------------

async def process_doctor(data: Dict[str, Any], db: AsyncSession) -> Optional[UUID]:
    """Process and store doctor data"""
    if not data or not data.get("id"):
        return None

    external_id = str(data["id"])

    # Find existing
    result = await db.execute(
        text("SELECT id FROM doctors WHERE external_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    doctor_id = row[0] if row else None

    fields = {
        "external_id": external_id,
        "full_name": data.get("fullName"),
        "email": data.get("email"),
        "phone": data.get("phone"),
        "specialization": data.get("specialization"),
        "license_number": data.get("licenseNumber"),
        "is_active": data.get("isActive", True),
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
# Process Clinic
# --------------------------------------------------------------------------

async def process_clinic(data: Dict[str, Any], db: AsyncSession) -> Optional[UUID]:
    """Process and store clinic data"""
    if not data or not data.get("id"):
        return None

    external_id = str(data["id"])

    # Find existing
    result = await db.execute(
        text("SELECT id FROM clinics WHERE external_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    clinic_id = row[0] if row else None

    fields = {
        "external_id": external_id,
        "name": data.get("name"),
        "address": data.get("address"),
        "phone": data.get("phone"),
        "email": data.get("email"),
        "is_active": data.get("isActive", True),
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
# Process Appointment
# --------------------------------------------------------------------------

async def process_appointment(
    data: Dict[str, Any],
    patient_id: Optional[UUID],
    doctor_id: Optional[UUID],
    clinic_id: Optional[UUID],
    db: AsyncSession
) -> Optional[UUID]:
    """Process and store appointment data"""
    if not data or not data.get("id") or not patient_id:
        return None

    external_id = str(data["id"])

    # Find existing
    result = await db.execute(
        text("SELECT id FROM appointments WHERE external_appointment_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    appointment_id = row[0] if row else None

    # Parse intake data
    intake = data.get("intake", {})
    intake_json = json.dumps(intake) if intake else None

    fields = {
        "external_appointment_id": external_id,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "clinic_id": clinic_id,
        "appointment_date": _parse_datetime(data.get("appointmentDate")),
        "slot_time": _parse_datetime(data.get("slotTime")),
        "duration_minutes": data.get("durationMinutes", 30),
        "type": data.get("type"),
        "status": data.get("status", "scheduled"),
        "reason_for_visit": data.get("reasonForVisit"),
        "chief_complaint": data.get("chiefComplaint"),
        "notes": data.get("notes"),
        "intake": intake_json,
        "doctor_name": data.get("doctorName"),
        "clinic_name": data.get("clinicName"),
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
# Process Consultation
# --------------------------------------------------------------------------

async def process_consultation(
    data: Dict[str, Any],
    appointment_id: Optional[UUID],
    doctor_id: Optional[UUID],
    db: AsyncSession
) -> Optional[UUID]:
    """Process and store consultation data"""
    if not data or not data.get("id"):
        return None

    external_id = str(data["id"])

    # Find existing
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
        "note_text": data.get("noteText"),
        "voice_transcript": data.get("voiceTranscript"),
        "status": data.get("status", "draft"),
        "finalised_at": _parse_datetime(data.get("finalisedAt")),
    }

    if consultation_id:
        # Update
        set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
        if set_clause:
            query = f"UPDATE consultations SET {set_clause}, updated_at = NOW() WHERE id = :consultation_id"
            fields["consultation_id"] = consultation_id
            await db.execute(text(query), fields)
        logger.info(f"[Consultation] Updated: {consultation_id}")
    else:
        # Insert
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
# Process Clinical Output
# --------------------------------------------------------------------------

async def process_clinical_output(
    data: Dict[str, Any],
    consultation_id: Optional[UUID],
    patient_id: Optional[UUID],
    db: AsyncSession
) -> Optional[UUID]:
    """Process and store clinical output data"""
    if not data or not data.get("id") or not patient_id:
        return None

    external_id = str(data["id"])

    # Find existing
    result = await db.execute(
        text("SELECT id FROM clinical_outputs WHERE external_id = :ext_id LIMIT 1"),
        {"ext_id": external_id}
    )
    row = result.fetchone()
    clinical_output_id = row[0] if row else None

    # Parse JSONB fields
    soap_note = json.dumps(data.get("soapNote", {}))
    icd_codes = json.dumps(data.get("icdCodes", []))
    snomed_codes = json.dumps(data.get("snomedCodes", []))
    recommendations = json.dumps(data.get("recommendations", []))

    fields = {
        "external_id": external_id,
        "consultation_id": consultation_id,
        "patient_id": patient_id,
        "soap_note": soap_note,
        "icd_codes": icd_codes,
        "snomed_codes": snomed_codes,
        "recommendations": recommendations,
    }

    if clinical_output_id:
        # Update
        set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
        if set_clause:
            query = f"UPDATE clinical_outputs SET {set_clause}, updated_at = NOW() WHERE id = :clinical_output_id"
            fields["clinical_output_id"] = clinical_output_id
            await db.execute(text(query), fields)
        logger.info(f"[ClinicalOutput] Updated: {clinical_output_id}")
    else:
        # Insert
        columns = ["id"] + [k for k, v in fields.items() if v is not None]
        values = ["gen_random_uuid()"] + [f":{k}" for k, v in fields.items() if v is not None]
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
# Process Prescriptions
# --------------------------------------------------------------------------

async def process_prescriptions(
    prescriptions: List[Dict[str, Any]],
    patient_id: Optional[UUID],
    appointment_id: Optional[UUID],
    consultation_id: Optional[UUID],
    db: AsyncSession
) -> List[UUID]:
    """Process and store prescriptions"""
    if not prescriptions or not patient_id:
        return []

    prescription_ids = []

    for presc_data in prescriptions:
        if not presc_data.get("id"):
            continue

        external_id = str(presc_data["id"])

        # Find existing
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
            "appointment_id": appointment_id,
            "consultation_id": consultation_id,
            "items": items,
            "interaction_acknowledged": presc_data.get("interactionAcknowledged", False),
            "refillable": presc_data.get("refillable", False),
            "refills_remaining": presc_data.get("refillsRemaining"),
            "pdf_url": presc_data.get("pdfUrl"),
            "shared_at": _parse_datetime(presc_data.get("sharedAt")),
        }

        if prescription_id:
            # Update
            set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
            if set_clause:
                query = f"UPDATE prescriptions SET {set_clause}, updated_at = NOW() WHERE id = :prescription_id"
                fields["prescription_id"] = prescription_id
                await db.execute(text(query), fields)
            logger.info(f"[Prescription] Updated: {prescription_id}")
        else:
            # Insert
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
# Process Documents
# --------------------------------------------------------------------------

async def process_documents(
    documents: List[Dict[str, Any]],
    patient_id: Optional[UUID],
    appointment_id: Optional[UUID],
    db: AsyncSession
) -> List[UUID]:
    """Process and store documents"""
    if not documents or not patient_id:
        return []

    document_ids = []

    for doc_data in documents:
        if not doc_data.get("id"):
            continue

        external_id = str(doc_data["id"])

        # Find existing
        result = await db.execute(
            text("SELECT id FROM patient_documents WHERE external_id = :ext_id LIMIT 1"),
            {"ext_id": external_id}
        )
        row = result.fetchone()
        document_id = row[0] if row else None

        # Serialize extracted data
        extracted_data = json.dumps(doc_data.get("extractedData", {}))

        fields = {
            "external_id": external_id,
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "kind": doc_data.get("kind"),
            "title": doc_data.get("title"),
            "file_name": doc_data.get("fileName"),
            "mime_type": doc_data.get("mimeType"),
            "file_path": doc_data.get("filePath"),
            "uploaded_at": _parse_datetime(doc_data.get("uploadedAt")),
            "extracted_data": extracted_data,
        }

        if document_id:
            # Update
            set_clause = ", ".join([f"{k} = :{k}" for k, v in fields.items() if v is not None])
            if set_clause:
                query = f"UPDATE patient_documents SET {set_clause}, updated_at = NOW() WHERE id = :document_id"
                fields["document_id"] = document_id
                await db.execute(text(query), fields)
            logger.info(f"[Document] Updated: {document_id}")
        else:
            # Insert
            columns = ["id"] + [k for k, v in fields.items() if v is not None]
            values = ["gen_random_uuid()"] + [f":{k}" for k, v in fields.items() if v is not None]
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


async def _mark_processed(
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


async def _mark_failed(
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
                "error": error[:2000]  # Limit error message length
            }
        )
        await db.commit()
    except Exception as e:
        logger.error(f"[Webhook] Failed to mark as failed: {e}")


# --------------------------------------------------------------------------
# Utility Functions
# --------------------------------------------------------------------------

def _parse_datetime(value: Any) -> Optional[datetime]:
    """Parse datetime from various formats"""
    if not value or value == "":
        return None

    if isinstance(value, datetime):
        return value

    if not isinstance(value, str):
        return None

    # Try common formats
    formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue

    logger.warning(f"[Webhook] Could not parse datetime: {value}")
    return None


def _parse_date(value: Any) -> Optional[str]:
    """Parse date and return as string in YYYY-MM-DD format"""
    dt = _parse_datetime(value)
    if dt:
        return dt.strftime("%Y-%m-%d")
    return None
