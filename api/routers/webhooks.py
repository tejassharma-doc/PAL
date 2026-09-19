"""
Webhook Events API
Fetch webhook data by phone number
"""
from typing import Optional, List, Union
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from pydantic import BaseModel
from datetime import datetime
import uuid

from database import get_db
from models.phone_user import PhoneUser
from models.user import User
from auth import get_current_user_unified

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# Response Models
class WebhookEvent(BaseModel):
    id: str
    event_type: Optional[str]
    source: Optional[str]
    timestamp: datetime
    payload: dict
    headers: Optional[dict]
    processed: bool
    processed_at: Optional[datetime]
    error_message: Optional[str]
    patient_id: Optional[str]
    created_at: datetime


class WebhookListResponse(BaseModel):
    total: int
    webhooks: List[WebhookEvent]
    phone_number: str



