"""
Lightweight numbered migrations.

PHANTOM doesn't carry alembic — schema is created via Base.metadata.create_all,
which doesn't add columns to existing tables. When a Phase needs new columns
on an existing table, drop a `NNN_*.py` file here exposing
`async def apply(conn) -> None`. `apply_pending(engine)` is idempotent —
each migration introspects the table and skips its own work if already
applied, so re-running on a current DB is a no-op.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil

logger = logging.getLogger(__name__)


async def apply_pending(engine) -> list[str]:
    """Run every numbered migration in this package, in order.

    Rebuild P1: FAIL-CLOSED. A failing migration raises RuntimeError and
    the caller (init_db) refuses to boot — the previous swallow-and-warn
    behaviour let the daemon serve a half-migrated schema. This runner is
    now only invoked once per legacy DB, to bring it to the Alembic
    baseline (see db/database.init_db); new schema changes go into
    db/alembic/versions/.
    """
    applied: list[str] = []
    names = sorted(
        name
        for _, name, _ in pkgutil.iter_modules(__path__)
        if name[:3].isdigit()
    )
    async with engine.begin() as conn:
        for name in names:
            try:
                module = importlib.import_module(f"db.migrations.{name}")
                if hasattr(module, "apply"):
                    await module.apply(conn)
                    applied.append(name)
            except Exception as exc:
                raise RuntimeError(
                    f"legacy migration {name} failed — refusing to boot on a "
                    f"half-migrated schema: {exc}"
                ) from exc
    return applied
