"""
Clinical Output Webhook Processor
Handles clinical_output_created events from external systems
"""
import json
from typing import Dict, Any, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
import uuid

from models_minimal import PhoneUser, Patient, Appointment, UserPatientLink, Doctor


class ClinicalOutputProcessingError(Exception):
    """Custom exception for clinical output processing errors"""
    pass


async def process_clinical_output_webhook(
    webhook_id: str,
    payload: Dict[str, Any],
    db: AsyncSession
) -> Dict[str, Any]:
    """
    Process clinical_output_created webhook.

    Stores data in the following order:
    1. Phone users (for patient phone)
    2. Clinics
    3. Patients
    4. Appointments
    5. Consultations
    6. Prescriptions
    7. Lab tests (from documents)

    All with deduplication using external_id fields.
    """

    try:
        # Extract data from payload
        event = payload.get("event")
        if event != "clinical_output_created":
            raise ClinicalOutputProcessingError(f"Unexpected event type: {event}")

        patient_data = payload.get("patient", {})
        appointment_data = payload.get("appointment", {})
        doctor_data = payload.get("doctor", {})
        clinic_data = payload.get("clinic", {})
        consultation_data = payload.get("consultation", {})
        clinical_output_data = payload.get("clinical_output", {})
        prescriptions_data = payload.get("prescriptions", [])
        documents_data = payload.get("documents", [])

        results = {
            "phone_user_id": None,
            "patient_id": None,
            "clinic_id": None,
            "appointment_id": None,
            "consultation_id": None,
            "prescription_ids": [],
            "lab_test_ids": []
        }

        # Step 1: Process phone user (from patient phone)
        if patient_data.get("phone"):
            phone_user = await upsert_phone_user(patient_data, db)
            results["phone_user_id"] = str(phone_user.id)

        # Step 2: Process clinic
        if clinic_data.get("id"):
            clinic_id = await upsert_clinic(clinic_data, db)
            results["clinic_id"] = str(clinic_id)

        # Step 2.5: Process doctor
        if doctor_data.get("id"):
            doctor_id = await upsert_doctor(doctor_data, db)
            results["doctor_id"] = str(doctor_id)

        # Step 3: Process patient
        if patient_data.get("id"):
            patient = await upsert_patient(
                patient_data,
                results.get("phone_user_id"),
                results.get("clinic_id"),
                db
            )
            results["patient_id"] = str(patient.id)

        # Step 4: Process appointment
        if appointment_data.get("id"):
            appointment_id = await upsert_appointment(
                appointment_data,
                results.get("patient_id"),
                results.get("clinic_id"),
                results.get("doctor_id"),
                db
            )
            results["appointment_id"] = str(appointment_id)

        # Step 5: Process consultation
        if consultation_data.get("id"):
            consultation_id = await upsert_consultation(
                consultation_data,
                clinical_output_data,
                results.get("appointment_id"),
                results.get("doctor_id"),
                db
            )
            results["consultation_id"] = str(consultation_id)

        # Step 6: Process prescriptions
        for prescription_data in prescriptions_data:
            prescription_id = await upsert_prescription(
                prescription_data,
                results.get("patient_id"),
                results.get("doctor_id"),
                consultation_id,
                db
            )
            if prescription_id:
                results["prescription_ids"].append(str(prescription_id))

        # Step 7: Process documents as lab tests
        for document_data in documents_data:
            lab_test_id = await upsert_lab_test_from_document(
                document_data,
                results.get("patient_id"),
                db
            )
            if lab_test_id:
                results["lab_test_ids"].append(str(lab_test_id))

        # Update webhook as processed
        await db.execute(
            text("""
                UPDATE webhook_events
                SET patient_id = :patient_id,
                    processed = true,
                    processed_at = NOW(),
                    updated_at = NOW()
                WHERE id = :webhook_id
            """),
            {"patient_id": results.get("patient_id"), "webhook_id": webhook_id}
        )

        await db.commit()

        return {
            "success": True,
            "webhook_id": webhook_id,
            **results
        }

    except Exception as e:
        await db.rollback()

        # Mark webhook as failed
        await db.execute(
            text("""
                UPDATE webhook_events
                SET error_message = :error,
                    updated_at = NOW()
                WHERE id = :webhook_id
            """),
            {"error": str(e), "webhook_id": webhook_id}
        )
        await db.commit()

        raise ClinicalOutputProcessingError(f"Processing failed: {str(e)}")


