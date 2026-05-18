"""013_agent_user_ids — backfill `user_id` column on agent runtime tables.

Adds `user_id VARCHAR(36)` to:
  agent_tasks, agent_audit, agent_checkpoints, agent_memory_seeds, agent_feedback

The ORM (`db/models.py:AgentTask`) declares the column, so fresh installs
get it via `Base.metadata.create_all`. Legacy DBs created before the
multi-user split need this idempotent ALTER so the agent runtime startup
hook doesn't crash with
`OperationalError: no such column: agent_tasks.user_id`.

Earlier revision used `def upgrade(connection)` which the migration
runner (`db.migrations.__init__.apply_pending`) silently skipped — it
only invokes `module.apply`. Renamed + made async to match the contract
the rest of the migrations follow.

Idempotent — PRAGMA-gates the ALTER and uses CREATE INDEX IF NOT EXISTS.
Re-running on a current DB is a no-op.
"""
from __future__ import annotations

import re

from sqlalchemy import text

# Existing rows must be backfilled with *some* user_id. Default to the
# first registered user (the ROOT created by `ensure_default_user`); fall
# back to the nil-UUID if the users table is empty.
_NIL_UUID = "00000000-0000-0000-0000-000000000000"
_UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")

_TABLES = (
    "agent_tasks",
    "agent_audit",
    "agent_checkpoints",
    "agent_memory_seeds",
    "agent_feedback",
)


async def apply(conn) -> None:
    res = await conn.execute(
        text("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
    )
    row = res.first()
    candidate = row[0] if row else _NIL_UUID
    # SQLite ALTER TABLE ... DEFAULT cannot bind parameters, so we
    # interpolate. Validate the UUID shape so a malformed user id
    # cannot inject SQL through the literal.
    default_user_id = candidate if _UUID_RE.match(str(candidate)) else _NIL_UUID

    for table in _TABLES:
        res = await conn.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=:n"
            ),
            {"n": table},
        )
        if res.first() is None:
            continue

        res = await conn.execute(text(f"PRAGMA table_info({table})"))
        columns = {r[1] for r in res.fetchall()}
        if "user_id" not in columns:
            await conn.execute(
                text(
                    f"ALTER TABLE {table} ADD COLUMN user_id VARCHAR(36) "
                    f"NOT NULL DEFAULT '{default_user_id}'"
                )
            )

        await conn.execute(
            text(
                f"CREATE INDEX IF NOT EXISTS ix_{table}_user "
                f"ON {table}(user_id)"
            )
        )
