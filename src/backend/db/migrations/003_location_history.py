"""
Phase 9.4b — create ``location_history`` table.

Fresh DBs get the table via create_all; this migration exists so
pre-9.4b databases stay compatible after the upgrade without an explicit
schema rebuild.
"""
from __future__ import annotations

from sqlalchemy import text


_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS location_history (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    source      TEXT NOT NULL,
    confidence  REAL NOT NULL DEFAULT 0.0,
    accuracy_m  REAL,
    place_name  TEXT,
    country     TEXT,
    country_code TEXT,
    city        TEXT,
    timestamp   DATETIME NOT NULL
)
"""

_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS ix_location_history_user_id ON location_history(user_id);
CREATE INDEX IF NOT EXISTS ix_location_history_timestamp ON location_history(timestamp);
"""


async def apply(conn) -> None:
    await conn.execute(text(_CREATE_SQL))
    for stmt in _INDEX_SQL.strip().split(";"):
        stmt = stmt.strip()
        if stmt:
            await conn.execute(text(stmt))
