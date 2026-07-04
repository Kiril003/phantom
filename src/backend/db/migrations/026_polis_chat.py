"""ПОЛІС mission room — chat_json column on polis_missions."""
from __future__ import annotations

from sqlalchemy import text


async def apply(conn) -> None:
    rows = (await conn.execute(text("pragma table_info(polis_missions)"))).all()
    if not rows:
        return  # table not created yet — create_all will include the column
    cols = [r[1] for r in rows]
    if "chat_json" not in cols:
        await conn.execute(text(
            "ALTER TABLE polis_missions ADD COLUMN chat_json TEXT NOT NULL DEFAULT '[]'"
        ))
