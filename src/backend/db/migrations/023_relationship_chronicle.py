"""Phase 36 (Relationship Chronicle) — DDL Migrations.

Creates the epochs table to cluster historical memory episodes.
"""
from __future__ import annotations

from sqlalchemy import text


_EPOCHS_DDL = """
    CREATE TABLE IF NOT EXISTS epochs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT NOT NULL,
        start_time      REAL NOT NULL,
        end_time        REAL NOT NULL,
        topic_summary   TEXT,
        status          TEXT DEFAULT 'active',
        created_at      REAL NOT NULL
    )
"""

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_epochs_status ON epochs(status)",
    "CREATE INDEX IF NOT EXISTS idx_epochs_time ON epochs(start_time, end_time)",
]


async def apply(conn) -> None:
    await conn.execute(text(_EPOCHS_DDL))
    for ddl in _INDEXES:
        await conn.execute(text(ddl))
