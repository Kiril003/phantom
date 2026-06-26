"""
Phase 9.3b — standing orders tests.

Schedule specs, evaluator, runner tick, condition DSL, non-preemption,
atomic fire-stats update, API CRUD.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase093b-so")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p93b_so_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)
    yield factory
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


# ── Schedule parsing + next_fire_time ────────────────────────────────────────


def test_interval_schedule_round_trip():
    from agent.operations.standing_orders.schedules import IntervalSchedule, parse_schedule
    s = IntervalSchedule(every_s=60)
    back = parse_schedule(s.model_dump_json())
    assert isinstance(back, IntervalSchedule)
    assert back.every_s == 60


def test_interval_next_fire_with_last_fired():
    from agent.operations.standing_orders.schedules import IntervalSchedule, next_fire_time
    s = IntervalSchedule(every_s=30)
    now = datetime(2026, 4, 20, 12, 0, 0, tzinfo=timezone.utc)
    last = now - timedelta(seconds=15)
    nxt = next_fire_time(s, now, last)
    assert nxt is not None
    assert nxt == last + timedelta(seconds=30)


def test_interval_first_fire_is_immediate():
    from agent.operations.standing_orders.schedules import IntervalSchedule, next_fire_time
    s = IntervalSchedule(every_s=30)
    now = datetime.now(tz=timezone.utc)
    nxt = next_fire_time(s, now, last_fired_at=None)
    assert nxt == now


def test_cron_schedule_next_fire_within_hour():
    from agent.operations.standing_orders.schedules import CronSchedule, next_fire_time
    s = CronSchedule(minute="*/15")
    now = datetime(2026, 4, 20, 12, 7, 0, tzinfo=timezone.utc)
    nxt = next_fire_time(s, now, last_fired_at=None)
    assert nxt is not None
    assert nxt > now
    assert nxt <= now + timedelta(minutes=15)


def test_conditional_cooldown_enforced():
    from agent.operations.standing_orders.schedules import ConditionalSchedule, next_fire_time
    s = ConditionalSchedule(check_every_s=60, condition="cpu_percent > 50", cooldown_s=600)
    now = datetime(2026, 4, 20, 12, 0, 0, tzinfo=timezone.utc)
    last = now - timedelta(seconds=100)  # within cooldown
    nxt = next_fire_time(s, now, last)
    assert nxt is not None
    assert nxt >= now  # either now (eligible) or future cooldown end
    # Inside cooldown → next should be cooldown end.
    assert nxt == last + timedelta(seconds=600)


def test_one_shot_fires_once():
    from agent.operations.standing_orders.schedules import OneShotSchedule, next_fire_time
    fire_at = datetime(2026, 4, 20, 14, 0, 0, tzinfo=timezone.utc)
    s = OneShotSchedule(at=fire_at)
    now = datetime(2026, 4, 20, 13, 59, 0, tzinfo=timezone.utc)
    assert next_fire_time(s, now, None) == fire_at
    # After firing, returns None.
    assert next_fire_time(s, now + timedelta(hours=2), last_fired_at=fire_at) is None


# ── Condition DSL ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_condition_hour_equals():
    from agent.operations.standing_orders.conditions import evaluate_condition
    now_hour = datetime.now(tz=timezone.utc).hour
    assert await evaluate_condition(f"hour == {now_hour}") is True
    assert await evaluate_condition(f"hour == {(now_hour + 1) % 24}") is False


@pytest.mark.asyncio
async def test_condition_unknown_metric_raises():
    from agent.operations.standing_orders.conditions import evaluate_condition
    with pytest.raises(ValueError):
        await evaluate_condition("nonsense_metric > 0")


@pytest.mark.asyncio
async def test_condition_malformed_raises():
    from agent.operations.standing_orders.conditions import evaluate_condition
    with pytest.raises(ValueError):
        await evaluate_condition("this is not a condition")


@pytest.mark.asyncio
async def test_condition_broken_metric_returns_false(monkeypatch):
    """If the underlying metric call raises, condition evaluates False —
    fail-safe so a broken probe doesn't cause spurious firing."""
    from agent.operations.standing_orders import conditions

    def _boom():
        raise RuntimeError("psutil crashed")

    monkeypatch.setitem(conditions.KNOWN_CONDITIONS, "cpu_percent", _boom)
    assert await conditions.evaluate_condition("cpu_percent > 0") is False


