"""Phase 12.0 (Cognitive Memory Engine) — Temporal facts, core narrative logs, curiosity queue.

Schema delta:
  • memory_facts       — Add valid_from, valid_until, superseded_by, entity_slot, sentiment_score.
  • core_narrative_log — Versioned core narrative text log.
  • curiosity_queue    — Subconscious curiosity question queue.

Idempotent: PRAGMA table_info guards column additions, CREATE TABLE IF NOT EXISTS
covers table creations.
"""
from __future__ import annotations

from sqlalchemy import text


_CORE_NARRATIVE_LOG_DDL = """
    CREATE TABLE IF NOT EXISTS core_narrative_log (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        version INTEGER NOT NULL DEFAULT 1,
        text TEXT NOT NULL,
        diff_summary TEXT,
        created_at DATETIME NOT NULL
    )
"""

_CURIOSITY_QUEUE_DDL = """
    CREATE TABLE IF NOT EXISTS curiosity_queue (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        created_at DATETIME NOT NULL
    )
"""

_INDEX_DDL = [
    "CREATE INDEX IF NOT EXISTS ix_core_narrative_log_user ON core_narrative_log (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_core_narrative_log_created ON core_narrative_log (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_curiosity_queue_user ON curiosity_queue (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_curiosity_queue_created ON curiosity_queue (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_memory_facts_entity_slot ON memory_facts (entity_slot)",
]


async def apply(conn) -> None:
    # 1) core_narrative_log table
    await conn.execute(text(_CORE_NARRATIVE_LOG_DDL))

    # 2) curiosity_queue table
    await conn.execute(text(_CURIOSITY_QUEUE_DDL))

    # 3) memory_facts columns - guarded ALTER
    cols_result = await conn.execute(text("PRAGMA table_info(memory_facts)"))
    existing_cols = {row[1] for row in cols_result.fetchall()}

    if "valid_from" not in existing_cols:
        await conn.execute(
            text("ALTER TABLE memory_facts ADD COLUMN valid_from DATETIME DEFAULT CURRENT_TIMESTAMP")
        )
    if "valid_until" not in existing_cols:
        await conn.execute(
            text("ALTER TABLE memory_facts ADD COLUMN valid_until DATETIME")
        )
    if "superseded_by" not in existing_cols:
        await conn.execute(
            text("ALTER TABLE memory_facts ADD COLUMN superseded_by VARCHAR(36)")
        )
    if "entity_slot" not in existing_cols:
        await conn.execute(
            text("ALTER TABLE memory_facts ADD COLUMN entity_slot VARCHAR(64)")
        )
    if "sentiment_score" not in existing_cols:
        await conn.execute(
            text("ALTER TABLE memory_facts ADD COLUMN sentiment_score FLOAT DEFAULT 0.0")
        )

    # 4) indexes
    for ddl in _INDEX_DDL:
        await conn.execute(text(ddl))
