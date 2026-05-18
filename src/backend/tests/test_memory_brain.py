from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest


@pytest.fixture()
async def memory_user_and_db():
    from db.database import get_session, init_db
    from db.models import User

    await init_db()
    user_id = str(uuid.uuid4())
    async with get_session() as db:
        db.add(
            User(
                id=user_id,
                username=f"pytest_memory_{user_id[:8]}",
                role="ROOT",
                pin_hash="x",
                rfid_uid_hash=None,
                preferences_json="{}",
            )
        )
        await db.commit()

    async with get_session() as db:
        yield user_id, db


class TestMemoryBrainExtraction:
    @pytest.mark.asyncio
    async def test_extracts_explicit_and_stable_facts_without_storing_questions(self, monkeypatch):
        from memory.brain import extract_memory_writes
        from ai.tool_use import ToolCallResult

        async def fake_call_with_tools(**kw):
            return ToolCallResult(
                tool_name="extract_facts",
                arguments={
                    "facts": [
                        {
                            "content": "Я працюю над Phantom OS.",
                            "category": "explicit",
                            "importance": 0.9,
                            "durable": True,
                            "reason": "explicit request"
                        },
                        {
                            "content": "Я люблю короткі відповіді.",
                            "category": "preference",
                            "importance": 0.8,
                            "durable": True,
                            "reason": "user preference"
                        }
                    ]
                },
                provider="test",
                model="test"
            )

        import ai.provider
        monkeypatch.setattr(ai.provider.ai_router, "call_with_tools", fake_call_with_tools)

        writes = await extract_memory_writes(
            "Привіт. Що по погоді? Запам'ятай, що я працюю над Phantom OS. "
            "Я люблю короткі відповіді."
        )

        contents = [w.content for w in writes]
        assert "Я працюю над Phantom OS." in contents
        assert any("Я люблю короткі відповіді" in c for c in contents)
        assert all("погод" not in c.lower() for c in contents)
        assert any(w.durable for w in writes)


class TestMemoryBrainWriteRecall:
    @pytest.mark.asyncio
    async def test_remember_text_dual_writes_stable_fact(
        self, memory_user_and_db, monkeypatch
    ):
        from db.models import MemoryFact
        from memory.brain import memory_brain
        from sqlalchemy import select
        from ai.tool_use import ToolCallResult
        import ai.provider

        async def fake_call_with_tools(**kw):
            return ToolCallResult(
                tool_name="extract_facts",
                arguments={
                    "facts": [
                        {
                            "content": "Я віддаю перевагу дуже стислим відповідям.",
                            "category": "preference",
                            "importance": 0.9,
                            "durable": True,
                            "reason": "explicit preference"
                        }
                    ]
                },
                provider="test",
                model="test"
            )
        monkeypatch.setattr(ai.provider.ai_router, "call_with_tools", fake_call_with_tools)

        user_id, db = memory_user_and_db
        strategic_store = AsyncMock(return_value="fact-id")
        monkeypatch.setattr("memory.strategic_memory.store_fact", strategic_store)

        report = await memory_brain.remember_text(
            db=db,
            user_id=user_id,
            session_id=str(uuid.uuid4()),
            text="Запам'ятай, що я віддаю перевагу дуже стислим відповідям.",
            source="test",
        )

        assert report.stored_ids
        assert report.strategic_ids == report.stored_ids
        strategic_store.assert_awaited_once()

        rows = (
            await db.execute(select(MemoryFact).where(MemoryFact.user_id == user_id))
        ).scalars().all()
        assert len(rows) == 1
        assert "стислим відповідям" in rows[0].content
        assert rows[0].embedding_id == rows[0].id

    @pytest.mark.asyncio
    async def test_recall_filters_sql_facts_by_query(
        self, memory_user_and_db, monkeypatch
    ):
        from memory.brain import memory_brain
        from memory.tactical_memory import store_fact

        user_id, db = memory_user_and_db
        monkeypatch.setattr(
            "memory.strategic_memory.retrieve_relevant",
            AsyncMock(return_value=[]),
        )

        await store_fact(
            db,
            user_id,
            session_id=str(uuid.uuid4()),
            content="Користувач любить короткі відповіді.",
            category="preference",
            importance=0.8,
        )
        await store_fact(
            db,
            user_id,
            session_id=str(uuid.uuid4()),
            content="Користувач працює з 3D-принтером.",
            category="profile",
            importance=0.8,
        )
        await db.flush()

        hits = await memory_brain.recall(
            db=db,
            user_id=user_id,
            query="що пам'ятаєш про короткі відповіді",
            limit=5,
            include_agent=False,
        )

        contents = [h.content for h in hits]
        assert any("короткі відповіді" in c for c in contents)
        assert all("3D-принтер" not in c for c in contents)
