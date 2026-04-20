"""
Phase 9.4b — add geo columns to memory_facts.

  place_name       TEXT nullable
  place_lat        REAL nullable
  place_lon        REAL nullable
  place_source     TEXT nullable
  place_confidence REAL nullable

All nullable, no backfill. Idempotent — re-running on a migrated DB
skips columns that are already present.
"""
from __future__ import annotations

from sqlalchemy import text


_NEW_COLUMNS = {
    "place_name": "TEXT",
    "place_lat": "REAL",
    "place_lon": "REAL",
    "place_source": "TEXT",
    "place_confidence": "REAL",
}


async def apply(conn) -> None:
    res = await conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_facts'")
    )
    if res.first() is None:
        return

    res = await conn.execute(text("PRAGMA table_info(memory_facts)"))
    existing = {row[1] for row in res.fetchall()}

    for col_name, col_type in _NEW_COLUMNS.items():
        if col_name in existing:
            continue
        await conn.execute(
            text(f"ALTER TABLE memory_facts ADD COLUMN {col_name} {col_type}")
        )
