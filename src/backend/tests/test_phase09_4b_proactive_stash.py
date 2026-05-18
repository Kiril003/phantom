"""
Phase 9.4b — proactive loop interruptibility (stash/flush) tests.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone, timedelta

import pytest
from agent.cognition.proactive.loop import ProactiveLoop, StashedProactive

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094b-stash")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)

def _build_runtime():
    from agent.kernel.runtime import AgentRuntime
    return AgentRuntime()

@pytest.mark.asyncio
async def test_proactive_stashed_when_user_is_focused(monkeypatch):
    """If user interacted < 1.5 min ago, non-urgent proactive messages are stashed."""
    runtime = _build_runtime()
    loop = ProactiveLoop(runtime)
    
    # Mock context to show recent interaction (0.5 min)
    async def fake_build_ctx():
        return {
            "minutes_since_user": 0.5,
            "emotion": None,
            "triggers": [],
            "active_concerns": [],
        }
    monkeypatch.setattr(loop, "_build_context", fake_build_ctx)
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: True)
    
    # Mock decide to return a 'speak' intent with priority 5 (< 8)
    async def fake_decide(ctx):
        return {
            "kind": "speak",
            "message": "stashed message",
            "reason": "test",
            "priority": 5,
        }
    monkeypatch.setattr(loop, "_decide", fake_decide)
    
    emitted: list[str] = []
    async def fake_emit(msg, reason, priority, ctx, causality=""):
        emitted.append(msg)
    monkeypatch.setattr(loop, "_emit_speech", fake_emit)
    
    await loop._maybe_speak()
    
    assert emitted == []
    assert len(loop._stashed) == 1
    assert loop._stashed[0].message == "stashed message"

@pytest.mark.asyncio
async def test_proactive_emitted_when_urgent_even_if_focused(monkeypatch):
    """If priority >= 8, it bypasses stash even if user is focused."""
    runtime = _build_runtime()
    loop = ProactiveLoop(runtime)
    
    async def fake_build_ctx():
        return {"minutes_since_user": 0.5}
    monkeypatch.setattr(loop, "_build_context", fake_build_ctx)
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: True)
    
    async def fake_decide(ctx):
        return {
            "kind": "speak",
            "message": "urgent message",
            "priority": 9,
        }
    monkeypatch.setattr(loop, "_decide", fake_decide)
    
    emitted: list[str] = []
    async def fake_emit(msg, reason, priority, ctx, causality=""):
        emitted.append(msg)
    monkeypatch.setattr(loop, "_emit_speech", fake_emit)
    
    await loop._maybe_speak()
    
    assert emitted == ["urgent message"]
    assert len(loop._stashed) == 0

@pytest.mark.asyncio
async def test_stash_flushed_when_user_not_focused(monkeypatch):
    """If user not focused and stash exists, it is flushed."""
    runtime = _build_runtime()
    loop = ProactiveLoop(runtime)
    
    # Pre-populate stash
    loop._stashed.append(StashedProactive(
        kind="speak", message="old message", reason="r", causality="c", priority=5
    ))
    
    # User not focused (2.0 min since interaction)
    async def fake_build_ctx():
        return {"minutes_since_user": 2.0}
    monkeypatch.setattr(loop, "_build_context", fake_build_ctx)
    
    # Mock emit
    emitted: list[str] = []
    async def fake_emit(msg, reason, priority, ctx, causality=""):
        emitted.append(msg)
    monkeypatch.setattr(loop, "_emit_speech", fake_emit)
    
    # We don't even need to run _decide if we just want to test flush
    # but _maybe_speak calls _flush_stash first.
    # To avoid running _decide, we can make _should_consider_speaking return False
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: False)
    
    await loop._maybe_speak()
    
    assert any("old message" in m for m in emitted)
    assert len(loop._stashed) == 0
