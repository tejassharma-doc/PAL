"""
VoIP wake-up pushes.

iOS   → APNs on the *voip* topic (bundle-id.voip) with apns-push-type: voip.
        PushKit delivers this even when the app is killed, and the app must
        report a CallKit call immediately or iOS will stop delivering pushes.
Android → FCM high-priority data message. The app posts a full-screen
        CallStyle notification / TelecomManager connection from a
        FirebaseMessagingService.

Credentials (server environment only):
    APNS_KEY_P8_BASE64   base64 of the .p8 from Apple (ES256 signing key)
    APNS_KEY_ID          10-char key id
    APNS_TEAM_ID         10-char team id
    APNS_BUNDLE_ID       e.g. com.docmode.pal   (the voip topic gets .voip appended)
    APNS_ENV             sandbox | production
    FCM_PROJECT_ID       Firebase project id
    FCM_SERVICE_ACCOUNT_JSON_BASE64  base64 of the service-account JSON
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
from typing import Any

import httpx

log = logging.getLogger("pal.sarvam.push")

APNS_HOSTS = {
    "sandbox": "https://api.sandbox.push.apple.com",
    "production": "https://api.push.apple.com",
}
FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"


async def ring_device(
    *,
    platform: str,
    device_token: str,
    session_id: str,
    caller_name: str,
    handle: str,
    language: str,
) -> bool:
    payload = {
        "callId": session_id,
        "callerName": caller_name,
        "handle": handle,
        "language": language,
        "hasVideo": False,
        "wsPath": f"/api/voice/ws/{session_id}",
    }
    if platform == "ios":
        return await _apns_voip(device_token, payload)
    if platform == "android":
        return await _fcm_data(device_token, payload)
    return False


# ── iOS / PushKit ─────────────────────────────────────────────────────────────

def _apns_jwt() -> str:
    import jwt  # PyJWT, with cryptography installed

    key_b64 = os.environ["APNS_KEY_P8_BASE64"]
    return jwt.encode(
        {"iss": os.environ["APNS_TEAM_ID"], "iat": int(time.time())},
        base64.b64decode(key_b64).decode(),
        algorithm="ES256",
        headers={"kid": os.environ["APNS_KEY_ID"]},
    )


async def _apns_voip(token: str, payload: dict[str, Any]) -> bool:
    bundle = os.environ["APNS_BUNDLE_ID"]
    host = APNS_HOSTS.get(os.getenv("APNS_ENV", "sandbox"), APNS_HOSTS["sandbox"])
    async with httpx.AsyncClient(http2=True, timeout=10.0) as http:
        r = await http.post(
            f"{host}/3/device/{token}",
            json=payload,
            headers={
                "authorization": f"bearer {_apns_jwt()}",
                "apns-topic": f"{bundle}.voip",
                "apns-push-type": "voip",
                "apns-priority": "10",
                "apns-expiration": "0",
            },
        )
    if r.status_code != 200:
        log.warning("APNs VoIP rejected: %s %s", r.status_code, r.text[:200])
        return False
    return True


# ── Android / FCM ─────────────────────────────────────────────────────────────

_fcm_token_cache: dict[str, Any] = {"value": None, "expires": 0.0}


async def _fcm_access_token() -> str:
    if _fcm_token_cache["value"] and _fcm_token_cache["expires"] > time.time() + 60:
        return _fcm_token_cache["value"]

    import jwt

    sa = json.loads(base64.b64decode(os.environ["FCM_SERVICE_ACCOUNT_JSON_BASE64"]))
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": sa["client_email"],
            "scope": FCM_SCOPE,
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        },
        sa["private_key"],
        algorithm="RS256",
    )
    async with httpx.AsyncClient(timeout=10.0) as http:
        r = await http.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
    r.raise_for_status()
    body = r.json()
    _fcm_token_cache.update(
        value=body["access_token"], expires=time.time() + body.get("expires_in", 3600)
    )
    return body["access_token"]


async def _fcm_data(token: str, payload: dict[str, Any]) -> bool:
    project = os.environ["FCM_PROJECT_ID"]
    access = await _fcm_access_token()
    body = {
        "message": {
            "token": token,
            # Data-only: the app decides how to ring, so the OS never shows a
            # plain notification instead of the call UI.
            "data": {k: str(v) for k, v in payload.items()},
            "android": {"priority": "HIGH", "ttl": "45s", "direct_boot_ok": True},
        }
    }
    async with httpx.AsyncClient(timeout=10.0) as http:
        r = await http.post(
            f"https://fcm.googleapis.com/v1/projects/{project}/messages:send",
            json=body,
            headers={"Authorization": f"Bearer {access}"},
        )
    if r.status_code >= 300:
        log.warning("FCM rejected: %s %s", r.status_code, r.text[:200])
        return False
    return True
