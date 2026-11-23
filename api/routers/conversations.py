"""
Conversations router — history on by default, real cascading delete.
Personal-scope threads stored inside the PHI perimeter.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Union, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel

from database import get_db
from auth import get_current_user
from services.user_service import get_patient_by_auth_user
from models import User, Conversation, ConversationTurn, Patient
from phi import PHIAudit, AuditEvent
from services.hindsight import Hindsight

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def _user_patient_ids(user, db: AsyncSession) -> list[uuid.UUID]:
    """Every patient id that belongs to the current user.

    Chat stores conversations under the patient_id the client sends (pal_patient_id,
    resolved from patients.phone_user_id at login), whereas get_patient_by_auth_user
    resolves via UserPatientLink — these can be different rows once a clinic webhook
    creates a patient. Match the linked patient, every patient with this
    phone_user_id, and any patient sharing the user's phone, so history is never
    lost to that mismatch.
    """
    ids: set[uuid.UUID] = set()
    phone10 = ""

    p = await get_patient_by_auth_user(user, db)
    if p:
        ids.add(p.id)
        d = re.sub(r"\D", "", p.phone or "")[-10:]
        if len(d) == 10:
            phone10 = d

    uid = getattr(user, "id", None)
    if uid is not None:
        res = await db.execute(
            select(Patient.id, Patient.phone).where(Patient.phone_user_id == uid)
        )
        for pid, phone in res.all():
            ids.add(pid)
            if not phone10:
                d = re.sub(r"\D", "", phone or "")[-10:]
                if len(d) == 10:
                    phone10 = d

    if not phone10:
        d = re.sub(r"\D", "", getattr(user, "phone_number", "") or "")[-10:]
        if len(d) == 10:
            phone10 = d

    if phone10:
        res = await db.execute(
            select(Patient.id).where(
                func.right(func.regexp_replace(func.coalesce(Patient.phone, ""), r"\D", "", "g"), 10) == phone10
            )
        )
        for (pid,) in res.all():
            ids.add(pid)

    return list(ids)


@router.get("")
async def list_conversations(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all active conversation threads for the current user's patient."""
    patient_ids = await _user_patient_ids(user, db)
    if not patient_ids:
        raise HTTPException(status_code=404, detail="Patient profile not found")

    stmt = select(Conversation).where(
        Conversation.member_id.in_(patient_ids),
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
                "hindsight_summary": c.hindsight_summary,
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
    patient_ids = await _user_patient_ids(user, db)
    if not patient_ids:
        raise HTTPException(status_code=404, detail="Patient profile not found")

    # Verify conversation belongs to one of this user's patients
    conv_stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.member_id.in_(patient_ids),
    )
    conv_result = await db.execute(conv_stmt)
    conv = conv_result.scalar_one_or_none()

    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    stmt = select(ConversationTurn).where(
        ConversationTurn.conversation_id == conversation_id,
        ConversationTurn.member_id.in_(patient_ids),
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
    patient_ids = await _user_patient_ids(user, db)
    if not patient_ids:
        raise HTTPException(status_code=404, detail="Patient profile not found")
    tenant_id = None  # Tenant concept removed

    # Verify conversation belongs to one of this user's patients
    conv_stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.member_id.in_(patient_ids),
    )
    conv_result = await db.execute(conv_stmt)
    conv = conv_result.scalar_one_or_none()

    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    patient_id = conv.member_id  # the patient this thread is actually stored under
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
    patient_ids = await _user_patient_ids(user, db)
    if not patient_ids:
        raise HTTPException(status_code=404, detail="Patient profile not found")
    tenant_id = None  # Tenant concept removed

    stmt = select(Conversation).where(
        Conversation.member_id.in_(patient_ids),
        Conversation.active == True,
    )
    result = await db.execute(stmt)
    convs = result.scalars().all()

    for conv in convs:
        await Hindsight(db, tenant_id, conv.member_id).purge_thread(conv.id)

    audit = PHIAudit(db)
    await audit.log(AuditEvent(
        event_type="all_conversations_deleted",
        tenant_id=tenant_id,
        actor_user_id=user.id,
        subject_member_id=patient_ids[0],
        detail={"count": len(convs)},
    ))

    return {"status": "deleted", "count": len(convs)}