async def upsert_phone_user(patient_data: Dict[str, Any], db: AsyncSession):
    """Upsert phone user from patient phone"""
    phone = patient_data.get("phone", "").strip()

    # Normalize phone
    phone = ''.join(filter(str.isdigit, phone))
    if phone.startswith('91') and len(phone) == 12:
        phone = phone[2:]

    if len(phone) != 10:
        raise ClinicalOutputProcessingError(f"Invalid phone: {phone}")

    # Check if exists
    result = await db.execute(
        select(PhoneUser).where(PhoneUser.phone_number == phone)
    )
    phone_user = result.scalar_one_or_none()

    if phone_user:
        # Update external_id if provided
        if patient_data.get("id"):
            await db.execute(
                text("""
                    UPDATE phone_users
                    SET external_id = :external_id,
                        updated_at = NOW()
                    WHERE phone_number = :phone
                """),
                {"external_id": patient_data["id"], "phone": phone}
            )
            await db.flush()
        return phone_user

    # Create new
    phone_user = PhoneUser(
        phone_number=phone,
        country_code="+91",
        is_verified=True,
        is_active=True
    )
    db.add(phone_user)
    await db.flush()

    # Set external_id
    if patient_data.get("id"):
        await db.execute(
            text("""
                UPDATE phone_users
                SET external_id = :external_id
                WHERE id = :id
            """),
            {"external_id": patient_data["id"], "id": str(phone_user.id)}
        )
        await db.flush()

    print(f"[CLINICAL] Created phone user: {phone_user.id}")
    return phone_user


async def upsert_clinic(clinic_data: Dict[str, Any], db: AsyncSession) -> uuid.UUID:
    """Upsert clinic"""
    external_id = clinic_data.get("id")

    # Check if exists by external_id
    result = await db.execute(
        text("SELECT id FROM clinics WHERE external_id = :external_id"),
        {"external_id": external_id}
    )
    row = result.fetchone()

    if row:
        return uuid.UUID(row[0])

    # Create new clinic
    clinic_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO clinics (id, external_id, name, address, phone, is_active)
            VALUES (:id, :external_id, :name, :address, :phone, true)
        """),
        {
            "id": str(clinic_id),
            "external_id": external_id,
            "name": clinic_data.get("name", "Unknown Clinic"),
            "address": clinic_data.get("address"),
            "phone": clinic_data.get("phone")
        }
    )
    await db.flush()

    print(f"[CLINICAL] Created clinic: {clinic_id}")
    return clinic_id


async def upsert_doctor(doctor_data: Dict[str, Any], db: AsyncSession) -> uuid.UUID:
    """Upsert doctor using external_id"""
    external_id = doctor_data.get("id")

    # Check if exists by external_id
    result = await db.execute(
        text("SELECT id FROM doctors WHERE external_id = :external_id"),
        {"external_id": external_id}
    )
    row = result.fetchone()

    if row:
        # Update existing
        doctor_id = uuid.UUID(row[0])
        await db.execute(
            text("""
                UPDATE doctors
                SET full_name = :full_name,
                    email = :email,
                    phone = :phone,
                    updated_at = NOW()
                WHERE id = :id
            """),
            {
                "id": str(doctor_id),
                "full_name": doctor_data.get("fullName", "Unknown Doctor"),
                "email": doctor_data.get("email"),
                "phone": doctor_data.get("phone")
            }
        )
        await db.flush()

        print(f"[CLINICAL] Updated doctor: {doctor_id}")
        return doctor_id

    # Create new doctor
    doctor_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO doctors (id, external_id, full_name, email, phone, is_active)
            VALUES (:id, :external_id, :full_name, :email, :phone, true)
        """),
        {
            "id": str(doctor_id),
            "external_id": external_id,
            "full_name": doctor_data.get("fullName", "Unknown Doctor"),
            "email": doctor_data.get("email"),
            "phone": doctor_data.get("phone")
        }
    )
    await db.flush()

    print(f"[CLINICAL] Created doctor: {doctor_id}")
    return doctor_id


