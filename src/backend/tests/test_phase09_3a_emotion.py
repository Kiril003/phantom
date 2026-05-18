"""
Phase 9.3a — emotion vector: schema, event deltas, decay loop, prompt wiring.
"""
from __future__ import annotations

import asyncio
import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase093a-emo")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p93a_emo_")
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


# ── schema ────────────────────────────────────────────────────────────────────


def test_emotion_default_values():
    from agent.schemas import EmotionVector
    e = EmotionVector()
    assert 0.0 <= e.focus <= 1.0
    assert 0.0 <= e.curiosity <= 1.0
    assert 0.0 <= e.concern <= 1.0
    assert 0.0 <= e.fatigue <= 1.0
    assert e.focus == 0.7
    assert e.curiosity == 0.5
    assert e.concern == 0.2
    assert e.fatigue == 0.0


def test_emotion_clamp_high():
    from agent.schemas import EmotionVector
    e = EmotionVector(focus=2.5, curiosity=-0.3, concern=1.1, fatigue=-5.0)
    c = e.clamp()
    assert c.focus == 1.0
    assert c.curiosity == 0.0
    assert c.concern == 1.0
    assert c.fatigue == 0.0


def test_emotion_summary_baseline():
    """All-baseline axes → 'спокійний'."""
    from agent.schemas import EmotionVector
    # Baseline is focus=0.5, curiosity=0.5, concern=0.1, fatigue=0.0.
    baseline = EmotionVector(focus=0.5, curiosity=0.5, concern=0.1, fatigue=0.0)
    assert baseline.summary() == "спокійний"


def test_emotion_summary_concerned_and_tired():
    from agent.schemas import EmotionVector
    e = EmotionVector(focus=0.3, curiosity=0.3, concern=0.8, fatigue=0.7)
    s = e.summary()
    assert "стурбован" in s
    assert "втомлен" in s


def test_emotion_summary_flow_state():
    from agent.schemas import EmotionVector
    assert EmotionVector(focus=0.9).summary() == "у потоці"


# ── event-driven updates ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_task_started_delta(isolated_db):
    from agent.cognition.emotion import update_emotion_on_event
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel

    rt = AgentRuntime()
    rt.foreground_slot = TaskState(
        id="t", goal="g", track="foreground", status="planning",
        self_model=SelfModel(),
    )
    before = rt.foreground_slot.self_model.emotion
    assert before.focus == 0.7

    await update_emotion_on_event(rt, "task.started", {})
    after = rt.foreground_slot.self_model.emotion
    assert after.focus > before.focus  # focus delta was +0.10
    assert after.focus <= 1.0  # clamped


@pytest.mark.asyncio
async def test_task_failed_raises_concern_and_fatigue(isolated_db):
    from agent.cognition.emotion import update_emotion_on_event
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel

    rt = AgentRuntime()
    rt.foreground_slot = TaskState(
        id="t", goal="g", track="foreground", status="running",
        self_model=SelfModel(),
    )
    before = rt.foreground_slot.self_model.emotion

    await update_emotion_on_event(rt, "task.failed", {})
    after = rt.foreground_slot.self_model.emotion
    assert after.concern > before.concern
    assert after.fatigue > before.fatigue
    assert after.focus < before.focus


@pytest.mark.asyncio
async def test_reflection_completed_verdict_branches(isolated_db):
    """reflection.completed uses verdict to pick a delta key."""
    from agent.cognition.emotion import resolve_event_key

    assert resolve_event_key("reflection.completed", {"verdict": "continue"}) == \
        "reflection.completed:continue"
    assert resolve_event_key("reflection.completed", {"verdict": "revise_subgoal"}) == \
        "reflection.completed:revise"
    assert resolve_event_key("reflection.completed", {"verdict": "revise_strategy"}) == \
        "reflection.completed:revise"
    assert resolve_event_key("reflection.completed", {"verdict": "abandon_task"}) == \
        "reflection.completed:abandon"
    # Unknown verdict → no key.
    assert resolve_event_key("reflection.completed", {"verdict": "weird"}) is None


@pytest.mark.asyncio
async def test_blocked_quota_entered_from_alias(isolated_db):
    """Runtime emits `task.blocked_quota`; emotion maps it to blocked_quota.entered."""
    from agent.cognition.emotion import update_emotion_on_event
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel

    rt = AgentRuntime()
    rt.foreground_slot = TaskState(
        id="t", goal="g", track="foreground", status="blocked_quota",
        self_model=SelfModel(),
    )
    before = rt.foreground_slot.self_model.emotion
    await update_emotion_on_event(rt, "task.blocked_quota", {"reason": "test"})
    after = rt.foreground_slot.self_model.emotion
    assert after.concern > before.concern


