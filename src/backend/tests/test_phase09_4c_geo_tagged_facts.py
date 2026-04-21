"""
Phase 9.4c audit G6 — /map/geo_tagged_facts endpoint + list_geo_tagged_memories.

The backend now exposes every MemoryFact with coordinates so the frontend
FactMarkerLayer can render them. Scoping is per-user; sealed facts are
excluded by default. The DB already has the composite index
(ix_memory_facts_user_geo from audit B2) so this query is index-backed.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from db.database import get_session
from db.models import MemoryFact, User
from main import create_app
from memory.geo_query import list_geo_tagged_memories
from security.jwt_manager import create_token


async def _seed_user_and_facts(
    *, with_geo: int, without_geo: int, user_id: str | None = None
) -> str:
    uid = user_id or str(uuid.uuid4())
    async with get_session() as db:
        existing = await db.get(User, uid)
        if existing is None:
            db.add(User(id=uid, username=f"t_{uid[:8]}", role="OPERATOR"))
        for i in range(with_geo):
            db.add(
                MemoryFact(
                    id=str(uuid.uuid4()),
                    user_id=uid,
                    layer="tactical",
                    category="location_reference",
                    content=f"Fact {i}",
                    importance=0.5,
                    source_session_id=str(uuid.uuid4()),
                    place_name=f"Place {i}",
                    place_lat=50.0 + i * 0.001,
                    place_lon=30.0 + i * 0.001,
                    place_source="test",
                    place_confidence=0.8,
                    created_at=datetime.now(tz=timezone.utc),
                )
            )
        for i in range(without_geo):
            db.add(
                MemoryFact(
                    id=str(uuid.uuid4()),
                    user_id=uid,
                    layer="tactical",
                    category="preference",
                    content=f"No-geo fact {i}",
                    importance=0.5,
                    source_session_id=str(uuid.uuid4()),
                )
            )
        await db.commit()
    return uid


@pytest.mark.asyncio
async def test_list_geo_tagged_memories_returns_only_geo_rows() -> None:
    uid = await _seed_user_and_facts(with_geo=3, without_geo=2)
    async with get_session() as db:
        rows = await list_geo_tagged_memories(db, user_id=uid)
    assert len(rows) == 3
    for row in rows:
        assert row["place_lat"] is not None
        assert row["place_lon"] is not None


@pytest.mark.asyncio
async def test_list_geo_tagged_memories_respects_limit() -> None:
    uid = await _seed_user_and_facts(with_geo=10, without_geo=0)
    async with get_session() as db:
        rows = await list_geo_tagged_memories(db, user_id=uid, limit=4)
    assert len(rows) == 4


@pytest.mark.asyncio
async def test_list_geo_tagged_memories_excludes_sealed_by_default() -> None:
    uid = await _seed_user_and_facts(with_geo=2, without_geo=0)
    async with get_session() as db:
        from sqlalchemy import select
        result = await db.execute(
            select(MemoryFact).where(MemoryFact.user_id == uid).limit(1)
        )
        fact = result.scalars().first()
        assert fact is not None
        fact.is_sealed = True
        await db.commit()

        rows = await list_geo_tagged_memories(db, user_id=uid)
        assert len(rows) == 1
        rows_sealed = await list_geo_tagged_memories(db, user_id=uid, include_sealed=True)
        assert len(rows_sealed) == 2


@pytest.fixture(scope="module")
def client():
    app = create_app()
    return TestClient(app)


@pytest.mark.asyncio
async def test_endpoint_returns_facts_for_authed_user(client: TestClient) -> None:
    uid = await _seed_user_and_facts(with_geo=2, without_geo=1)
    token, _ = create_token(user_id=uid, username=f"t_{uid[:8]}", role="OPERATOR")
    resp = client.get(
        "/api/v1/map/geo_tagged_facts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "facts" in body and "total" in body
    assert body["total"] == 2
    assert all(f["place_lat"] is not None for f in body["facts"])


def test_endpoint_requires_auth(client: TestClient) -> None:
    resp = client.get("/api/v1/map/geo_tagged_facts")
    assert resp.status_code in (401, 403)