async def upsert_patient(
    patient_data: Dict[str, Any],
    phone_user_id: Optional[str],
    clinic_id: Optional[str],
    db: AsyncSession
) -> Patient:
    """Upsert patient with external_id"""
    external_id = patient_data.get("id")

    # Check if exists by external_id
    result = await db.execute(
        text("SELECT id FROM patients WHERE external_id = :external_id"),
        {"external_id": external_id}
    )
    row = result.fetchone()

    if row:
        # Update existing
        patient_id = uuid.UUID(row[0])

        # Parse DOB
        dob = None
        if patient_data.get("dateOfBirth"):
            try:
                dob = datetime.strptime(patient_data["dateOfBirth"], "%Y-%m-%d %H:%M:%S").date()
            except:
                try:
                    dob = datetime.strptime(patient_data["dateOfBirth"], "%Y-%m-%d").date()
                except:
                    pass

        await db.execute(
            text("""
                UPDATE patients
                SET full_name = :full_name,
                    phone = :phone,
                    email = :email,
                    date_of_birth = :dob,
                    gender = :gender,
                    blood_group = :blood_group,
                    address = :address,
                    mrn = :mrn,
                    abha_id = :abha_id,
                    abha_address = :abha_address,
                    clinic_id = :clinic_id,
                    phone_user_id = :phone_user_id,
                    updated_at = NOW()
                WHERE id = :id
            """),
            {
                "id": str(patient_id),
                "full_name": patient_data.get("fullName"),
                "phone": patient_data.get("phone"),
                "email": patient_data.get("email"),
                "dob": dob,
                "gender": patient_data.get("gender"),
                "blood_group": patient_data.get("bloodGroup"),
                "address": patient_data.get("address"),
                "mrn": patient_data.get("mrn"),
                "abha_id": patient_data.get("abhaId"),
                "abha_address": patient_data.get("abhaAddress"),
                "clinic_id": clinic_id,
                "phone_user_id": phone_user_id
            }
        )
        await db.flush()

        result = await db.execute(
            select(Patient).where(Patient.id == patient_id)
        )
        patient = result.scalar_one()

        print(f"[CLINICAL] Updated patient: {patient_id}")
        return patient

    # Create new patient
    # Parse DOB
    dob = None
    if patient_data.get("dateOfBirth"):
        try:
            dob = datetime.strptime(patient_data["dateOfBirth"], "%Y-%m-%d %H:%M:%S").date()
        except:
            try:
                dob = datetime.strptime(patient_data["dateOfBirth"], "%Y-%m-%d").date()
            except:
                pass

    patient = Patient(
        full_name=patient_data.get("fullName", "Unknown Patient"),
        phone=patient_data.get("phone"),
        email=patient_data.get("email"),
        date_of_birth=dob,
        gender=patient_data.get("gender"),
        blood_group=patient_data.get("bloodGroup"),
        address=patient_data.get("address"),
        mrn=patient_data.get("mrn"),
        abha_id=patient_data.get("abhaId"),
        abha_address=patient_data.get("abhaAddress"),
        clinic_id=uuid.UUID(clinic_id) if clinic_id else None,
        phone_user_id=uuid.UUID(phone_user_id) if phone_user_id else None,
        is_active=True
    )
    db.add(patient)
    await db.flush()

    # Set external_id
    await db.execute(
        text("UPDATE patients SET external_id = :external_id WHERE id = :id"),
        {"external_id": external_id, "id": str(patient.id)}
    )
    await db.flush()

    # Link to phone user if provided
    if phone_user_id:
        link_result = await db.execute(
            select(UserPatientLink).where(
                UserPatientLink.phone_user_id == uuid.UUID(phone_user_id),
                UserPatientLink.is_active == True
            )
        )
        link = link_result.scalar_one_or_none()

        if not link:
            user_patient_link = UserPatientLink(
                phone_user_id=uuid.UUID(phone_user_id),
                patient_id=patient.id,
                is_primary=True,
                is_active=True
            )
            db.add(user_patient_link)
            await db.flush()

    print(f"[CLINICAL] Created patient: {patient.id}")
    return patient


