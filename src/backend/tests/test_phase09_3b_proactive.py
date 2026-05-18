"""
Phase 9.3b — proactive loop tests.

Cover: lifecycle, interval adaptation, hard guards, trigger dedup,
emit-speech DB write, config hot-reload effect, shutdown timing, decide
prompt assembly, streak/fatigue dedup.
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

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase093b-pro")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p93b_pro_")
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


def _build_runtime_with_fg_task(concern: float = 0.1, fatigue: float = 0.0, focus: float = 0.5):
    from agent.kernel.runtime import AgentRuntime, TaskState
    from agent.schemas import EmotionVector, SelfModel

    runtime = AgentRuntime()
    sm = SelfModel(
        emotion=EmotionVector(focus=focus, curiosity=0.5, concern=concern, fatigue=fatigue),
    )
    runtime.foreground_slot = TaskState(
        id="t1",
        user_id="u-proactive-test",
        goal="g",
        track="foreground",
        status="running",
        self_model=sm,
    )
    return runtime


def _build_bare_runtime():
    from agent.kernel.runtime import AgentRuntime
    return AgentRuntime()


# ── Lifecycle ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_loop_start_stop_cleanly():
    from agent.cognition.proactive.loop import ProactiveLoop
    from config import config

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    # Proactive enabled by default as of 9.4c (audit G2); kept explicit for
    # clarity on what this test requires.
    config.agent_proactive_enabled = True
    config.agent_proactive_interval_min_s = 1
    config.agent_proactive_interval_s = 1
    try:
        await loop.start()
        assert loop._task is not None and not loop._task.done()
        # Second start is idempotent.
        await loop.start()
        await loop.stop()
        assert loop._task is None
    finally:
        config.agent_proactive_enabled = True


@pytest.mark.asyncio
async def test_shutdown_during_sleep_exits_quickly():
    """Start loop with long interval, stop; should exit within ~1s even
    though interval is 60s (wait_for on stop_event allows immediate wake)."""
    from agent.cognition.proactive.loop import ProactiveLoop
    from config import config

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    config.agent_proactive_enabled = True
    config.agent_proactive_interval_min_s = 60
    config.agent_proactive_interval_s = 60
    config.agent_proactive_interval_max_s = 300
    try:
        await loop.start()
        await asyncio.sleep(0.05)
        t_start = asyncio.get_event_loop().time()
        await loop.stop()
        elapsed = asyncio.get_event_loop().time() - t_start
        assert elapsed < 2.0, f"shutdown took {elapsed:.2f}s (expected <2s)"
    finally:
        config.agent_proactive_enabled = True
        config.agent_proactive_interval_min_s = 30
        config.agent_proactive_interval_s = 60


# ── Interval adaptation ──────────────────────────────────────────────────────


def test_compute_interval_shortens_on_high_concern():
    from agent.cognition.proactive.loop import ProactiveLoop
    from config import config

    r = _build_runtime_with_fg_task(concern=0.7)
    loop = ProactiveLoop(r)
    config.agent_proactive_interval_s = 60
    config.agent_proactive_interval_min_s = 15
    config.agent_proactive_interval_max_s = 300
    interval = loop._compute_interval()
    assert interval < 60, f"high concern should shorten interval, got {interval}"


def test_compute_interval_extends_on_calm_baseline():
    from agent.cognition.proactive.loop import ProactiveLoop
    from config import config

    r = _build_runtime_with_fg_task(concern=0.05, fatigue=0.05, focus=0.5)
    loop = ProactiveLoop(r)
    config.agent_proactive_interval_s = 60
    config.agent_proactive_interval_min_s = 15
    config.agent_proactive_interval_max_s = 300
    interval = loop._compute_interval()
    assert interval >= 60, f"calm baseline should extend interval, got {interval}"


def test_compute_interval_respects_min_max_bounds():
    from agent.cognition.proactive.loop import ProactiveLoop
    from config import config

    r = _build_runtime_with_fg_task(concern=0.95)
    loop = ProactiveLoop(r)
    config.agent_proactive_interval_s = 30
    config.agent_proactive_interval_min_s = 30
    config.agent_proactive_interval_max_s = 60
    interval = loop._compute_interval()
    assert 30 <= interval <= 60


# ── Hard guards ──────────────────────────────────────────────────────────────


def test_guard_cooldown_blocks_within_window():
    from agent.cognition.proactive.loop import ProactiveLoop
    from config import config

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    config.agent_proactive_cooldown_s = 300
    loop._last_speech_at = datetime.now(tz=timezone.utc)
    ctx = {"emotion": None, "minutes_since_user": 1}
    assert loop._should_consider_speaking(ctx) is False


@pytest.mark.asyncio
async def test_guard_active_task_blocks():
    from agent.cognition.proactive.loop import ProactiveLoop

    r = _build_runtime_with_fg_task()  # has foreground task
    loop = ProactiveLoop(r)
    loop.note_user_interaction()
    ctx = await loop._build_context()
    assert loop._should_consider_speaking(ctx) is False


@pytest.mark.asyncio
async def test_guard_no_recent_chat_blocks():
    from agent.cognition.proactive.loop import ProactiveLoop
    from config import config

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    config.agent_proactive_require_recent_chat = True
    config.agent_proactive_long_silence_threshold_min = 60
    # minutes_since_user > threshold → "no recent chat"
    loop._last_user_interaction_at = datetime.now(tz=timezone.utc) - timedelta(hours=4)
    ctx = await loop._build_context()
    assert loop._should_consider_speaking(ctx) is False


@pytest.mark.asyncio
async def test_guard_pass_on_emotion_and_recent_chat():
    from agent.cognition.proactive.loop import ProactiveLoop
    from agent.cognition.proactive.triggers import ProactiveTrigger, ProactiveTriggerKind
    from config import config

    r = _build_runtime_with_fg_task(concern=0.6)  # off-baseline
    # But no foreground task for speak test — clear it
    r.foreground_slot = None
    loop = ProactiveLoop(r)
    config.agent_proactive_cooldown_s = 300
    config.agent_proactive_require_recent_chat = True
    loop.note_user_interaction()
    # Trigger present → pass gate even without off-baseline emotion.
    loop.push_trigger(ProactiveTrigger(
        kind=ProactiveTriggerKind.CONCERN_ADDED,
        context={},
        priority=6,
    ))
    ctx = await loop._build_context()
    # emotion is None (no foreground), but triggers are present — pass.
    assert loop._should_consider_speaking(ctx) is True


# ── Triggers ─────────────────────────────────────────────────────────────────


def test_trigger_accumulation_capped():
    from agent.cognition.proactive.loop import ProactiveLoop
    from agent.cognition.proactive.triggers import ProactiveTrigger, ProactiveTriggerKind

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    for i in range(30):
        loop.push_trigger(ProactiveTrigger(
            kind=ProactiveTriggerKind.CONCERN_ADDED,
            context={"i": i},
            priority=5,
        ))
    # deque maxlen=20 → only the last 20 survive.
    assert len(loop._recent_triggers) == 20


def test_fatigue_spike_dedup_within_10_min():
    from agent.cognition.proactive.loop import ProactiveLoop

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    assert loop.record_fatigue_spike(0.85) is True
    assert loop.record_fatigue_spike(0.90) is False  # dedup within 10 min
    # Simulate time passage.
    loop._last_fatigue_trigger_at = datetime.now(tz=timezone.utc) - timedelta(minutes=11)
    assert loop.record_fatigue_spike(0.9) is True


def test_fatigue_spike_ignores_below_threshold():
    from agent.cognition.proactive.loop import ProactiveLoop

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    assert loop.record_fatigue_spike(0.7) is False
    assert loop.record_fatigue_spike(0.8) is False
    assert loop.record_fatigue_spike(0.81) is True


def test_streak_success_fires_after_three_dedup_after():
    from agent.cognition.proactive.loop import ProactiveLoop

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    # First two don't fire.
    assert loop.record_success_for_streak() is False
    assert loop.record_success_for_streak() is False
    # Third does.
    assert loop.record_success_for_streak() is True
    # Fourth immediately after: dedup'd (within 10 min).
    assert loop.record_success_for_streak() is False


def test_reset_streak_breaks_progress():
    from agent.cognition.proactive.loop import ProactiveLoop

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    loop.record_success_for_streak()
    loop.record_success_for_streak()
    loop.reset_streak()
    # Streak reset → need another 3.
    assert loop.record_success_for_streak() is False
    assert loop.record_success_for_streak() is False
    assert loop.record_success_for_streak() is True


# ── Decide context assembly ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_build_context_pulls_top_3_concerns():
    from agent.cognition.proactive.loop import ProactiveLoop
    from agent.cognition.self_model import add_concern

    r = _build_runtime_with_fg_task()
    sm = r.foreground_slot.self_model
    for i in range(5):
        add_concern(sm, f"concern-{i}")
    loop = ProactiveLoop(r)
    ctx = await loop._build_context()
    assert len(ctx["active_concerns"]) == 3
    # FIFO tail — newest first.
    assert "concern-4" in ctx["active_concerns"]


@pytest.mark.asyncio
async def test_build_context_emits_recent_triggers():
    from agent.cognition.proactive.loop import ProactiveLoop
    from agent.cognition.proactive.triggers import ProactiveTrigger, ProactiveTriggerKind

    r = _build_runtime_with_fg_task()
    loop = ProactiveLoop(r)
    for i in range(7):
        loop.push_trigger(ProactiveTrigger(
            kind=ProactiveTriggerKind.STREAK_SUCCESS,
            context={"i": i},
            priority=4,
        ))
    ctx = await loop._build_context()
    assert len(ctx["triggers"]) == 5  # last 5 surfaced to prompt


def test_decide_prompt_encodes_ask_for_risk_policy():
    from agent.cognition.proactive import loop as proactive_loop

    assert "Sentient Familiar" in proactive_loop._DECIDE_SYSTEM
    assert "medium/high risk" in proactive_loop._DECIDE_TEMPLATE
    assert "confirm_with_user=true" in proactive_loop._DECIDE_TEMPLATE
    assert "read-only" in proactive_loop._DECIDE_TEMPLATE
    assert "confirm_with_user=false" in proactive_loop._DECIDE_TEMPLATE


# ── Emit speech (DB write) ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_emit_speech_writes_to_chat_messages(isolated_db):
    """When there's a chat session, _emit_speech appends a new assistant
    message row with origin=proactive."""
    from agent.cognition.proactive.loop import ProactiveLoop
    from db.database import get_session
    from db.models import ChatMessage, ChatSession, User

    # Seed a user + session.
    user_id = "u-test"
    sess_id = "s-test"
    async with get_session() as db:
        db.add(User(id=user_id, username="testy", role="ROOT"))
        db.add(ChatSession(id=sess_id, user_id=user_id))
        await db.commit()

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    ctx = {"emotion": None}
    await loop._emit_speech(
        message="Привіт — це ініціативне повідомлення",
        reason="test",
        priority=5,
        ctx=ctx,
    )
    async with get_session() as db:
        rows = await db.execute(
            select(ChatMessage).where(ChatMessage.session_id == sess_id)
        )
        msgs = list(rows.scalars())
    assert len(msgs) == 1
    assert msgs[0].role == "assistant"
    md = json.loads(msgs[0].metadata_json)
    assert md["origin"] == "proactive"
    assert md["priority"] == 5


@pytest.mark.asyncio
async def test_emit_speech_noop_without_session(isolated_db):
    """No chat session exists → _emit_speech silently skips."""
    from agent.cognition.proactive.loop import ProactiveLoop
    from db.database import get_session
    from db.models import ChatMessage

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    await loop._emit_speech("hi", "", 5, {"emotion": None})
    async with get_session() as db:
        rows = await db.execute(select(ChatMessage))
        msgs = list(rows.scalars())
    assert msgs == []


# ── Config hot-reload landing ────────────────────────────────────────────────


def test_config_hot_reload_affects_interval():
    """Changing config mid-flight changes the next interval calculation."""
    from agent.cognition.proactive.loop import ProactiveLoop
    from config import config

    r = _build_runtime_with_fg_task(concern=0.1)
    loop = ProactiveLoop(r)
    config.agent_proactive_interval_s = 60
    config.agent_proactive_interval_min_s = 30
    config.agent_proactive_interval_max_s = 300
    before = loop._compute_interval()
    config.agent_proactive_interval_s = 120  # hot-reload style
    after = loop._compute_interval()
    # Base changed → calm branch doubles base → longer.
    assert after > before


# ── Long silence trigger helper ──────────────────────────────────────────────


def test_check_long_silence_pushes_trigger_when_threshold_exceeded():
    from agent.cognition.proactive.loop import ProactiveLoop, check_long_silence, set_loop
    from agent.cognition.proactive.triggers import ProactiveTriggerKind
    from config import config

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    set_loop(loop)
    try:
        config.agent_proactive_long_silence_threshold_min = 60
        loop._last_user_interaction_at = datetime.now(tz=timezone.utc) - timedelta(hours=2)
        assert check_long_silence() is True
        # Dedup within 30 min.
        assert check_long_silence() is False
        kinds = [t.kind for t in loop._recent_triggers]
        assert ProactiveTriggerKind.LONG_SILENCE in kinds
    finally:
        set_loop(None)


def test_check_long_silence_noop_when_no_interaction_recorded():
    from agent.cognition.proactive.loop import ProactiveLoop, check_long_silence, set_loop

    r = _build_bare_runtime()
    loop = ProactiveLoop(r)
    set_loop(loop)
    try:
        # Never recorded a user interaction → function returns False.
        assert check_long_silence() is False
    finally:
        set_loop(None)
