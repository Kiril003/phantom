from __future__ import annotations

import uuid
import pytest
from sqlalchemy import select
from db.models import MemoryFact, User
from db.database import get_session, init_db
from memory.resolver import resolve_conflicts

@pytest.fixture()
async def memory_user_and_db():
    await init_db()
    user_id = str(uuid.uuid4())
    async with get_session() as db:
        db.add(
            User(
                id=user_id,
                username=f"pytest_cognitive_{user_id[:8]}",
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
async def test_resolver_regex_slot_extraction(memory_user_and_db):
    user_id, db = memory_user_and_db

    # Store first fact with a slot (employer)
    fact1_id = str(uuid.uuid4())
    fact1 = MemoryFact(
        id=fact1_id,
        user_id=user_id,
        content="Я працюю в компанії Google.",
        layer="strategic",
        category="profile",
        importance=0.8,
        entity_slot="employer",
        source_session_id="test",
    )
    db.add(fact1)
    await db.commit()

    # Now write a conflicting fact for the same slot (OpenAI)
    fact2_id = str(uuid.uuid4())
    slot = await resolve_conflicts(
        db=db,
        user_id=user_id,
        new_fact_content="Я змінив роботу і тепер працюю в OpenAI.",
        new_fact_id=fact2_id,
    )

    assert slot == "employer"

    # Reload fact1 and verify it is superseded
    res1 = await db.execute(select(MemoryFact).where(MemoryFact.id == fact1_id))
    f1 = res1.scalar_one()
    assert f1.valid_until is not None
    assert f1.superseded_by == fact2_id

@pytest.mark.asyncio
async def test_resolver_semantic_override_fallback(memory_user_and_db, monkeypatch):
    user_id, db = memory_user_and_db

    # Store first fact
    fact1_id = str(uuid.uuid4())
    fact1 = MemoryFact(
        id=fact1_id,
        user_id=user_id,
        content="Мій улюблений напій — капучіно без цукру.",
        layer="strategic",
        category="preference",
        importance=0.7,
        entity_slot=None,
        source_session_id="test",
    )
    db.add(fact1)
    await db.commit()

    # Mock strategic_memory's query_with_distances to simulate high similarity (> 0.90)
    async def mock_query_with_distances(uid, query, k):
        return [
            {
                "id": fact1_id,
                "content": "Мій улюблений напій — капучіно без цукру.",
                "metadata": {"user_id": uid},
                "distance": 0.05, # Cosine similarity = 1 - 0.05 = 0.95 (> 0.90 threshold)
            }
        ]

    import memory.strategic_memory
    monkeypatch.setattr(memory.strategic_memory, "query_with_distances", mock_query_with_distances)
    
    # Mock supersede_fact in strategic_memory
    async def mock_supersede_fact(uid, old_id, new_id):
        pass
    monkeypatch.setattr(memory.strategic_memory, "supersede_fact", mock_supersede_fact)

    fact2_id = str(uuid.uuid4())
    slot = await resolve_conflicts(
        db=db,
        user_id=user_id,
        new_fact_content="Мій улюблений напій — капучіно з корицею.",
        new_fact_id=fact2_id,
    )

    # Reload fact1 and verify it is superseded
    res1 = await db.execute(select(MemoryFact).where(MemoryFact.id == fact1_id))
    f1 = res1.scalar_one()
    assert f1.valid_until is not None
    assert f1.superseded_by == fact2_id
