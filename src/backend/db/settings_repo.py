"""
Settings persistence — DB-backed override layer for PhantomConfig.

`load_all()` reads every `settings` row and JSON-decodes values into a dict
that `config.apply_overrides(...)` can consume. Called at startup BEFORE any
module that reads config (serial bridge, AI providers, logging reconfig).

`save(key, value, user_id)` upserts a single row. Called from PUT /settings.
`delete(keys)` removes overrides so next restart falls back to env/defaults.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Iterable

from sqlalchemy import delete as sql_delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from db.database import get_session
from db.models import Setting

logger = logging.getLogger(__name__)


async def load_all() -> dict[str, Any]:
    """
    Read every persisted setting. Returns a `{key: decoded_value}` dict.
    Malformed JSON rows are logged and skipped so one bad row never blocks
    startup.
    """
    out: dict[str, Any] = {}
    async with get_session() as db:
        rows = (await db.execute(select(Setting))).scalars().all()
    for row in rows:
        try:
            out[row.key] = json.loads(row.value_json)
        except json.JSONDecodeError as exc:
            logger.warning("settings_repo: skipping malformed row %s: %s", row.key, exc)
    return out


async def save(key: str, value: Any, user_id: str | None = None) -> None:
    """
    Upsert a single setting. SQLite-specific ON CONFLICT keeps this atomic
    (one round-trip, no read-then-write race).
    """
    value_json = json.dumps(value)
    async with get_session() as db:
        stmt = sqlite_insert(Setting).values(
            key=key,
            value_json=value_json,
            updated_by=user_id,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[Setting.key],
            set_={"value_json": value_json, "updated_by": user_id},
        )
        await db.execute(stmt)


async def delete(keys: Iterable[str]) -> int:
    """
    Remove overrides for the given keys. Used by POST /settings/reset so that
    next restart truly falls back to env/defaults, not stale DB overrides.
    Returns the number of rows deleted.
    """
    key_list = list(keys)
    if not key_list:
        return 0
    async with get_session() as db:
        result = await db.execute(sql_delete(Setting).where(Setting.key.in_(key_list)))
    return result.rowcount or 0
