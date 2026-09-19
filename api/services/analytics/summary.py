"""Admin-facing analytics summary queries."""
from datetime import date
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def conversion_summary(
    db: AsyncSession,
    date_from: date,
    date_to: date,
    group_by: str = "source",
) -> list[dict]:
    """
    Returns conversion funnel grouped by 'source' or 'doctor'.

    Funnel: app_install → search_turn|call_started
    Conversion rate = engaged ÷ installs
    """
    if group_by == "doctor":
        group_col = "doctor_id"
    else:
        group_col = "source"

    stmt = text(f"""
        SELECT
            {group_col}                                                         AS group_key,
            COUNT(*) FILTER (WHERE event_type = 'app_install')                  AS installs,
            COUNT(*) FILTER (WHERE event_type = 'hermes_notification_sent')     AS notifications_sent,
            COUNT(*) FILTER (WHERE event_type = 'notification_opened')          AS opens,
            COUNT(*) FILTER (
                WHERE event_type IN ('search_turn', 'call_started')
            )                                                                    AS conversions
        FROM analytics_events
        WHERE ts >= :from_ts AND ts < :to_ts
        GROUP BY {group_col}
        ORDER BY installs DESC
        LIMIT 200
    """)

    result = await db.execute(stmt, {
        "from_ts": date_from,
        "to_ts": date_to,
    })
    rows = result.mappings().all()

    out = []
    for r in rows:
        installs = r["installs"] or 0
        conversions = r["conversions"] or 0
        out.append({
            "group_key": r["group_key"],
            "group_by": group_by,
            "installs": installs,
            "notifications_sent": r["notifications_sent"] or 0,
            "opens": r["opens"] or 0,
            "conversions": conversions,
            "conversion_rate": round(conversions / installs, 4) if installs else 0.0,
        })
    return out