@pytest.mark.asyncio
async def test_no_foreground_task_is_silent(isolated_db):
    """Emotion updates no-op when there's no active task."""
    from agent.cognition.emotion import update_emotion_on_event
    from agent.kernel.runtime import AgentRuntime

    rt = AgentRuntime()
    assert rt.foreground_slot is None
    # Must not raise.
    await update_emotion_on_event(rt, "task.started", {})
    assert rt.foreground_slot is None


# ── decay loop ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_decay_drifts_toward_baseline(isolated_db, monkeypatch):
    from agent.cognition.emotion import decay_loop
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import EmotionVector, SelfModel
    from config import config

    rt = AgentRuntime()
    state = TaskState(
        id="t", goal="g", track="foreground", status="running",
        self_model=SelfModel(emotion=EmotionVector(
            focus=0.2, curiosity=0.9, concern=0.8, fatigue=0.9,
        )),
    )
    rt.foreground_slot = state

    monkeypatch.setattr(config, "agent_emotion_decay_interval_s", 1, raising=False)
    monkeypatch.setattr(config, "agent_emotion_decay_rate", 0.5, raising=False)

    before = state.self_model.emotion

    stop = asyncio.Event()
    # Run one tick then stop.
    async def _fire_stop():
        await asyncio.sleep(0.05)  # let the loop arm its wait_for
        # Instead of letting the interval elapse, patch config mid-flight…
        # Simpler: let the natural cadence play out by waiting >=1s.
        await asyncio.sleep(1.2)
        stop.set()
    fire = asyncio.create_task(_fire_stop())
    await decay_loop(rt, stop)
    await fire

    after = state.self_model.emotion
    # Each axis should have moved ~50% toward its baseline.
    # focus was 0.2, baseline 0.5 → should move up.
    assert after.focus > before.focus
    # curiosity was 0.9, baseline 0.5 → should move down.
    assert after.curiosity < before.curiosity
    # concern was 0.8, baseline 0.1 → should move down.
    assert after.concern < before.concern
    # fatigue was 0.9, baseline 0.0 → should move down.
    assert after.fatigue < before.fatigue


# ── prompt integration ──────────────────────────────────────────────────────


def test_tactical_prompt_omits_emotion_at_baseline():
    from agent.cognition.planner.tactical import _build_user_message
    from agent.schemas import SelfModel, SubGoal
    sm = SelfModel()
    sg = SubGoal(description="x", rationale="y", expected_actions=1,
                 acceptance_criteria="")
    msg = _build_user_message(self_model=sm, sub_goal=sg, observations=[],
                               actions_in_sub_goal=0)
    assert "ПОТОЧНИЙ СТАН PHANTOM" not in msg


def test_tactical_prompt_includes_emotion_when_elevated():
    from agent.cognition.planner.tactical import _build_user_message
    from agent.schemas import EmotionVector, SelfModel, SubGoal
    sm = SelfModel(emotion=EmotionVector(concern=0.8, fatigue=0.7))
    sg = SubGoal(description="x", rationale="y", expected_actions=1,
                 acceptance_criteria="")
    msg = _build_user_message(self_model=sm, sub_goal=sg, observations=[],
                               actions_in_sub_goal=0)
    assert "ПОТОЧНИЙ СТАН PHANTOM" in msg
    assert "concern" in msg


# ── checkpoint roundtrip ────────────────────────────────────────────────────


def test_emotion_persists_across_checkpoint_roundtrip():
    """Emotion survives serialise+reload via model_dump / SelfModel()."""
    from agent.schemas import EmotionVector, SelfModel
    sm = SelfModel(emotion=EmotionVector(focus=0.9, concern=0.4))
    data = sm.model_dump(mode="json")
    restored = SelfModel(**data)
    assert restored.emotion.focus == pytest.approx(0.9)
    assert restored.emotion.concern == pytest.approx(0.4)


# ── concurrent safety (quick smoke) ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_concurrent_updates_stay_clamped(isolated_db):
    """Fire 30 events in parallel; emotion stays bounded in [0, 1]."""
    from agent.cognition.emotion import update_emotion_on_event
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import SelfModel

    rt = AgentRuntime()
    rt.foreground_slot = TaskState(
        id="t", goal="g", track="foreground", status="running",
        self_model=SelfModel(),
    )

    async def _fire():
        for _ in range(30):
            await update_emotion_on_event(rt, "action.completed", {})
            await update_emotion_on_event(rt, "task.failed", {})

    await asyncio.gather(*[_fire() for _ in range(3)])

    e = rt.foreground_slot.self_model.emotion
    for v in (e.focus, e.curiosity, e.concern, e.fatigue):
        assert 0.0 <= v <= 1.0
