"""
Authorization helpers - patient ownership and access control.
Prevents IDOR (Insecure Direct Object Reference) vulnerabilities.
"""

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Union
from models.patient import Patient
from models.phone_user import PhoneUser
from models.user import User


async def verify_patient_ownership(
    patient_id: str,
    current_user: Union[PhoneUser, User],
    db: AsyncSession
) -> Patient:
    """
    Verify that the current user owns or has permission to access the patient record.

    Args:
        patient_id: UUID of the patient record
        current_user: Authenticated user (PhoneUser or legacy User)
        db: Database session

    Returns:
        Patient: The patient record if authorized

    Raises:
        HTTPException: 404 if patient not found, 403 if access denied
    """
    # Fetch the patient record
    patient_result = await db.execute(
        select(Patient).where(Patient.id == patient_id)
    )
    patient = patient_result.scalar_one_or_none()

    if not patient:
        raise HTTPException(
            status_code=404,
            detail="Patient not found"
        )

    # Check ownership based on user type
    if isinstance(current_user, PhoneUser):
        # Phone users: check phone_user_id link
        if patient.phone_user_id != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: You do not have permission to access this patient record"
            )
    else:
        # Legacy email-based users: check email match
        # Note: For multi-user deployments, add family plan permission check here
        if patient.email != current_user.email:
            # TODO: Check family plan permissions when family_plan_enabled=true
            raise HTTPException(
                status_code=403,
                detail="Access denied: You do not have permission to access this patient record"
            )

    return patient


async def verify_patient_list_access(
    current_user: Union[PhoneUser, User],
    db: AsyncSession
) -> list[Patient]:
    """
    Get list of patients that the current user has access to.

    Args:
        current_user: Authenticated user (PhoneUser or legacy User)
        db: Database session

    Returns:
        List of Patient records the user can access
    """
    if isinstance(current_user, PhoneUser):
        # Phone users: get all patients linked to this phone_user_id
        result = await db.execute(
            select(Patient).where(Patient.phone_user_id == current_user.id)
        )
        return list(result.scalars().all())
    else:
        # Legacy email-based users: get patients with matching email
        result = await db.execute(
            select(Patient).where(Patient.email == current_user.email)
        )
        patients = list(result.scalars().all())

        # TODO: Add family plan shared patients when family_plan_enabled=true

        return patients
