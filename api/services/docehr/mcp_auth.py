"""OAuth2 client-credentials token provider for the DocEHR MCP server.

The DocEHR MCP now requires a bearer token on every call. This module fetches a
token once via the client-credentials grant and caches it in-process until shortly
before it expires, refreshing transparently. All DocEHR MCP callers (the FastMCP
bridge and the Anthropic MCP connector) use get_docehr_mcp_token().

If no client secret is configured, get_docehr_mcp_token() returns None and callers
send no Authorization header (preserving the previous unauthenticated behaviour).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

import httpx

from config import get_settings

logger = logging.getLogger("docehr.mcp_auth")

# In-process cache: the token and the monotonic time it should be refreshed at.
_token: Optional[str] = None
_refresh_at: float = 0.0
_lock = asyncio.Lock()


def _token_url(settings) -> str:
    """Explicit token URL, else {scheme}://{host}/oauth/token from the MCP URL."""
    if settings.docehr_mcp_token_url:
        return settings.docehr_mcp_token_url
    parts = urlsplit(settings.docehr_mcp_url)
    if not parts.scheme or not parts.netloc:
        return ""
    return urlunsplit((parts.scheme, parts.netloc, "/oauth/token", "", ""))


async def get_docehr_mcp_token(force: bool = False) -> Optional[str]:
    """Return a valid bearer token for the DocEHR MCP, fetching/refreshing as
    needed. Returns None when auth is not configured or a fetch fails."""
    global _token, _refresh_at

    settings = get_settings()
    if not settings.docehr_mcp_client_secret:
        return None  # auth disabled → caller sends no header

    now = time.monotonic()
    if not force and _token and now < _refresh_at:
        return _token

    async with _lock:
        # Re-check inside the lock (another coroutine may have refreshed it).
        now = time.monotonic()
        if not force and _token and now < _refresh_at:
            return _token

        url = _token_url(settings)
        if not url:
            logger.error("DocEHR MCP token URL could not be determined")
            return None

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    url,
                    data={
                        "grant_type": "client_credentials",
                        "client_id": settings.docehr_mcp_client_id,
                        "client_secret": settings.docehr_mcp_client_secret,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.error("DocEHR MCP token fetch failed: %s", exc)
            return None

        token = data.get("access_token") or data.get("token")
        if not token:
            logger.error("DocEHR MCP token response missing access_token: %s", data)
            return None

        try:
            expires_in = int(data.get("expires_in", 3600) or 3600)
        except (TypeError, ValueError):
            expires_in = 3600

        _token = token
        # Refresh 60s before actual expiry (floor of 30s to avoid hammering).
        _refresh_at = time.monotonic() + max(30, expires_in - 60)
        logger.info("DocEHR MCP token acquired (expires_in=%ss)", expires_in)
        return _token
