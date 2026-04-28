"""Day-4 Block ID-3 (ADR-ID-004) — `chat_messages.speaker_user_id`.

Closes audit U6-ID schema gap. Adds a nullable `speaker_user_id`
column to `chat_messages` so the Day-5 ML resolver
(`voice.identity.resolver.resolve_speaker`) has somewhere to persist
the *who actually spoke into the mic* answer, distinct from `user_id`
(the JWT-authenticated session owner).

Day-4 leaves the column NULL forever — no code populates it. Day-5
strategic-memory writers will copy `STTResult.speaker_id` into this
column on chat-row insert.

Idempotent — re-running on a current DB is a no-op. Safe on fresh
DBs (`Base.metadata.create_all` already added the column declared in
`db/models.py:ChatMessage`; this migration only fires on databases
created before Day-4).
"""
from __future__ import annotations

from sqlalchemy import text


async def apply(conn) -> None:
    # Skip when the table doesn't exist (fresh-install pre-init_db).
    res = await conn.execute(
        text(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name='chat_messages'"
        )
    )
    if res.first() is None:
        return

    # SQLite caveat: `ALTER TABLE ADD COLUMN` cannot create a foreign-key
    # constraint on the new column (the FK is enforced only when the
    # column ships in the original `CREATE TABLE`). The ORM declaration
    # in `db/models.py:ChatMessage.speaker_user_id` carries the
    # `ForeignKey` for type-system + relationship purposes; the live
    # migration here is permissive (`VARCHAR(36) NULL`) and Day-5+ data
    # writes are responsible for honoring the reference. This matches
    # how prior migrations (`002_memory_facts_geo.py`,
    # `005_chat_tool_audit.py`) handle column adds on SQLite.
    res = await conn.execute(text("PRAGMA table_info(chat_messages)"))
    existing = {row[1] for row in res.fetchall()}
    if "speaker_user_id" not in existing:
        await conn.execute(
            text(
                "ALTER TABLE chat_messages "
                "ADD COLUMN speaker_user_id VARCHAR(36) NULL"
            )
        )

    # CREATE INDEX is its own statement; runs unconditionally because
    # `IF NOT EXISTS` makes it idempotent. We do NOT gate it on the
    # column-add branch — the index might be missing on a DB where the
    # column was added by `Base.metadata.create_all` (which only sets
    # `index=True` metadata, not a separate CREATE INDEX, in some ORM
    # paths) and we want the index to land regardless.
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_chat_messages_speaker_user_id "
            "ON chat_messages(speaker_user_id)"
        )
    )
