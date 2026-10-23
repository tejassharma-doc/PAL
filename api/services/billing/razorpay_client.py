"""Thin Razorpay client for recurring subscriptions (REST via httpx, no SDK).

Auth is HTTP Basic (key_id:key_secret). Only the calls we need:
  - create_customer
  - create_subscription  (returns id + short_url; the frontend opens Checkout with the id)
  - fetch_subscription
  - verify_webhook_signature  (HMAC-SHA256 of the raw body)
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any, Optional

import httpx

from config import get_settings

logger = logging.getLogger("billing.razorpay")


def _auth() -> tuple[str, str]:
    s = get_settings()
    return (s.razorpay_key_id, s.razorpay_key_secret)


def configured() -> bool:
    s = get_settings()
    has_plan = bool(s.razorpay_plan_id or s.razorpay_plan_individual or s.razorpay_plan_family)
    return bool(s.razorpay_key_id and s.razorpay_key_secret and has_plan)


async def create_customer(name: Optional[str], contact: Optional[str], email: Optional[str]) -> Optional[str]:
    s = get_settings()
    payload: dict[str, Any] = {"fail_existing": 0}
    if name:
        payload["name"] = name
    if contact:
        payload["contact"] = contact
    if email:
        payload["email"] = email
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{s.razorpay_api_base}/customers", json=payload, auth=_auth())
        r.raise_for_status()
        return r.json().get("id")


async def create_subscription(
    customer_id: Optional[str],
    plan_id: Optional[str] = None,
    total_count: int = 12,
    notes: Optional[dict] = None,
) -> dict:
    """Create a recurring subscription on the given plan (falls back to the
    default razorpay_plan_id). Returns the Razorpay subscription object."""
    s = get_settings()
    payload: dict[str, Any] = {
        "plan_id": plan_id or s.razorpay_plan_id,
        "total_count": total_count,   # number of billing cycles
        "customer_notify": 1,
        "notes": notes or {},
    }
    if customer_id:
        payload["customer_id"] = customer_id
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{s.razorpay_api_base}/subscriptions", json=payload, auth=_auth())
        r.raise_for_status()
        return r.json()


async def fetch_subscription(subscription_id: str) -> dict:
    s = get_settings()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{s.razorpay_api_base}/subscriptions/{subscription_id}", auth=_auth())
        r.raise_for_status()
        return r.json()


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    """Verify the X-Razorpay-Signature header against the webhook secret."""
    s = get_settings()
    if not s.razorpay_webhook_secret or not signature:
        return False
    expected = hmac.new(
        s.razorpay_webhook_secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
