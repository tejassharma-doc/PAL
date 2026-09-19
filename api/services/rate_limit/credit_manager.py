"""
LLM credit manager.

Per-user credit pool with lazy daily refill.
Source of truth: PostgreSQL (user_llm_credits).
Hot-path cache:   Redis key `credits:{user_id}` with 60 s TTL.

check_and_deduct() is the only write path called before each LLM turn.
It is atomic via SELECT ... FOR UPDATE so concurrent requests don't
double-spend the last credit.
"""
import uuid
from datetime import date, datetime, timezone, timedelta
from typing import Optional

import redis.asyncio as aioredis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings

settings = get_settings()

# ── Redis singleton ────────────────────────────────────────────────────────────

_redis: Optional[aioredis.Redis] = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


_CACHE_TTL = 60  # seconds
_CACHE_KEY = "credits:{}"


def _cache_key(user_id: uuid.UUID) -> str:
    return _CACHE_KEY.format(user_id)


async def _cache_set(user_id: uuid.UUID, balance: int) -> None:
    try:
        r = _get_redis()
        await r.setex(_cache_key(user_id), _CACHE_TTL, str(balance))
    except Exception:
        pass


async def _cache_get(user_id: uuid.UUID) -> Optional[int]:
    try:
        r = _get_redis()
        val = await r.get(_cache_key(user_id))
        return int(val) if val is not None else None
    except Exception:
        return None


async def _cache_invalidate(user_id: uuid.UUID) -> None:
    try:
        r = _get_redis()
        await r.delete(_cache_key(user_id))
    except Exception:
        pass


# ── Credit operations ─────────────────────────────────────────────────────────

async def get_balance(user_id: uuid.UUID, db: AsyncSession) -> int:
    """Return current balance, creating the row if it doesn't exist yet."""
    cached = await _cache_get(user_id)
    if cached is not None:
        return cached

    await _ensure_row(user_id, db)
    result = await db.execute(
        text("SELECT balance FROM user_llm_credits WHERE user_id = :uid"),
        {"uid": user_id},
    )
    row = result.one_or_none()
    balance = row[0] if row else settings.llm_free_credits_per_day
    await _cache_set(user_id, balance)
    return balance


class CreditDepleted(Exception):
    """Raised by check_and_deduct when balance is 0."""
    def __init__(self, seconds_until_refill: int):
        self.seconds_until_refill = seconds_until_refill


async def check_and_deduct(
    user_id: uuid.UUID,
    db: AsyncSession,
    *,
    tokens_used: Optional[int] = None,
    llm_model: Optional[str] = None,
) -> int:
    """
    Deduct 1 credit from the user's pool. Returns the new balance.
    Raises CreditDepleted if balance is already 0.

    Lazy refill: if last_refill_date < today, reset to free_credits_per_day first.
    """
    await _ensure_row(user_id, db)

    today = date.today()
    free = settings.llm_free_credits_per_day

    # Atomic: lock the row, optionally refill, then deduct
    result = await db.execute(
        text("""
            UPDATE user_llm_credits
            SET
                balance          = CASE
                                     WHEN last_refill_date < :today
                                     THEN :free_credits - 1
                                     ELSE balance - 1
                                   END,
                last_refill_date = CASE
                                     WHEN last_refill_date < :today
                                     THEN :today
                                     ELSE last_refill_date
                                   END,
                total_used       = total_used + 1,
                updated_at       = NOW()
            WHERE user_id = :uid
              AND (
                    (last_refill_date < :today AND :free_credits > 0)
                    OR
                    (last_refill_date = :today AND balance > 0)
                  )
            RETURNING balance,
                      (last_refill_date < :today OR last_refill_date = :today) AS was_refilled
        """),
        {"uid": user_id, "today": today, "free_credits": free},
    )
    row = result.one_or_none()

    if row is None:
        # Balance is 0 and no refill due — raise with seconds until midnight
        raise CreditDepleted(seconds_until_refill=_seconds_until_midnight())

    new_balance: int = row[0]

    # Log the transaction (non-blocking; flush deferred to caller's commit)
    was_refill = row[1] and (new_balance == free - 1)  # first deduct after refill
    if was_refill:
        await _log_transaction(db, user_id, delta=free, kind="daily_refill",
                               balance_after=new_balance + 1)
    await _log_transaction(db, user_id, delta=-1, kind="deduct",
                           tokens_used=tokens_used, llm_model=llm_model,
                           balance_after=new_balance)

    await _cache_set(user_id, new_balance)
    return new_balance


async def add_credits(
    user_id: uuid.UUID,
    db: AsyncSession,
    *,
    delta: int,
    kind: str,
    pack_id: Optional[str] = None,
    amount_inr: Optional[int] = None,
) -> int:
    """Add credits (purchase or refund). Returns new balance."""
    await _ensure_row(user_id, db)

    result = await db.execute(
        text("""
            UPDATE user_llm_credits
            SET balance          = balance + :delta,
                total_purchased  = CASE WHEN :kind = 'purchase'
                                        THEN total_purchased + :delta
                                        ELSE total_purchased END,
                updated_at       = NOW()
            WHERE user_id = :uid
            RETURNING balance
        """),
        {"uid": user_id, "delta": delta, "kind": kind},
    )
    row = result.one()
    new_balance = row[0]

    await _log_transaction(db, user_id, delta=delta, kind=kind,
                           pack_id=pack_id, amount_inr=amount_inr,
                           balance_after=new_balance)
    await _cache_invalidate(user_id)
    return new_balance


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _ensure_row(user_id: uuid.UUID, db: AsyncSession) -> None:
    """Create user_llm_credits row on first use (upsert — safe for concurrent calls)."""
    await db.execute(
        text("""
            INSERT INTO user_llm_credits (user_id, balance, last_refill_date)
            VALUES (:uid, :free, CURRENT_DATE)
            ON CONFLICT (user_id) DO NOTHING
        """),
        {"uid": user_id, "free": settings.llm_free_credits_per_day},
    )


async def _log_transaction(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    delta: int,
    kind: str,
    pack_id: Optional[str] = None,
    tokens_used: Optional[int] = None,
    llm_model: Optional[str] = None,
    amount_inr: Optional[int] = None,
    balance_after: int,
) -> None:
    await db.execute(
        text("""
            INSERT INTO credit_transactions
                (user_id, delta, kind, pack_id, tokens_used, llm_model, amount_inr, balance_after)
            VALUES
                (:uid, :delta, :kind, :pack_id, :tokens_used, :llm_model, :amount_inr, :balance_after)
        """),
        {
            "uid": user_id,
            "delta": delta,
            "kind": kind,
            "pack_id": pack_id,
            "tokens_used": tokens_used,
            "llm_model": llm_model,
            "amount_inr": amount_inr,
            "balance_after": balance_after,
        },
    )


def _seconds_until_midnight() -> int:
    now = datetime.now(tz=timezone(timedelta(hours=5, minutes=30)))  # IST
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return max(0, int((midnight - now).total_seconds()))


def _refill_at_iso() -> str:
    now = datetime.now(tz=timezone(timedelta(hours=5, minutes=30)))
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return midnight.isoformat()