async def upsert_appointment(
    appointment_data: Dict[str, Any],
    patient_id: Optional[str],
    clinic_id: Optional[str],
    doctor_id: Optional[str],
    db: AsyncSession
) -> uuid.UUID:
    """Upsert appointment with external_appointment_id"""
    external_id = appointment_data.get("id")

    # Check if exists
    result = await db.execute(
        text("SELECT id FROM appointments WHERE external_appointment_id = :external_id"),
        {"external_id": external_id}
    )
    row = result.fetchone()

    # Parse slot time
    slot_time = None
    if appointment_data.get("slotTime"):
        try:
            slot_time = datetime.strptime(appointment_data["slotTime"], "%Y-%m-%d %H:%M:%S")
        except:
            pass

    if row:
        # Update existing
        appointment_id = uuid.UUID(row[0])
        await db.execute(
            text("""
                UPDATE appointments
                SET patient_id = :patient_id,
                    clinic_id = :clinic_id,
                    doctor_id = :doctor_id,
                    slot_time = :slot_time,
                    duration_minutes = :duration,
                    type = :type,
                    status = :status,
                    reason_for_visit = :reason,
                    notes = :notes,
                    updated_at = NOW()
                WHERE id = :id
            """),
            {
                "id": str(appointment_id),
                "patient_id": patient_id,
                "clinic_id": clinic_id,
                "doctor_id": doctor_id,  # Already a UUID string from upsert_doctor
                "slot_time": slot_time,
                "duration": appointment_data.get("durationMinutes", 15),
                "type": appointment_data.get("type"),
                "status": appointment_data.get("status", "SCHEDULED").lower(),
                "reason": appointment_data.get("reasonForVisit"),
                "notes": appointment_data.get("notes")
            }
        )
        await db.flush()

        print(f"[CLINICAL] Updated appointment: {appointment_id}")
        return appointment_id

    # Create new
    appointment_id = uuid.uuid4()

    await db.execute(
        text("""
            INSERT INTO appointments (
                id, external_appointment_id, patient_id, clinic_id, doctor_id,
                slot_time, duration_minutes, type, status, reason_for_visit, notes
            )
            VALUES (
                :id, :external_id, :patient_id, :clinic_id, :doctor_id,
                :slot_time, :duration, :type, :status, :reason, :notes
            )
        """),
        {
            "id": str(appointment_id),
            "external_id": external_id,
            "patient_id": patient_id,
            "clinic_id": clinic_id,
            "doctor_id": doctor_id,  # Already a UUID string from upsert_doctor
            "slot_time": slot_time,
            "duration": appointment_data.get("durationMinutes", 15),
            "type": appointment_data.get("type"),
            "status": appointment_data.get("status", "SCHEDULED").lower(),
            "reason": appointment_data.get("reasonForVisit"),
            "notes": appointment_data.get("notes")
        }
    )
    await db.flush()

    print(f"[CLINICAL] Created appointment: {appointment_id}")
    return appointment_id


