"""Day-4 Wave-2 FACTS-1 (ADR-FCT-001) — `user_facts` table.

Closes U6-ID schema gap (no place to persist encrypted profile
identity material like email/phone/telegram/discord/file_pointer).

The model is declared in `db/models.py:UserFact`. `Base.metadata.
create_all` already creates the table on a fresh DB. This migration
covers existing-DB upgrades only.

Idempotent — re-running on a current DB is a no-op.
"""
from __future__ import annotations

from sqlalchemy import text


async def apply(conn) -> None:
    # Skip when an already-migrated DB has the table.
    res = await conn.execute(
        text(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name='user_facts'"
        )
    )
    if res.first() is not None:
        return

    await conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS user_facts ("
            "  id VARCHAR(36) PRIMARY KEY,"
            "  user_id VARCHAR(36) NOT NULL,"
            "  category VARCHAR(32) NOT NULL,"
            "  label VARCHAR(128),"
            "  value_encrypted TEXT NOT NULL,"
            "  created_at DATETIME,"
            "  updated_at DATETIME,"
            "  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
            ")"
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_user_facts_user_id "
            "ON user_facts (user_id)"
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_user_facts_user_category "
            "ON user_facts (user_id, category)"
        )
    )
