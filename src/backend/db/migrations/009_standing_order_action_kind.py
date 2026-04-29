"""Day-4 Wave-2 T-2 (ADR-SOH-003) — `standing_orders.action_kind`
denormalised column + backfill.

Idempotent — re-running on a current DB is a no-op. Safe on fresh
DBs (`Base.metadata.create_all` already added the column declared
in `db/models.py:StandingOrder.action_kind`).

Backfill rule:
  - `json_extract(action_json, '$.kind')` when the JSON has a `kind`
    field (typed path).
  - "task" otherwise (legacy `{"goal": "..."}` shorthand or corrupt
    JSON — preserves the existing single-mode behaviour).

The column is nullable because the runner's INSERT path (POST
`/standing-orders/`) hasn't been retargeted to populate it yet on
Day-4 (T-2 ships only the schema + parse_action; the dispatcher
wiring is Day-5).
"""
from __future__ import annotations

from sqlalchemy import text


async def apply(conn) -> None:
    res = await conn.execute(
        text(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name='standing_orders'"
        )
    )
    if res.first() is None:
        return

    res = await conn.execute(text("PRAGMA table_info(standing_orders)"))
    cols = {row[1] for row in res.fetchall()}
    if "action_kind" not in cols:
        await conn.execute(
            text(
                "ALTER TABLE standing_orders ADD COLUMN action_kind VARCHAR(16)"
            )
        )

    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_standing_orders_action_kind "
            "ON standing_orders (action_kind)"
        )
    )

    # Backfill: prefer JSON-extracted kind; fall back to "task" for
    # the legacy {"goal": ...} shorthand or corrupt rows. Idempotent
    # because the WHERE filters out rows already populated.
    await conn.execute(
        text(
            "UPDATE standing_orders "
            "SET action_kind = COALESCE("
            "    json_extract(action_json, '$.kind'), 'task') "
            "WHERE action_kind IS NULL"
        )
    )