@pytest.mark.asyncio
async def test_condition_fatigue_reads_foreground_emotion():
    """fatigue metric reads from the runtime's foreground task."""
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import EmotionVector, SelfModel
    from agent.operations.standing_orders.conditions import evaluate_condition
    import agent.operations.standing_orders.conditions as cond_mod

    # Patch the agent_runtime import target to a fresh runtime.
    import agent.kernel.runtime as runtime_mod
    sm = SelfModel(emotion=EmotionVector(fatigue=0.9))
    runtime_mod.agent_runtime.foreground_slot = TaskState(
        id="x", user_id="u-test", goal="g", track="foreground", status="running", self_model=sm,
    )
    try:
        assert await evaluate_condition("fatigue > 0.5") is True
        assert await evaluate_condition("fatigue > 0.95") is False
    finally:
        runtime_mod.agent_runtime.foreground_slot = None


# ── Runner tick ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_runner_fires_due_interval_order(isolated_db, monkeypatch):
    from agent.kernel.runtime import AgentRuntime
    from agent.operations.standing_orders.runner import StandingOrderRunner
    from db.database import get_session
    from db.models import StandingOrder, User

    # Seed user + interval order that's overdue.
    user_id = "u1"
    async with get_session() as db:
        db.add(User(id=user_id, username="u1", role="ROOT"))
        db.add(StandingOrder(
            user_id=user_id,
            description="ping",
            kind="interval",
            schedule_json=json.dumps({"kind": "interval", "every_s": 60}),
            action_json=json.dumps({"goal": "sanity ping"}),
            enabled=True,
            last_fired_at=datetime.now(tz=timezone.utc) - timedelta(seconds=120),
        ))
        await db.commit()

    # Stub out start_task so we don't actually spawn a real agent task.
    runtime = AgentRuntime()
    called: list[str] = []

    async def _fake_start(goal: str, **kwargs):
        called.append(goal)
        return ("tid-123", True)

    monkeypatch.setattr(runtime, "start_task", _fake_start)
    runner = StandingOrderRunner(runtime)
    fired = await runner.check_and_fire_due_orders()
    assert len(fired) == 1
    assert called == ["sanity ping"]

    # fire_count + last_fired_at updated.
    async with get_session() as db:
        row = (await db.execute(select(StandingOrder))).scalars().first()
    assert row.fire_count == 1
    assert row.last_fired_at is not None
    assert row.last_outcome is not None and "tid-123" in row.last_outcome


@pytest.mark.asyncio
async def test_runner_fires_on_background_even_when_foreground_busy(isolated_db, monkeypatch):
    """Phase 9.4a — background track is independent, so a busy foreground
    user conversation must NOT block a due standing order."""
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel
    from agent.operations.standing_orders.runner import StandingOrderRunner
    from db.database import get_session
    from db.models import StandingOrder, User

    user_id = "u1"
    async with get_session() as db:
        db.add(User(id=user_id, username="u1", role="ROOT"))
        db.add(StandingOrder(
            user_id=user_id,
            description="overdue",
            kind="interval",
            schedule_json=json.dumps({"kind": "interval", "every_s": 10}),
            action_json=json.dumps({"goal": "x"}),
            enabled=True,
            last_fired_at=datetime.now(tz=timezone.utc) - timedelta(minutes=5),
        ))
        await db.commit()

    runtime = AgentRuntime()
    # Simulate active user task in foreground slot.
    runtime.foreground_slot = TaskState(
        id="active", user_id=user_id, goal="user-task", track="foreground",
        status="running", self_model=SelfModel(),
    )
    started: list[tuple[str, dict]] = []

    async def _fake_start(goal, **kwargs):
        started.append((goal, kwargs))
        return ("bg-tid", True)

    monkeypatch.setattr(runtime, "start_task", _fake_start)
    runner = StandingOrderRunner(runtime)
    fired = await runner.check_and_fire_due_orders()
    assert fired != []          # order fired
    assert len(started) == 1
    assert started[0][0] == "x"
    assert started[0][1].get("track") == "background"
    assert started[0][1].get("origin") == "standing_order"


