"""Exotel SMS delivery for login OTPs (DLT-registered transactional template).

Exotel SMS send API (v1), HTTP Basic auth with API key:token:
    POST {base}/v1/Accounts/{sid}/Sms/send.json
    From=<DLT sender/header>  To=<+91…>  Body=<message>
    DltEntityId=<entity id>   DltTemplateId=<content template id>

The Body MUST match the DLT-approved template exactly (only {#var#} is substituted)
or the carrier will drop the message.
"""
from __future__ import annotations

import logging

import httpx

from config import get_settings

logger = logging.getLogger("sms.exotel")

# DLT-approved template — {#var#} replaced by the OTP code. Must match exactly.
OTP_TEMPLATE = (
    "{code} is the verification code to log in or register your account on "
    "palcare.life. Do not share it with anyone. - Locumpro Health Technologies "
    "Private Ltd"
)


def configured() -> bool:
    s = get_settings()
    return bool(
        s.exotel_sid and s.exotel_api_key and s.exotel_api_token and s.exotel_sms_sender
    )


def _format_to(phone: str) -> str:
    """Normalise to +91XXXXXXXXXX for Indian numbers."""
    digits = "".join(filter(str.isdigit, phone))
    if len(digits) == 10:
        digits = "91" + digits
    return "+" + digits


async def send_otp_sms(phone: str, code: str) -> dict:
    """Send the OTP SMS via Exotel. Raises on failure."""
    s = get_settings()
    if not configured():
        raise RuntimeError("Exotel SMS is not configured")

    url = f"{s.exotel_api_base}/v1/Accounts/{s.exotel_sid}/Sms/send.json"
    data = {
        "From": s.exotel_sms_sender,
        "To": _format_to(phone),
        "Body": OTP_TEMPLATE.format(code=code),
        "DltEntityId": s.exotel_dlt_entity_id,
        "DltTemplateId": s.exotel_dlt_template_id,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(url, data=data, auth=(s.exotel_api_key, s.exotel_api_token))
        if r.status_code >= 400:
            # Log the body (no secrets in it) to diagnose DLT/sender rejections.
            logger.error("Exotel SMS send failed (%s): %s", r.status_code, r.text)
            r.raise_for_status()
        return r.json()
