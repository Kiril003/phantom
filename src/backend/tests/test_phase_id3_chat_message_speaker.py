"""Day-4 Wave-1 — Block ID-3: `chat_messages.speaker_user_id` column.

Implements ADR-ID-004 (`docs/architecture/identity-recognition.md` §4).
Closes the audit-2026-05-01-day4 schema gap that left STT speaker
matches with no persistence path.

Coverage:

* ORM declaration carries `speaker_user_id` (nullable, indexed,
  Optional[str], FK→users.id) — sanity gate against accidental drops.
* Default insert-without-speaker_user_id leaves the column NULL.
* An explicit `speaker_user_id` round-trips through the ORM.
* Migration `006_chat_message_speaker_user_id` is idempotent (running
  twice is a no-op) and handles a pre-existing column gracefully.
* Index `ix_chat_messages_speaker_user_id` is created.
* Back-compat: existing pre-Day-4 ChatMessage construction (no
  speaker_user_id) keeps working unchanged.
"""
from __future__ import annotations

import pytest

# ──────────────────────────────────────────────── ORM declaration ──


class TestOrmDeclaration:
    def test_speaker_user_id_column_present(self):
        from db.models import ChatMessage

        col = ChatMessage.__table__.columns.get("speaker_user_id")
        assert col is not None, "ID-3 regression: column dropped"
        assert col.nullable is True, "speaker_user_id must be nullable"
        # FK target.
        fks = list(col.foreign_keys)
        assert len(fks) == 1
        assert fks[0].column.table.name == "users"

    def test_speaker_user_id_indexed(self):
        from db.models import ChatMessage

        col = ChatMessage.__table__.columns.get("speaker_user_id")
        # SQLAlchemy's `index=True` generates an Index member on the
        # table; assert the column is part of one.
        indexed_cols = {
            c.name
            for idx in ChatMessage.__table__.indexes
            for c in idx.columns
        }
        assert "speaker_user_id" in indexed_cols, (
            "speaker_user_id must be indexed for Day-5 'rows by speaker' query"
        )


# ──────────────────────────────────────────────── insert / read ──


@pytest.fixture
async def session():
    from db.database import get_session, init_db
    await init_db()
    async with get_session() as s:
        yield s


@pytest.fixture
async def seed_users(session):
    from db.models import User

    holder = User(
        username=f"id3-holder-{id(session)}",
        role="ROOT",
        pin_hash="x",
    )
    speaker = User(
        username=f"id3-speaker-{id(session)}",
        role="OPERATOR",
        pin_hash="y",
    )
    session.add_all([holder, speaker])
    await session.flush()
    return holder, speaker


@pytest.fixture
async def chat_session_row(session, seed_users):
    from db.models import ChatSession

    holder, _ = seed_users
    cs = ChatSession(user_id=holder.id, summary="id-3 fixture")
    session.add(cs)
    await session.flush()
    return cs


class TestInsertReadRoundTrip:
    async def test_default_speaker_user_id_is_null(
        self, session, seed_users, chat_session_row
    ):
        """Day-4 invariant: nobody sets speaker_user_id in production
        (Day-5 wires it). Default insert leaves it NULL — no schema
        constraint forces a non-NULL value."""
        from sqlalchemy import select

        from db.models import ChatMessage

        holder, _ = seed_users
        msg = ChatMessage(
            session_id=chat_session_row.id,
            user_id=holder.id,
            role="user",
            content="hello",
        )
        session.add(msg)
        await session.flush()

        roundtrip = (
            await session.execute(
                select(ChatMessage).where(ChatMessage.id == msg.id)
            )
        ).scalar_one()
        assert roundtrip.speaker_user_id is None

    async def test_explicit_speaker_user_id_round_trips(
        self, session, seed_users, chat_session_row
    ):
        """Day-5 wiring contract: when the resolver matches, we copy the
        UUID into the ORM and it round-trips identical."""
        from sqlalchemy import select

        from db.models import ChatMessage

        holder, speaker = seed_users
        msg = ChatMessage(
            session_id=chat_session_row.id,
            user_id=holder.id,
            speaker_user_id=speaker.id,
            role="user",
            content="from speaker",
        )
        session.add(msg)
        await session.flush()

        roundtrip = (
            await session.execute(
                select(ChatMessage).where(ChatMessage.id == msg.id)
            )
        ).scalar_one()
        assert roundtrip.speaker_user_id == speaker.id
        # Crucial: holder and speaker may legitimately differ (the
        # ADR-ID-004 §125 example: Kiril logged in, daughter spoke).
        assert roundtrip.user_id == holder.id
        assert roundtrip.user_id != roundtrip.speaker_user_id


# ──────────────────────────────────────────────── migration ──


class TestMigrationIdempotence:
    async def test_migration_idempotent_on_current_db(self):
        """Day-4: by the time pytest fires, init_db + Base.metadata
        already added the column. Running the migration must be a no-op
        — never an exception, never a duplicate column."""
        import importlib

        from db.database import engine

        mod = importlib.import_module(
            "db.migrations.006_chat_message_speaker_user_id"
        )
        async with engine.begin() as conn:
            await mod.apply(conn)
            await mod.apply(conn)  # twice — must still be silent.

    async def test_migration_creates_index_when_absent(self):
        """Drop the index, re-run migration → index restored. Catches
        a regression that adds the column but forgets the CREATE INDEX
        clause."""
        import importlib

        from sqlalchemy import text

        from db.database import engine

        mod = importlib.import_module(
            "db.migrations.006_chat_message_speaker_user_id"
        )

        index_name = "ix_chat_messages_speaker_user_id"
        async with engine.begin() as conn:
            await conn.execute(text(f"DROP INDEX IF EXISTS {index_name}"))
            await mod.apply(conn)
            res = await conn.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type='index' "
                    f"AND name='{index_name}'"
                )
            )
            assert res.first() is not None, (
                "ID-3 regression: migration 006 dropped the index recreation"
            )


# ──────────────────────────────────────────────── back-compat ──


class TestBackCompat:
    async def test_pre_id3_construction_still_works(
        self, session, seed_users, chat_session_row
    ):
        """Day-3 code that constructs `ChatMessage(session_id=..., user_id=...,
        role=..., content=...)` without naming `speaker_user_id` must
        keep working — the column has a default of `None` so callers
        that didn't know about Day-4's ID-3 stay correct."""
        from db.models import ChatMessage

        holder, _ = seed_users
        # Mirrors how `ai/chat_pipeline.py` and similar old code paths
        # construct rows.
        msg = ChatMessage(
            session_id=chat_session_row.id,
            user_id=holder.id,
            role="user",
            content="legacy-shape",
            response_form="text",
            metadata_json="{}",
            attachments_json="[]",
        )
        session.add(msg)
        await session.flush()
        assert msg.speaker_user_id is None