@pytest.mark.asyncio
async def test_runner_respects_disabled_order(isolated_db, monkeypatch):
    from agent.kernel.runtime import AgentRuntime
    from agent.operations.standing_orders.runner import StandingOrderRunner
    from db.database import get_session
    from db.models import StandingOrder, User

    async with get_session() as db:
        db.add(User(id="u", username="u", role="ROOT"))
        db.add(StandingOrder(
            user_id="u",
            description="disabled",
            kind="interval",
            schedule_json=json.dumps({"kind": "interval", "every_s": 5}),
            action_json=json.dumps({"goal": "x"}),
            enabled=False,
        ))
        await db.commit()

    runtime = AgentRuntime()
    async def _fake_start(_g, **kwargs):
        return ("t", True)
    monkeypatch.setattr(runtime, "start_task", _fake_start)
    runner = StandingOrderRunner(runtime)
    fired = await runner.check_and_fire_due_orders()
    assert fired == []


@pytest.mark.asyncio
async def test_runner_evaluates_conditional_schedule(isolated_db, monkeypatch):
    """Conditional order fires only when condition is True."""
    from agent.kernel.runtime import AgentRuntime
    from agent.operations.standing_orders import conditions as cond_mod
    from agent.operations.standing_orders.runner import StandingOrderRunner
    from db.database import get_session
    from db.models import StandingOrder, User

    async with get_session() as db:
        db.add(User(id="u", username="u", role="ROOT"))
        db.add(StandingOrder(
            user_id="u",
            description="cpu guard",
            kind="conditional",
            schedule_json=json.dumps({
                "kind": "conditional",
                "check_every_s": 60,
                "condition": "cpu_percent > 90",
                "cooldown_s": 600,
            }),
            action_json=json.dumps({"goal": "check"}),
            enabled=True,
        ))
        await db.commit()

    runtime = AgentRuntime()

    # First pass: condition False (mocked to 10) → no fire.
    monkeypatch.setitem(cond_mod.KNOWN_CONDITIONS, "cpu_percent", lambda: 10.0)
    async def _fake_start(_g, **kwargs):
        return ("t", True)
    monkeypatch.setattr(runtime, "start_task", _fake_start)
    runner = StandingOrderRunner(runtime)
    assert await runner.check_and_fire_due_orders() == []

    # Second pass: condition True (95 > 90) → fire.
    monkeypatch.setitem(cond_mod.KNOWN_CONDITIONS, "cpu_percent", lambda: 95.0)
    fired = await runner.check_and_fire_due_orders()
    assert len(fired) == 1


@pytest.mark.asyncio
async def test_runner_start_stop_cleanly():
    from agent.kernel.runtime import AgentRuntime
    from agent.operations.standing_orders.runner import StandingOrderRunner
    from config import config

    runtime = AgentRuntime()
    config.agent_standing_orders_poll_s = 1
    runner = StandingOrderRunner(runtime)
    try:
        await runner.start()
        await asyncio.sleep(0.1)
        t_start = asyncio.get_event_loop().time()
        await runner.stop()
        elapsed = asyncio.get_event_loop().time() - t_start
        assert elapsed < 2.0
    finally:
        config.agent_standing_orders_poll_s = 10


# ── API validation (parse) ───────────────────────────────────────────────────


def test_api_parse_rejects_invalid_schedule():
    """The API validator rejects schedules that can't be parsed."""
    from agent.operations.standing_orders.schedules import parse_schedule

    with pytest.raises(Exception):
        parse_schedule({"kind": "interval", "every_s": -5})

    with pytest.raises(Exception):
        parse_schedule({"kind": "interval", "every_s": 100000})  # > 86400 max
