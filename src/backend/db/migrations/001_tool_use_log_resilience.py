"""
Phase 9.2.1 — add resilience telemetry columns to ai_tool_use_log.

retry_after_s: REAL nullable
fell_through_to_fallback: BOOL default 0
cooling_triggered: BOOL default 0

Idempotent — checks existing columns first.
"""
from __future__ import annotations

from sqlalchemy import text


_NEW_COLUMNS = {
    "retry_after_s": "REAL",
    "fell_through_to_fallback": "BOOLEAN NOT NULL DEFAULT 0",
    "cooling_triggered": "BOOLEAN NOT NULL DEFAULT 0",
}


async def apply(conn) -> None:
    # Confirm the table exists — first-boot create_all will have made it,
    # but a fresh DB might race the migration call.
    res = await conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_tool_use_log'")
    )
    if res.first() is None:
        return

    res = await conn.execute(text("PRAGMA table_info(ai_tool_use_log)"))
    existing = {row[1] for row in res.fetchall()}  # row[1] = column name

    for col_name, col_type in _NEW_COLUMNS.items():
        if col_name in existing:
            continue
        await conn.execute(
            text(f"ALTER TABLE ai_tool_use_log ADD COLUMN {col_name} {col_type}")
        )
