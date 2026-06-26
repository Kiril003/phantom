from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import select
from unittest.mock import MagicMock, AsyncMock

from db.models import MemoryFact, User, CoreNarrativeLog, CuriosityQuestion
from db.database import get_session, init_db
from memory.consolidation import run_consolidation_cycle

@pytest.fixture()
async def memory_user_and_db():
    await init_db()
    user_id = str(uuid.uuid4())
    async with get_session() as db:
        db.add(
            User(
                id=user_id,
                username=f"pytest_consolidation_{user_id[:8]}",
                role="ROOT",
                pin_hash="x",
                rfid_uid_hash=None,
                preferences_json="{}",
            )
        )
        await db.commit()

    async with get_session() as db:
        yield user_id, db

@pytest.mark.asyncio
async def test_consolidation_cycle_promotes_and_decays(memory_user_and_db, monkeypatch):
    user_id, db = memory_user_and_db
    now = datetime.now(tz=timezone.utc)

    # 1. Add tactical facts in SQLite
    # Fact 1: explicit, should be promoted
    fact1_id = str(uuid.uuid4())
    fact1 = MemoryFact(
        id=fact1_id,
        user_id=user_id,
        layer="tactical",
        category="explicit",
        content="I prefer tea over coffee.",
        importance=0.8,
        source_session_id="session_1",
        created_at=now,
    )
    # Fact 2: accessed_count > 0, should be promoted
    fact2_id = str(uuid.uuid4())
    fact2 = MemoryFact(
        id=fact2_id,
        user_id=user_id,
        layer="tactical",
        category="fact",
        content="I live in Lviv.",
        importance=0.2,
        access_count=1,
        source_session_id="session_1",
        created_at=now,
    )
    # Fact 3: expired and low importance, should be deleted
    fact3_id = str(uuid.uuid4())
    fact3 = MemoryFact(
        id=fact3_id,
        user_id=user_id,
        layer="tactical",
        category="fact",
        content="It was raining today.",
        importance=0.1,
        access_count=0,
        source_session_id="session_1",
        created_at=now - timedelta(days=2),
    )
    
    db.add(fact1)
    db.add(fact2)
    db.add(fact3)
    await db.commit()

    # Mock strategic_memory
    mock_store = AsyncMock()
    mock_supersede = AsyncMock()
    mock_seal = AsyncMock()
    mock_client = MagicMock()
    
    # Empty ChromaDB collection query for clustering test
    mock_coll = MagicMock()
    mock_coll.get.return_value = {"ids": [], "embeddings": [], "documents": [], "metadatas": []}
    mock_client.get_collection.return_value = mock_coll
    
    import memory.strategic_memory
    monkeypatch.setattr(memory.strategic_memory, "store_fact", mock_store)
    monkeypatch.setattr(memory.strategic_memory, "supersede_fact", mock_supersede)
    monkeypatch.setattr(memory.strategic_memory, "seal_fact", mock_seal)
    monkeypatch.setattr(memory.strategic_memory, "_get_client", lambda: mock_client)

    # Mock AI Router generate calls (for narrative rewrite and curiosity loops)
    from ai.tool_use import ToolCallResult
    class FakeLLMResult:
        def __init__(self, content):
            self.content = content
            self.response_form = "text"
            self.attachments = []
            self.provider = "mock"
            self.tokens_used = 10

    async def fake_generate(user_message, system_prompt, history=None):
        if "curiosity" in user_message or "JSON-список" in user_message:
            return FakeLLMResult('["What is your favorite food?"]')
        elif "core_narrative" in user_message or "core_narrative" in system_prompt:
            return FakeLLMResult('{"text": "We have a stable friendly relationship.", "diff_summary": "Updated summary"}')
        return FakeLLMResult('{}')

    import ai.provider
    monkeypatch.setattr(ai.provider.ai_router, "generate", fake_generate)

    # Run consolidation
    report = await run_consolidation_cycle(db, user_id)

    assert report["promoted"] == 2
    assert report["pruned_tactical"] == 1
    assert report["narrative_updated"] is True
    assert report["curiosity_questions"] == 1

    # Verify SQLite DB state
    # Fact 1 should be promoted to strategic
    res1 = await db.execute(select(MemoryFact).where(MemoryFact.id == fact1_id))
    f1 = res1.scalar_one_or_none()
    assert f1 is not None
    assert f1.layer == "strategic"

    # Fact 2 should be promoted to strategic
    res2 = await db.execute(select(MemoryFact).where(MemoryFact.id == fact2_id))
    f2 = res2.scalar_one_or_none()
    assert f2 is not None
    assert f2.layer == "strategic"

    # Fact 3 should be deleted
    res3 = await db.execute(select(MemoryFact).where(MemoryFact.id == fact3_id))
    f3 = res3.scalar_one_or_none()
    assert f3 is None

    # Verify narrative log was created
    res_nar = await db.execute(select(CoreNarrativeLog).where(CoreNarrativeLog.user_id == user_id))
    narratives = res_nar.scalars().all()
    assert len(narratives) == 1
    assert narratives[0].text == "We have a stable friendly relationship."

    # Verify curiosity question was queued
    res_q = await db.execute(select(CuriosityQuestion).where(CuriosityQuestion.user_id == user_id))
    questions = res_q.scalars().all()
    assert len(questions) == 1
    assert questions[0].question == "What is your favorite food?"
