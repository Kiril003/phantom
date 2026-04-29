"""Day-4 Wave-2 T-1 (ADR-SOH-001) — `standing_orders.{in_flight_task_id,
claimed_at}` lease columns.

Idempotent — re-running on a current DB is a no-op. Safe on fresh
DBs (`Base.metadata.create_all` already added the columns declared
in `db/models.py:StandingOrder`; this migration only fires on
databases created before Day-4 Wave-2).

Both columns default NULL so existing rows + Day-3 tests stay
byte-compatible.
"""
from __future__ import annotations

from sqlalchemy import text


async def apply(conn) -> None:
    # Skip when the table doesn't exist (fresh-install pre-init_db).
    res = await conn.execute(
        text(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name='standing_orders'"
        )
    )
    if res.first() is None:
        return

    # Skip when columns already present (re-run safety).
    res = await conn.execute(text("PRAGMA table_info(standing_orders)"))
    cols = {row[1] for row in res.fetchall()}
    if "in_flight_task_id" not in cols:
        await conn.execute(
            text(
                "ALTER TABLE standing_orders "
                "ADD COLUMN in_flight_task_id VARCHAR(36)"
            )
        )
    if "claimed_at" not in cols:
        await conn.execute(
            text(
                "ALTER TABLE standing_orders ADD COLUMN claimed_at DATETIME"
            )
        )
    # Idempotent index on the lease-claim column.
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_standing_orders_in_flight_task_id "
            "ON standing_orders (in_flight_task_id)"
        )
    )
