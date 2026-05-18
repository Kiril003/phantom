"""Cross-device handoff registry — `handoffs` table.

Mirrors `db.models.Handoff` declared by `api.routes_handoff`. The
table is also created on greenfield installs by
`Base.metadata.create_all`, but legacy DBs need this idempotent
``CREATE TABLE IF NOT EXISTS`` to land it without dropping the rest
of the schema.
"""
from __future__ import annotations

from sqlalchemy import text


_HANDOFFS_DDL = """
    CREATE TABLE IF NOT EXISTS handoffs (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        origin_device_id VARCHAR(36),
        target_device_id VARCHAR(36),
        kind VARCHAR(32) NOT NULL,
        title VARCHAR(160) NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        created_at DATETIME NOT NULL,
        expires_at DATETIME NOT NULL,
        resolved_at DATETIME,
        resolved_by_device_id VARCHAR(36)
    )
"""

_INDEX_DDL = [
    "CREATE INDEX IF NOT EXISTS ix_handoffs_user ON handoffs (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_handoffs_user_status ON handoffs (user_id, status)",
    "CREATE INDEX IF NOT EXISTS ix_handoffs_target ON handoffs (target_device_id)",
]


async def apply(conn) -> None:
    """Idempotent — `CREATE TABLE IF NOT EXISTS` + index DDL covers
    both fresh installs (where `Base.metadata.create_all` already ran)
    and upgraded ones missing the table."""
    await conn.execute(text(_HANDOFFS_DDL))
    for stmt in _INDEX_DDL:
        await conn.execute(text(stmt))