async def upsert_consultation(
    consultation_data: Dict[str, Any],
    clinical_output_data: Dict[str, Any],
    appointment_id: Optional[str],
    doctor_id: Optional[str],
    db: AsyncSession
) -> uuid.UUID:
    """Upsert consultation with external_id"""
    external_id = consultation_data.get("id")

    # Check if exists
    result = await db.execute(
        text("SELECT id FROM consultations WHERE external_id = :external_id"),
        {"external_id": external_id}
    )
    row = result.fetchone()

    # Build note_text from clinical output
    note_text = consultation_data.get("noteText", "")

    # Add SOAP note if available
    soap_note = clinical_output_data.get("soapNote", {})
    if soap_note:
        note_text += f"\n\n--- SOAP NOTE ---\n"
        note_text += f"Subjective: {soap_note.get('subjective', '')}\n\n"
        note_text += f"Objective: {soap_note.get('objective', '')}\n\n"
        note_text += f"Assessment: {soap_note.get('assessment', '')}\n\n"
        note_text += f"Plan: {soap_note.get('plan', '')}\n"

    # Parse finished_at
    finished_at = None
    if consultation_data.get("finalisedAt"):
        try:
            finished_at = datetime.strptime(consultation_data["finalisedAt"], "%Y-%m-%d %H:%M:%S.%f")
        except:
            pass

    if row:
        # Update existing
        consultation_id = uuid.UUID(row[0])
        await db.execute(
            text("""
                UPDATE consultations
                SET appointment_id = :appointment_id,
                    doctor_id = :doctor_id,
                    note_text = :note_text,
                    voice_transcript = :voice_transcript,
                    status = :status,
                    finished_at = :finished_at,
                    updated_at = NOW()
                WHERE id = :id
            """),
            {
                "id": str(consultation_id),
                "appointment_id": appointment_id,
                "doctor_id": doctor_id,  # Already a UUID string from upsert_doctor
                "note_text": note_text,
                "voice_transcript": consultation_data.get("voiceTranscript"),
                "status": consultation_data.get("status", "REVIEWED").lower(),
                "finished_at": finished_at
            }
        )
        await db.flush()

        print(f"[CLINICAL] Updated consultation: {consultation_id}")
        return consultation_id

    # Create new
    consultation_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO consultations (
                id, external_id, appointment_id, doctor_id,
                note_text, voice_transcript, status, finished_at
            )
            VALUES (
                :id, :external_id, :appointment_id, :doctor_id,
                :note_text, :voice_transcript, :status, :finished_at
            )
        """),
        {
            "id": str(consultation_id),
            "external_id": external_id,
            "appointment_id": appointment_id,
            "doctor_id": doctor_id,  # Already a UUID string from upsert_doctor
            "note_text": note_text,
            "voice_transcript": consultation_data.get("voiceTranscript"),
            "status": consultation_data.get("status", "REVIEWED").lower(),
            "finished_at": finished_at
        }
    )
    await db.flush()

    print(f"[CLINICAL] Created consultation: {consultation_id}")
    return consultation_id


async def upsert_prescription(
    prescription_data: Dict[str, Any],
    patient_id: Optional[str],
    doctor_id: Optional[str],
    consultation_id: Optional[uuid.UUID],
    db: AsyncSession
) -> Optional[uuid.UUID]:
    """Upsert prescription with external_id"""
    external_id = prescription_data.get("id")

    if not external_id:
        return None

    # Check if exists
    result = await db.execute(
        text("SELECT id FROM prescriptions WHERE external_id = :external_id"),
        {"external_id": external_id}
    )
    row = result.fetchone()

    items_json = json.dumps(prescription_data.get("items", []))

    if row:
        # Update existing
        prescription_id = uuid.UUID(row[0])
        await db.execute(
            text("""
                UPDATE prescriptions
                SET patient_id = :patient_id,
                    doctor_id = :doctor_id,
                    items = :items,
                    refillable = :refillable,
                    refills_remaining = :refills,
                    updated_at = NOW()
                WHERE id = :id
            """),
            {
                "id": str(prescription_id),
                "patient_id": patient_id,
                "doctor_id": doctor_id,  # Already a UUID string from upsert_doctor
                "items": items_json,
                "refillable": prescription_data.get("refillable", False),
                "refills": prescription_data.get("refillsRemaining", 0)
            }
        )
        await db.flush()

        print(f"[CLINICAL] Updated prescription: {prescription_id}")
        return prescription_id

    # Create new
    prescription_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO prescriptions (
                id, external_id, patient_id, doctor_id,
                items, refillable, refills_remaining, interaction_acknowledged
            )
            VALUES (
                :id, :external_id, :patient_id, :doctor_id,
                CAST(:items AS jsonb), :refillable, :refills, :interaction_ack
            )
        """),
        {
            "id": str(prescription_id),
            "external_id": external_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,  # Already a UUID string from upsert_doctor
            "items": items_json,
            "refillable": prescription_data.get("refillable", False),
            "refills": prescription_data.get("refillsRemaining", 0),
            "interaction_ack": prescription_data.get("interactionAcknowledged", False)
        }
    )
    await db.flush()

    print(f"[CLINICAL] Created prescription: {prescription_id}")
    return prescription_id


