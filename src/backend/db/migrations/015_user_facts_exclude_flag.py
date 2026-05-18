"""015_user_facts_exclude_flag — add exclude_from_prompts column to user_facts.

Adds:
  user_facts.exclude_from_prompts  BOOLEAN NOT NULL DEFAULT 0

Operator-facing trust feature: when True the fact is never surfaced in
planner/chat LLM context but remains visible in the IntelligenceHub UI so
the operator can un-exclude it later.  Deletion is NOT the mechanism — only
filtering.

Idempotent: PRAGMA table_info gate prevents duplicate ALTERs.  Safe on fresh
DBs (where create_all already added the column from the updated ORM model).
Re-running on a current DB is a no-op.
"""
from __future__ import annotations

from sqlalchemy import text


async def apply(conn) -> None:
    res = await conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='user_facts'")
    )
    if res.first() is None:
        # Fresh install — create_all will add the column from the ORM model.
        return

    res = await conn.execute(text("PRAGMA table_info(user_facts)"))
    columns = {r[1] for r in res.fetchall()}

    if "exclude_from_prompts" not in columns:
        await conn.execute(
            text(
                "ALTER TABLE user_facts "
                "ADD COLUMN exclude_from_prompts BOOLEAN NOT NULL DEFAULT 0"
            )
        )
