"""
Phase 16 (audit-2026-04-28 step 4) — per-chat-turn observability columns
on ai_tool_use_log:

  user_id          STRING(36)  nullable, indexed — who issued the turn
  prompt_excerpt   TEXT        nullable — truncated system prompt
  response_excerpt TEXT        nullable — truncated AI response
  prompt_sections  STRING(256) nullable — comma-separated section flags

Idempotent — checks existing columns first.
"""
from __future__ import annotations

from sqlalchemy import text


_NEW_COLUMNS = {
    "user_id": "VARCHAR(36)",
    "prompt_excerpt": "TEXT",
    "response_excerpt": "TEXT",
    "prompt_sections": "VARCHAR(256)",
}


async def apply(conn) -> None:
    res = await conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_tool_use_log'")
    )
    if res.first() is None:
        return

    res = await conn.execute(text("PRAGMA table_info(ai_tool_use_log)"))
    existing = {row[1] for row in res.fetchall()}

    for col_name, col_type in _NEW_COLUMNS.items():
        if col_name in existing:
            continue
        await conn.execute(
            text(f"ALTER TABLE ai_tool_use_log ADD COLUMN {col_name} {col_type}")
        )

    # Index on user_id for per-tenant queries. SQLite IF NOT EXISTS keeps
    # this idempotent across reruns.
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_ai_tool_use_log_user_id "
            "ON ai_tool_use_log (user_id)"
        )
    )