async def upsert_lab_test_from_document(
    document_data: Dict[str, Any],
    patient_id: Optional[str],
    db: AsyncSession
) -> Optional[uuid.UUID]:
    """Upsert lab test from document with extracted data"""
    external_id = document_data.get("id")

    if not external_id:
        return None

    # Check if exists
    result = await db.execute(
        text("SELECT id FROM lab_tests WHERE external_id = :external_id"),
        {"external_id": external_id}
    )
    row = result.fetchone()

    extracted_data = document_data.get("extractedData", {})
    lab_tests_data = extracted_data.get("lab_tests", [])
    results_json = json.dumps(lab_tests_data)

    # Parse uploaded_at to date
    uploaded_date = None
    if document_data.get("uploadedAt"):
        try:
            uploaded_date = datetime.strptime(document_data["uploadedAt"], "%Y-%m-%d %H:%M:%S.%f").date()
        except:
            try:
                uploaded_date = datetime.strptime(document_data["uploadedAt"], "%Y-%m-%d").date()
            except:
                pass

    # Check for abnormal values in results
    has_abnormal = False
    for test in lab_tests_data:
        if test.get("flag") or test.get("abnormal"):
            has_abnormal = True
            break

    # Get report name
    report_name = document_data.get("title") or document_data.get("kind", "Lab Report")

    if row:
        # Update existing
        lab_test_id = uuid.UUID(row[0])
        await db.execute(
            text("""
                UPDATE lab_tests
                SET patient_id = :patient_id,
                    report_name = :report_name,
                    report_type = :report_type,
                    results = CAST(:results AS jsonb),
                    result_date = :result_date,
                    has_abnormal_values = :has_abnormal,
                    updated_at = NOW()
                WHERE id = :id
            """),
            {
                "id": str(lab_test_id),
                "patient_id": patient_id,
                "report_name": report_name,
                "report_type": document_data.get("kind", "LABORATORY"),
                "results": results_json,
                "result_date": uploaded_date,
                "has_abnormal": has_abnormal
            }
        )
        await db.flush()

        print(f"[CLINICAL] Updated lab test: {lab_test_id}")
        return lab_test_id

    # Create new
    lab_test_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO lab_tests (
                id, external_id, patient_id, report_name,
                report_type, ordered_date, result_date,
                status, processing_status, results, has_abnormal_values
            )
            VALUES (
                :id, :external_id, :patient_id, :report_name,
                :report_type, :ordered_date, :result_date,
                :status, :processing_status, CAST(:results AS jsonb), :has_abnormal
            )
        """),
        {
            "id": str(lab_test_id),
            "external_id": external_id,
            "patient_id": patient_id,
            "report_name": report_name,
            "report_type": document_data.get("kind", "LABORATORY"),
            "ordered_date": uploaded_date or datetime.utcnow().date(),
            "result_date": uploaded_date,
            "status": "completed",
            "processing_status": "processed",
            "results": results_json,
            "has_abnormal": has_abnormal
        }
    )
    await db.flush()

    print(f"[CLINICAL] Created lab test: {lab_test_id}")
    return lab_test_id
