"""Will Engine — DDL for budget ledger, journal, and goal source column."""
from __future__ import annotations

from sqlalchemy import text

_LEDGER_DDL = """
    CREATE TABLE IF NOT EXISTS will_budget_ledger (
        user_id     TEXT NOT NULL,
        ledger_date TEXT NOT NULL,
        llm_calls   INTEGER NOT NULL DEFAULT 0,
        tokens      INTEGER NOT NULL DEFAULT 0,
        updated_at  REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, ledger_date)
    )
"""

_JOURNAL_DDL = """
    CREATE TABLE IF NOT EXISTS will_journal (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL,
        ts                REAL NOT NULL,
        decision_json     TEXT NOT NULL DEFAULT '{}',
        action            TEXT NOT NULL DEFAULT '',
        task_id           TEXT,
        outcome           TEXT NOT NULL DEFAULT '',
        budget_delta_json TEXT NOT NULL DEFAULT '{}'
    )
"""

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_will_journal_user ON will_journal(user_id, ts)",
]


async def apply(conn) -> None:
    await conn.execute(text(_LEDGER_DDL))
    await conn.execute(text(_JOURNAL_DDL))
    for ddl in _INDEXES:
        await conn.execute(text(ddl))
    # Idempotent ADD COLUMN — SQLite has no IF NOT EXISTS for columns.
    cols = [r[1] for r in (await conn.execute(text("pragma table_info(goals_persistent)"))).all()]
    if "source" not in cols:
        await conn.execute(text(
            "ALTER TABLE goals_persistent ADD COLUMN source TEXT NOT NULL DEFAULT 'seeded'"))
