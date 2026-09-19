"""
User Service - Unified user and patient management
Handles both phone OTP users and email/password users
"""

import uuid
from typing import Optional, Union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException

from models.phone_user import PhoneUser
from models.user import User
from models.patient import Patient
from models.user_patient_link import UserPatientLink


async def get_patient_by_auth_user(
    auth_user: Union[PhoneUser, User],
    db: AsyncSession
) -> Optional[Patient]:
    """
    Get patient profile linked to an authenticated user.
    Works with both phone users (primary) and email users (legacy).
    """
    # Check if PhoneUser or User
    if isinstance(auth_user, PhoneUser):
        # Query by phone_user_id
        link_result = await db.execute(
            select(UserPatientLink).where(
                UserPatientLink.phone_user_id == auth_user.id,
                UserPatientLink.is_active == True
            )
        )
    else:
        # Query by user_id (legacy)
        link_result = await db.execute(
            select(UserPatientLink).where(
                UserPatientLink.user_id == auth_user.id,
                UserPatientLink.is_active == True
            )
        )

    link = link_result.scalar_one_or_none()

    if not link:
        return None

    # Get patient
    patient_result = await db.execute(
        select(Patient).where(
            Patient.id == link.patient_id,
            Patient.is_active == True
        )
    )

    return patient_result.scalar_one_or_none()


async def link_patient_to_user(
    auth_user: Union[PhoneUser, User],
    patient: Patient,
    db: AsyncSession
) -> UserPatientLink:
    """
    Link a patient profile to an authenticated user.
    Creates or updates the link.
    """
    # Check for existing link
    if isinstance(auth_user, PhoneUser):
        existing_link = await db.execute(
            select(UserPatientLink).where(
                UserPatientLink.phone_user_id == auth_user.id
            )
        )
    else:
        existing_link = await db.execute(
            select(UserPatientLink).where(
                UserPatientLink.user_id == auth_user.id
            )
        )

    link = existing_link.scalar_one_or_none()

    if link:
        # Update existing link
        link.patient_id = patient.id
        link.is_active = True
        link.updated_at = db.bind.dialect.name == 'postgresql' and db.bind.pool._creator().server_version or None
    else:
        # Create new link
        link = UserPatientLink(
            phone_user_id=auth_user.id if isinstance(auth_user, PhoneUser) else None,
            user_id=auth_user.id if isinstance(auth_user, User) else None,
            patient_id=patient.id,
            is_primary=True,
            is_active=True
        )
        db.add(link)

    await db.commit()
    await db.refresh(link)

    return link


async def create_patient_for_user(
    auth_user: Union[PhoneUser, User],
    patient_data: dict,
    db: AsyncSession
) -> Patient:
    """
    Create a new patient profile and link it to the authenticated user.
    """
    # Extract phone number and email
    if isinstance(auth_user, PhoneUser):
        phone = auth_user.phone_number
        email = patient_data.get('email', None)
    else:
        phone = patient_data.get('phone', None)
        email = auth_user.email

    # Create patient
    patient = Patient(
        full_name=patient_data.get('full_name'),
        date_of_birth=patient_data.get('date_of_birth'),
        gender=patient_data.get('gender'),
        phone=phone,
        email=email,
        blood_group=patient_data.get('blood_group'),
        address=patient_data.get('address'),
        allergies=patient_data.get('allergies', []),
        chronic_conditions=patient_data.get('chronic_conditions', []),
        current_medications=patient_data.get('current_medications', []),
        emergency_contact=patient_data.get('emergency_contact'),
        is_active=True
    )

    db.add(patient)
    await db.flush()

    # Link patient to user
    await link_patient_to_user(auth_user, patient, db)

    await db.commit()
    await db.refresh(patient)

    return patient


async def get_or_create_patient(
    auth_user: Union[PhoneUser, User],
    patient_data: Optional[dict],
    db: AsyncSession
) -> Patient:
    """
    Get existing patient or create new one.
    """
    # Try to get existing patient
    patient = await get_patient_by_auth_user(auth_user, db)

    if patient:
        return patient

    # Create new patient if data provided
    if patient_data:
        return await create_patient_for_user(auth_user, patient_data, db)

    raise HTTPException(status_code=404, detail="Patient profile not found")


def get_user_identifier(auth_user: Union[PhoneUser, User]) -> str:
    """Get a display-friendly identifier for the user"""
    if isinstance(auth_user, PhoneUser):
        return f"+91{auth_user.phone_number}"
    else:
        return auth_user.email or auth_user.username
