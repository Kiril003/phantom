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
    """Run every numbered migration in this package, in order. Returns names applied."""
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
                logger.warning("migration %s failed (continuing): %s", name, exc)
    return applied
