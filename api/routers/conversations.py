"""
Conversations router — history on by default, real cascading delete.
Personal-scope threads stored inside the PHI perimeter.
"""
import uuid
from datetime import datetime, timezone
from typing import Union, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db
from auth import get_current_user
from services.user_service import get_patient_by_auth_user
from models import User, Conversation, ConversationTurn
from phi import PHIAudit, AuditEvent
from services.hindsight import Hindsight

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("")
async def list_conversations(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all active conversation threads for the current user's patient."""
    # Get patient from authenticated user
    patient = await get_patient_by_auth_user(user, db)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found")

    patient_id = patient.id
    tenant_id = None  # Tenant concept removed

    stmt = select(Conversation).where(
        Conversation.member_id == patient_id,
        Conversation.active == True,
    ).order_by(Conversation.updated_at.desc())
    result = await db.execute(stmt)
    convs = result.scalars().all()

    return {
        "conversations": [
            {
                "id": str(c.id),
                "title": c.title,
                "scope_tag": c.scope_tag,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in convs
        ]
    }


@router.get("/{conversation_id}/turns")
async def get_turns(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all turns (messages) for a specific conversation."""
    # Get patient from authenticated user
    patient = await get_patient_by_auth_user(user, db)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found")

    patient_id = patient.id

    # Verify conversation belongs to this patient
    conv_stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.member_id == patient_id,
    )
    conv_result = await db.execute(conv_stmt)
    conv = conv_result.scalar_one_or_none()

    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    stmt = select(ConversationTurn).where(
        ConversationTurn.conversation_id == conversation_id,
        ConversationTurn.member_id == patient_id,
    ).order_by(ConversationTurn.created_at)
    result = await db.execute(stmt)
    turns = result.scalars().all()

    return {
        "turns": [
            {
                "id": str(t.id),
                "role": t.role,
                "content": t.content,
                "scope": t.scope,
                "citations": t.citations,
                "created_at": t.created_at.isoformat(),
            }
            for t in turns
        ]
    }


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Real cascading delete: messages + embeddings + Hindsight entries. Audited.
    Immediate effect; no soft-delete visible to user after this call.
    """
    # Get patient from authenticated user
    patient = await get_patient_by_auth_user(user, db)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found")

    patient_id = patient.id
    tenant_id = None  # Tenant concept removed

    # Verify conversation belongs to this patient
    conv_stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.member_id == patient_id,
    )
    conv_result = await db.execute(conv_stmt)
    conv = conv_result.scalar_one_or_none()

    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    hindsight = Hindsight(db, tenant_id, patient_id)
    await hindsight.purge_thread(conversation_id)

    audit = PHIAudit(db)
    await audit.log(AuditEvent(
        event_type="conversation_deleted",
        tenant_id=tenant_id,
        actor_user_id=user.id,
        subject_member_id=patient_id,
        conversation_id=conversation_id,
        detail={"purged": True},
    ))

    return {"status": "deleted", "conversation_id": str(conversation_id)}


@router.delete("/all")
async def delete_all_conversations(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete all conversation history for the current user's patient."""
    # Get patient from authenticated user
    patient = await get_patient_by_auth_user(user, db)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found")

    patient_id = patient.id
    tenant_id = None  # Tenant concept removed

    stmt = select(Conversation).where(
        Conversation.member_id == patient_id,
        Conversation.active == True,
    )
    result = await db.execute(stmt)
    convs = result.scalars().all()

    hindsight = Hindsight(db, tenant_id, patient_id)
    for conv in convs:
        await hindsight.purge_thread(conv.id)

    audit = PHIAudit(db)
    await audit.log(AuditEvent(
        event_type="all_conversations_deleted",
        tenant_id=tenant_id,
        actor_user_id=user.id,
        subject_member_id=patient_id,
        detail={"count": len(convs)},
    ))

    return {"status": "deleted", "count": len(convs)}
