#!/usr/bin/env python3
"""
Drain / backfill pipeline for iNutriMon nutrition webhooks.

The /webhook-inutrimon endpoint stores every event raw in `webhook_events` and
projects nutrition prescriptions into the relational tables inline. This script is
the durable catch-up half of the pipeline: it finds any `source='inutrimon'`
rows still `processed = FALSE` — events that arrived before projection existed, or
that failed inline — projects them, and marks them processed.

Idempotent: projection replaces a prescription by its handover id, so re-running is
safe. Run it once to backfill, and/or on a schedule (cron / celery beat) as a
safety net.

Usage (inside the mcp container):
    docker compose -f docker-compose.prod.yml exec mcp-api python process_nutrition_webhooks.py

Connection: DATABASE_URL if set, else built from the POSTGRES_* env (host `db`).
"""
import asyncio
import json
import os
import sys

from create_nutrition_tables import _dsn  # reuse the same DSN logic
from nutrition_store import store_nutrition_prescription


def _as_payload(raw) -> dict:
    """webhook_events.payload may come back as a JSON string (jsonb/text) or already
    a dict (if a codec is set). Normalise to a dict."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (str, bytes)):
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return {}
    return {}


async def main() -> int:
    import asyncpg
    conn = await asyncpg.connect(_dsn())
    stored = skipped = failed = 0
    try:
        rows = await conn.fetch(
            "SELECT id, payload FROM webhook_events "
            "WHERE source = 'inutrimon' AND processed = FALSE "
            "ORDER BY timestamp ASC"
        )
        print(f"Found {len(rows)} unprocessed iNutriMon event(s).")
        for r in rows:
            wid = r["id"]
            payload = _as_payload(r["payload"])
            try:
                pid = await store_nutrition_prescription(conn, payload)
                # Handled either way (projected, or nothing to project) → mark done.
                await conn.execute("UPDATE webhook_events SET processed = TRUE WHERE id = $1", wid)
                if pid:
                    stored += 1
                    print(f"  ✓ event {wid}: projected prescription {pid}")
                else:
                    skipped += 1
                    print(f"  – event {wid}: no nutrition prescription in payload (marked done)")
            except Exception as exc:  # leave processed = FALSE so a later run retries
                failed += 1
                print(f"  ✗ event {wid}: FAILED — {exc}", file=sys.stderr)
        print(f"Done. projected={stored} skipped={skipped} failed={failed}")
        return 1 if failed else 0
    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
