"""016_agent_chat_thread — V2 conversational agent chat table.

Creates `agent_chat_threads` when it does not already exist (fresh installs
have it from create_all; this migration covers existing DBs).
Idempotent — CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
"""
from __future__ import annotations

from sqlalchemy import text


async def apply(conn) -> None:
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS agent_chat_threads (
            id          VARCHAR(36) PRIMARY KEY,
            task_id     VARCHAR(36) NOT NULL,
            role        VARCHAR(16) NOT NULL,
            content     TEXT        NOT NULL,
            created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_agent_chat_threads_task "
        "ON agent_chat_threads(task_id)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_agent_chat_threads_task_created "
        "ON agent_chat_threads(task_id, created_at)"
    ))
