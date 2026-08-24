"""
FastAPI dependency: require_llm_credit

Inject into any route that calls an external LLM.
When llm_rate_limit_enabled=False it is a no-op (for QA / dev).
When the user's balance is 0 it raises HTTP 429 with refill info.
"""
from fastapi import Depends, HTTPException, status

from auth import get_current_user
from config import get_settings
from database import get_db
from models import User
from services.rate_limit.credit_manager import (
    check_and_deduct,
    CreditDepleted,
    _refill_at_iso,
)
from sqlalchemy.ext.asyncio import AsyncSession


async def require_llm_credit(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Dependency that deducts 1 LLM credit before the route handler runs.
    On success: the credit is deducted; the route proceeds normally.
    On depletion: raises HTTP 429.
    When rate limiting is disabled: no-op.
    """
    settings = get_settings()
    if not settings.llm_rate_limit_enabled:
        return

    try:
        await check_and_deduct(user.id, db)
    except CreditDepleted as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "detail": "LLM credit limit reached",
                "seconds_until_refill": exc.seconds_until_refill,
                "refill_at_iso": _refill_at_iso(),
                "free_credits_per_day": settings.llm_free_credits_per_day,
                "buy_url": settings.llm_buy_credits_url,
            },
        )
