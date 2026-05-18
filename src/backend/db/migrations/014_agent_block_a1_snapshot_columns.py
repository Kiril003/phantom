"""014_agent_block_a1_snapshot_columns — Block A-1 crash-recovery columns.

Adds two columns to `agent_tasks`:
  * `runtime_snapshot_json TEXT` — full TaskState JSON blob written after each
    completed step / Council call / substate flip. `rehydrate_task()` decodes
    it on cold start; legacy rows with NULL fall back to the per-column blobs.
  * `mission_id VARCHAR(36)` — denormalised FK to `agent_missions.id` so the
    boot resumer can skip a join.

Plus an index on `mission_id` for the "find all tasks for this mission"
queries the rehydrate path makes.

Idempotent — PRAGMA-gates the ALTERs and uses `CREATE INDEX IF NOT EXISTS`.
Safe on fresh DBs (where `create_all` already added the columns from the
ORM model). Re-running on a current DB is a no-op.
"""
from __future__ import annotations

from sqlalchemy import text


async def apply(conn) -> None:
    res = await conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_tasks'")
    )
    if res.first() is None:
        # Fresh install before `create_all` ran — nothing to migrate.
        return

    res = await conn.execute(text("PRAGMA table_info(agent_tasks)"))
    columns = {r[1] for r in res.fetchall()}

    if "runtime_snapshot_json" not in columns:
        await conn.execute(
            text("ALTER TABLE agent_tasks ADD COLUMN runtime_snapshot_json TEXT")
        )

    if "mission_id" not in columns:
        await conn.execute(
            text("ALTER TABLE agent_tasks ADD COLUMN mission_id VARCHAR(36)")
        )

    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_agent_tasks_mission "
            "ON agent_tasks(mission_id)"
        )
    )
