import os
import tempfile
import importlib
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "t")
os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def db_factory():
    import db.database as dbm
    import db.models as dm  # noqa: F401
    if not dbm.Base.metadata.tables:
        importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
    factory = async_sessionmaker(eng, expire_on_commit=False)
    from db.models import User
    async with factory() as s:
        s.add(User(id="u1", username="u1"))
        await s.commit()
    yield factory
    await eng.dispose()
    os.unlink(tmp)


async def _observe_user(db_factory, text="Власник другий тиждень пише про офлайн-карти."):
    """Give the will something real about the user. Without this reflection
    refuses to propose, which is the point of
    test_orient_refuses_to_invent_goals_without_observation below."""
    from db.models import PhantomNarrative
    async with db_factory() as db:
        db.add(PhantomNarrative(user_id="u1", narrative_text=text, turn_count=5))
        await db.commit()


@pytest.mark.asyncio
async def test_orient_bootstrap_reflects_when_no_goals(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    await _observe_user(db_factory)

    async def fake_llm(prompt, system):
        return '[{"description":"Перша самопороджена ціль","horizon_level":1}]'
    eng = WillEngine()
    eng.dispatch_llm = fake_llm
    async with db_factory() as db:
        note = await eng.orient(db, "u1", [], now=datetime(2026, 6, 27, 12, 0))
        await db.commit()
    assert "reflected:1" in note
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
    assert any(g.source == "self_generated" for g in active)


@pytest.mark.asyncio
async def test_orient_decomposes_high_horizon_childless_goal(db_factory):
    from agent.will.engine import WillEngine
    from agent.will import goals

    async def fake_llm(prompt, system):
        return '["рік-крок 1", "рік-крок 2"]'
    eng = WillEngine()
    eng.dispatch_llm = fake_llm
    async with db_factory() as db:
        vid = await goals.seed(db, "u1", "VISION", 0)
        await db.commit()
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
        note = await eng.orient(db, "u1", active, now=datetime(2026, 6, 27, 12, 0))
        await db.commit()
    assert "decomposed:2" in note
    async with db_factory() as db:
        kids = await goals.children(db, "u1", vid)
    assert len(kids) == 2
    assert all(k.horizon_level == 1 for k in kids)


@pytest.mark.asyncio
async def test_orient_stops_decomposing_at_active_goal_ceiling(db_factory, monkeypatch):
    """Anti-sprawl: once the tree reaches will_max_active_goals, orient must NOT
    decompose further — budget flows to action instead of endless planning."""
    from agent.will.engine import WillEngine
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_max_active_goals", 3, raising=False)

    calls = {"n": 0}

    async def fake_llm(prompt, system):
        calls["n"] += 1
        return '["мав би розбити, але не повинен"]'
    eng = WillEngine()
    eng.dispatch_llm = fake_llm
    async with db_factory() as db:
        vid = await goals.seed(db, "u1", "VISION", 0)  # childless, decomposable
        await goals.seed(db, "u1", "leaf a", 6)
        await goals.seed(db, "u1", "leaf b", 6)        # 3 active total == ceiling
        await db.commit()
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
        note = await eng.orient(db, "u1", active, now=datetime(2026, 6, 27, 12, 0))
        await db.commit()
    assert "decomposed" not in note
    assert calls["n"] == 0  # no LLM spent on decomposition at the ceiling
    async with db_factory() as db:
        kids = await goals.children(db, "u1", vid)
    assert kids == []


@pytest.mark.asyncio
async def test_orient_scheduled_reflect_only_once_per_day(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_reflect_hour_local", 4, raising=False)

    calls = {"n": 0}
    await _observe_user(db_factory)

    async def fake_llm(prompt, system):
        calls["n"] += 1
        return "[]"  # no new goals, but counts as a reflect attempt
    eng = WillEngine()
    eng.dispatch_llm = fake_llm
    async with db_factory() as db:
        await goals.seed(db, "u1", "наявна ціль", 6)
        await db.commit()
    at4 = datetime(2026, 6, 27, 4, 30)
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
        await eng.orient(db, "u1", active, now=at4)
        await db.commit()
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
        await eng.orient(db, "u1", active, now=at4)  # same day → no second reflect
        await db.commit()
    # ACTION-level goal has no decompose; reflect should fire exactly once.
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_orient_refuses_to_invent_goals_without_observation(db_factory, monkeypatch):
    """The 20 self_generated goals found in the live DB on 12.09 described a
    company that does not exist, in broken Ukrainian. They came from asking a
    7B model to "propose 1-3 goals" with nothing in front of it but the values
    doctrine — a constant present on every run. No observation of the user must
    mean no proposal AND no LLM call."""
    from agent.will.engine import WillEngine
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)

    calls = {"n": 0}

    async def fake_llm(prompt, system):
        calls["n"] += 1
        return '[{"description":"вигадана ціль","horizon_level":1}]'
    eng = WillEngine()
    eng.dispatch_llm = fake_llm
    async with db_factory() as db:
        note = await eng.orient(db, "u1", [], now=datetime(2026, 6, 27, 12, 0))
        await db.commit()
    assert calls["n"] == 0, "asked the model to invent goals with nothing observed"
    assert "reflected" not in note
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
    assert active == []


@pytest.mark.asyncio
async def test_orient_does_not_reflect_past_the_active_goal_ceiling(db_factory, monkeypatch):
    """Decomposition has always respected will_max_active_goals; reflection did
    not, so a tree pinned at the ceiling still grew by up to 3 roots a day."""
    from agent.will.engine import WillEngine
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_max_active_goals", 2, raising=False)
    monkeypatch.setattr(config, "will_reflect_hour_local", 4, raising=False)
    await _observe_user(db_factory)

    calls = {"n": 0}

    async def fake_llm(prompt, system):
        calls["n"] += 1
        return '[{"description":"ще одна ціль","horizon_level":1}]'
    eng = WillEngine()
    eng.dispatch_llm = fake_llm
    async with db_factory() as db:
        await goals.seed(db, "u1", "ціль а", 6)
        await goals.seed(db, "u1", "ціль б", 6)  # 2 active == ceiling
        await db.commit()
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
        note = await eng.orient(db, "u1", active, now=datetime(2026, 6, 27, 4, 30))
        await db.commit()
    assert "reflect_skipped:at_ceiling" in note
    assert calls["n"] == 0
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
    assert len(active) == 2
