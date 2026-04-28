"""
Day-2 D2-R1 (audit-2026-04-29) — chat-tool audit columns on ai_tool_use_log.

Phase 16 added chat-prompt observability (`prompt_excerpt`,
`response_excerpt`, `prompt_sections`, `user_id`). The Day-2 audit's
threat-model (`docs/audit-2026-04-29-day2/FINDINGS.md`, finding D2-R1)
called out two more gaps that the chat tool dispatcher needs to close
before Phase 17b ships call_with_tools:

  tool_args_json        TEXT  nullable — JSON-serialised args dict
                                          (truncated to 1000 chars), so
                                          a later operator review can
                                          tell *what* the LLM actually
                                          asked for without re-reading
                                          the upstream prompt log.
  tool_result_summary   TEXT  nullable — short human-readable summary
                                          of the dispatcher result
                                          (`"ok rows=12"`, `"error
                                          invalid_args"`, etc.) — keeps
                                          the table small while making
                                          per-tool latency / error
                                          dashboards trivial to write.

Idempotent — checks existing columns first.
"""
from __future__ import annotations

from sqlalchemy import text


_NEW_COLUMNS = {
    "tool_args_json": "TEXT",
    "tool_result_summary": "TEXT",
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
