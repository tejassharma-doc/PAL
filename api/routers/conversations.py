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
from auth import get_current_user_unified as get_current_user
from services.user_service import get_patient_by_auth_user
from models import User, Conversation, ConversationTurn
from models.phone_user import PhoneUser
from phi import PHIAudit, AuditEvent
from services.hindsight import Hindsight

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("/{tenant_id}/{member_id}")
async def list_conversations(
    tenant_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all active conversation threads for a member."""
    # Self-access only (or valid consent grant — enforced via phi_guard in production)
    if user.id != member_id:
        raise HTTPException(status_code=403, detail="PHI access requires consent grant.")

    stmt = select(Conversation).where(
        Conversation.tenant_id == tenant_id,
        Conversation.member_id == member_id,
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


@router.get("/{tenant_id}/{member_id}/{conversation_id}/turns")
async def get_turns(
    tenant_id: uuid.UUID,
    member_id: uuid.UUID,
    conversation_id: uuid.UUID,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.id != member_id:
        raise HTTPException(status_code=403, detail="PHI access requires consent grant.")

    stmt = select(ConversationTurn).where(
        ConversationTurn.conversation_id == conversation_id,
        ConversationTurn.tenant_id == tenant_id,
        ConversationTurn.member_id == member_id,
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


@router.delete("/{tenant_id}/{member_id}/{conversation_id}")
async def delete_conversation(
    tenant_id: uuid.UUID,
    member_id: uuid.UUID,
    conversation_id: uuid.UUID,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Real cascading delete: messages + embeddings + Hindsight entries. Audited.
    Immediate effect; no soft-delete visible to user after this call.
    """
    if user.id != member_id:
        raise HTTPException(status_code=403, detail="Only the record owner can delete their conversations.")

    hindsight = Hindsight(db, tenant_id, member_id)
    await hindsight.purge_thread(conversation_id)

    audit = PHIAudit(db)
    await audit.log(AuditEvent(
        event_type="conversation_deleted",
        tenant_id=tenant_id,
        actor_user_id=user.id,
        subject_member_id=member_id,
        conversation_id=conversation_id,
        detail={"purged": True},
    ))

    return {"status": "deleted", "conversation_id": str(conversation_id)}


@router.delete("/{tenant_id}/{member_id}/all")
async def delete_all_conversations(
    tenant_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: Union[PhoneUser, User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete all conversation history for a member."""
    if user.id != member_id:
        raise HTTPException(status_code=403, detail="Only the record owner can delete their history.")

    stmt = select(Conversation).where(
        Conversation.tenant_id == tenant_id,
        Conversation.member_id == member_id,
        Conversation.active == True,
    )
    result = await db.execute(stmt)
    convs = result.scalars().all()

    hindsight = Hindsight(db, tenant_id, member_id)
    for conv in convs:
        await hindsight.purge_thread(conv.id)

    audit = PHIAudit(db)
    await audit.log(AuditEvent(
        event_type="all_conversations_deleted",
        tenant_id=tenant_id,
        actor_user_id=user.id,
        subject_member_id=member_id,
        detail={"count": len(convs)},
    ))

    return {"status": "deleted", "count": len(convs)}
