"""
Consultations Router
API endpoints for managing medical consultations
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
import uuid

from database import get_db
from models.consultation import Consultation
from models.appointment import Appointment
from auth_unified import get_current_user_unified
from models.phone_user import PhoneUser
from models.user import User
from typing import Union


router = APIRouter(prefix="/consultations", tags=["consultations"])


# Pydantic schemas
class ConsultationCreate(BaseModel):
    appointment_id: Optional[uuid.UUID] = None
    doctor_id: Optional[uuid.UUID] = None
    note_text: Optional[str] = None
    voice_transcript: Optional[str] = None
    status: str = "in_progress"


class ConsultationUpdate(BaseModel):
    note_text: Optional[str] = None
    voice_transcript: Optional[str] = None
    status: Optional[str] = None
    finished_at: Optional[datetime] = None


class ConsultationResponse(BaseModel):
    id: uuid.UUID
    appointment_id: Optional[uuid.UUID]
    doctor_id: Optional[uuid.UUID]
    note_text: Optional[str]
    voice_transcript: Optional[str]
    status: str
    finished_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# CREATE - Create a new consultation
@router.post("/", response_model=ConsultationResponse, status_code=status.HTTP_201_CREATED)
async def create_consultation(
    consultation_data: ConsultationCreate,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Create a new consultation"""

    # If appointment_id is provided, verify it exists
    if consultation_data.appointment_id:
        result = await db.execute(
            select(Appointment).where(Appointment.id == consultation_data.appointment_id)
        )
        appointment = result.scalar_one_or_none()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Appointment not found"
            )

    # Create consultation
    consultation = Consultation(
        appointment_id=consultation_data.appointment_id,
        doctor_id=consultation_data.doctor_id,
        note_text=consultation_data.note_text,
        voice_transcript=consultation_data.voice_transcript,
        status=consultation_data.status
    )

    db.add(consultation)
    await db.commit()
    await db.refresh(consultation)

    return consultation


# READ - Get consultation by ID
@router.get("/{consultation_id}", response_model=ConsultationResponse)
async def get_consultation(
    consultation_id: uuid.UUID,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Get a specific consultation by ID"""

    result = await db.execute(
        select(Consultation).where(Consultation.id == consultation_id)
    )
    consultation = result.scalar_one_or_none()

    if not consultation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consultation not found"
        )

    return consultation


# READ - List all consultations
@router.get("/", response_model=List[ConsultationResponse])
async def list_consultations(
    skip: int = 0,
    limit: int = 50,
    status_filter: Optional[str] = None,
    appointment_id: Optional[uuid.UUID] = None,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """List consultations with optional filters"""

    query = select(Consultation)

    # Apply filters
    if status_filter:
        query = query.where(Consultation.status == status_filter)

    if appointment_id:
        query = query.where(Consultation.appointment_id == appointment_id)

    # Order by creation date (newest first)
    query = query.order_by(Consultation.created_at.desc())

    # Apply pagination
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    consultations = result.scalars().all()

    return consultations


# UPDATE - Update a consultation
@router.put("/{consultation_id}", response_model=ConsultationResponse)
async def update_consultation(
    consultation_id: uuid.UUID,
    consultation_update: ConsultationUpdate,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Update a consultation"""

    # Get existing consultation
    result = await db.execute(
        select(Consultation).where(Consultation.id == consultation_id)
    )
    consultation = result.scalar_one_or_none()

    if not consultation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consultation not found"
        )

    # Update fields
    update_data = consultation_update.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(consultation, field, value)

    # Auto-set finished_at when status changes to completed
    if consultation_update.status == "completed" and not consultation.finished_at:
        consultation.finished_at = datetime.utcnow()

    await db.commit()
    await db.refresh(consultation)

    return consultation


# DELETE - Delete a consultation
@router.delete("/{consultation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_consultation(
    consultation_id: uuid.UUID,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Delete a consultation"""

    result = await db.execute(
        select(Consultation).where(Consultation.id == consultation_id)
    )
    consultation = result.scalar_one_or_none()

    if not consultation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Consultation not found"
        )

    await db.delete(consultation)
    await db.commit()

    return None


# Get consultations by appointment
@router.get("/appointment/{appointment_id}", response_model=List[ConsultationResponse])
async def get_consultations_by_appointment(
    appointment_id: uuid.UUID,
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Get all consultations for a specific appointment"""

    # Verify appointment exists
    appt_result = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )
    appointment = appt_result.scalar_one_or_none()

    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )

    # Get consultations
    result = await db.execute(
        select(Consultation)
        .where(Consultation.appointment_id == appointment_id)
        .order_by(Consultation.created_at.desc())
    )
    consultations = result.scalars().all()

    return consultations


# Get statistics
@router.get("/stats/overview")
async def get_consultation_stats(
    current_user: Union[PhoneUser, User] = Depends(get_current_user_unified),
    db: AsyncSession = Depends(get_db)
):
    """Get consultation statistics"""

    # Total consultations
    total_result = await db.execute(select(func.count(Consultation.id)))
    total = total_result.scalar()

    # By status
    status_result = await db.execute(
        select(Consultation.status, func.count(Consultation.id))
        .group_by(Consultation.status)
    )
    by_status = {row[0]: row[1] for row in status_result.all()}

    # Completed today
    today_result = await db.execute(
        select(func.count(Consultation.id))
        .where(
            Consultation.status == "completed",
            func.date(Consultation.finished_at) == func.current_date()
        )
    )
    completed_today = today_result.scalar()

    return {
        "total_consultations": total,
        "by_status": by_status,
        "completed_today": completed_today
    }
