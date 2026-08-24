"""
LLM credit economy router — /credits

Endpoints:
  GET  /credits/balance   — current balance + pack options
  POST /credits/redeem    — redeem a voucher code (pilot: manual issue)
  GET  /credits/history   — transaction log (last 50)
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from config import get_settings
from database import get_db
from models import User
from services.rate_limit.credit_manager import (
    add_credits,
    get_balance,
    _refill_at_iso,
    _seconds_until_midnight,
)

router = APIRouter(prefix="/credits", tags=["credits"])

# Credit pack definitions — static for pilot
CREDIT_PACKS = {
    "starter":  {"credits": 100,  "price_inr": 49,  "label": "Starter"},
    "standard": {"credits": 500,  "price_inr": 199, "label": "Standard"},
    "power":    {"credits": 2000, "price_inr": 699, "label": "Power"},
}


def _pack_options() -> list[dict]:
    return [
        {
            "pack_id": k,
            "label": v["label"],
            "credits": v["credits"],
            "price_inr": v["price_inr"],
            "price_per_credit_inr": round(v["price_inr"] / v["credits"], 2),
            "approx_tokens": v["credits"] * 800,
        }
        for k, v in CREDIT_PACKS.items()
    ]


# ── Balance ───────────────────────────────────────────────────────────────────

@router.get("/balance")
async def credit_balance(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    balance = await get_balance(user.id, db)
    return {
        "balance": balance,
        "free_credits_per_day": settings.llm_free_credits_per_day,
        "refill_at_iso": _refill_at_iso(),
        "seconds_until_refill": _seconds_until_midnight(),
        "rate_limit_enabled": settings.llm_rate_limit_enabled,
        "pack_options": _pack_options(),
        "buy_url": settings.llm_buy_credits_url,
    }


# ── Voucher redemption (pilot) ────────────────────────────────────────────────

class RedeemRequest(BaseModel):
    voucher_code: str


# Voucher codes are stored as env var during pilot (comma-separated CODE:PACK pairs)
# e.g. VOUCHER_CODES="ABC123:starter,XYZ789:power"
def _load_vouchers() -> dict[str, str]:
    """Load voucher_code → pack_id mapping from settings."""
    settings = get_settings()
    raw = getattr(settings, "voucher_codes", "") or ""
    result: dict[str, str] = {}
    for entry in raw.split(","):
        entry = entry.strip()
        if ":" in entry:
            code, pack = entry.split(":", 1)
            result[code.strip().upper()] = pack.strip()
    return result


@router.post("/redeem")
async def redeem_voucher(
    req: RedeemRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Pilot voucher redemption. Each code is single-use (tracked in credit_transactions).
    Razorpay payment flow replaces this in Phase 3.
    """
    settings = get_settings()
    vouchers = _load_vouchers()
    code = req.voucher_code.strip().upper()

    if code not in vouchers:
        raise HTTPException(status_code=400, detail="Invalid or expired voucher code.")

    pack_id = vouchers[code]
    pack = CREDIT_PACKS.get(pack_id)
    if not pack:
        raise HTTPException(status_code=400, detail="Unknown pack referenced by voucher.")

    # Check if this voucher has already been used (credit_transactions has a row with this pack_id
    # and kind='purchase' — for the pilot we use the voucher code stored in pack_id field)
    result = await db.execute(
        text("""
            SELECT 1 FROM credit_transactions
            WHERE user_id = :uid AND kind = 'purchase' AND pack_id = :code
            LIMIT 1
        """),
        {"uid": user.id, "code": code},
    )
    if result.one_or_none():
        raise HTTPException(status_code=409, detail="Voucher already redeemed by this account.")

    new_balance = await add_credits(
        user.id, db,
        delta=pack["credits"],
        kind="purchase",
        pack_id=code,  # store raw code so we can detect re-use
        amount_inr=pack["price_inr"] * 100,  # paise
    )

    return {
        "status": "redeemed",
        "pack": pack_id,
        "credits_added": pack["credits"],
        "new_balance": new_balance,
    }


# ── Transaction history ───────────────────────────────────────────────────────

@router.get("/history")
async def credit_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT delta, kind, pack_id, tokens_used, llm_model, balance_after, ts
            FROM credit_transactions
            WHERE user_id = :uid
            ORDER BY ts DESC
            LIMIT 50
        """),
        {"uid": user.id},
    )
    rows = result.mappings().all()
    return {
        "transactions": [
            {
                "delta": r["delta"],
                "kind": r["kind"],
                "pack_id": r["pack_id"],
                "tokens_used": r["tokens_used"],
                "llm_model": r["llm_model"],
                "balance_after": r["balance_after"],
                "ts": r["ts"].isoformat() if r["ts"] else None,
            }
            for r in rows
        ]
    }
