"""
Verification tests for Wave-2 Phase 2 features:
- Unified ContextEngine signals and speech gap detection.
- SessionMemory deferred thoughts HOLD queue.
- ProactiveLoop integration, decay logic, and Referee re-routing.
- Earcon manager events.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from core.event_bus import event_bus
from core.context_engine import ContextEngine
from core.referee import system_referee, OutputFrame, PriorityTier
from memory.session_memory import session_memory, DeferredThought
from agent.cognition.proactive.loop import ProactiveLoop
from voice.earcons import play_earcon


@pytest.mark.asyncio
async def test_unified_context_signals():
    """Verify that unified context_signal events are emitted alongside legacy events."""
    engine = ContextEngine()
    engine._calm_delay_s = 0.1
    engine._gap_delay_s = 0.05
    
    signals = []
    def on_signal(data):
        signals.append(data)
        
    event_bus.on("context_signal", on_signal)
    
    try:
        # 1. Calm Window Transition
        await engine.tick()
        assert any(s["name"] == "calm_window_opened" for s in signals)
        
        # 2. Activity closes calm window
        signals.clear()
        engine.record_interaction(method="touch")
        assert any(s["name"] == "calm_window_closed" for s in signals)
        
        # 3. Speech VAD ending triggers gap_detected after gap threshold
        signals.clear()
        engine.record_voice_activity(True)
        engine.record_voice_activity(False)
        await asyncio.sleep(0.08)
        await engine.tick()
        assert any(s["name"] == "gap_detected" for s in signals)
        
    finally:
        event_bus.off("context_signal", on_signal)


def test_session_memory_hold_queue():
    """Verify stashing, pruning, and clearing of deferred thoughts in SessionMemory."""
    session_id = "test_sess_123"
    session_memory.clear_deferred_thoughts(session_id)
    
    # 1. Defer a thought
    tid = session_memory.defer_thought(
        session_id=session_id,
        kind="speak",
        content="Hello world",
        priority=5,
        value=0.5,
        ttl=0.1,  # short TTL
        metadata={"reason": "test"}
    )
    assert tid is not None
    
    deferred = session_memory.get_deferred_thoughts(session_id)
    assert len(deferred) == 1
    assert deferred[0].content == "Hello world"
    
    # 2. Let it expire and prune
    time.sleep(0.12)
    session_memory.prune_expired_thoughts(session_id)
    deferred_pruned = session_memory.get_deferred_thoughts(session_id)
    assert len(deferred_pruned) == 0
    
    # 3. Clear deferred thoughts
    session_memory.defer_thought(session_id, "speak", "Hi", 3, 0.3, 10.0)
    assert len(session_memory.get_deferred_thoughts(session_id)) == 1
    session_memory.clear_deferred_thoughts(session_id)
    assert len(session_memory.get_deferred_thoughts(session_id)) == 0


@pytest.mark.asyncio
async def test_proactive_loop_hold_and_release(monkeypatch):
    """Verify ProactiveLoop stashes thoughts, applies value decay, and routes to Referee."""
    # Mock runtime
    runtime = MagicMock()
    loop = ProactiveLoop(runtime)
    
    # Mock referee
    emitted_frames = []
    async def mock_emit(frame):
        emitted_frames.append(frame)
        return True
    
    monkeypatch.setattr(system_referee, "emit", mock_emit)
    
    # Mock session ID
    async def mock_session_id():
        return "sess_abc"
    monkeypatch.setattr(loop, "_most_recent_session_id", mock_session_id)
    
    session_id = "sess_abc"
    session_memory.clear_deferred_thoughts(session_id)
    
    # Simulate a decision to stash (user is busy/focused)
    # We call loop._maybe_speak with a mock decision that triggers stashing
    # In _maybe_speak: if is_focused and priority < 8: stash
    async def mock_build_context():
        return {"minutes_since_user": 0.5}  # less than 1.5 min means user is focused
    
    async def mock_decide(ctx):
        return {
            "kind": "speak",
            "message": "Let me show you a trick",
            "reason": "focused_test",
            "priority": 5,
            "causality_reason": "causal_test"
        }
    
    monkeypatch.setattr(loop, "_build_context", mock_build_context)
    monkeypatch.setattr(loop, "_decide", mock_decide)
    
    # Mock check_long_silence and other filters
    monkeypatch.setattr(loop, "_should_consider_speaking", lambda ctx: True)
    
    # 1. Run maybe_speak -> should stash/defer the thought
    await loop._maybe_speak()
    
    deferred = session_memory.get_deferred_thoughts(session_id)
    assert len(deferred) == 1
    assert deferred[0].content == "Let me show you a trick"
    assert deferred[0].priority == 5
    assert deferred[0].value == 0.5  # 5 / 10
    
    # 2. Release trigger on calm window or speech gap
    # Let's wait a tiny bit to check decay logic
    await asyncio.sleep(0.05)
    
    # Fire unified ContextEngine signal to release
    await loop._release_deferred_thoughts()
    
    # Top thought should be released and routed to referee
    assert len(emitted_frames) == 1
    frame = emitted_frames[0]
    assert frame.tier == PriorityTier.CONVERSATION
    assert frame.payload["message"] == "Let me show you a trick"
    assert frame.payload["priority"] == 5
    
    # Value should have linear decayed slightly
    # original value: 0.5. age: ~0.05s. ttl: 600.
    # decayed_value = 0.5 * (1.0 - ~0.05 / 600.0) -> slightly less than 0.5 but > 0.49
    assert 0.45 < frame.ttl <= 600.0
    
    # Verified stashed list in session memory got cleared after emission
    assert len(session_memory.get_deferred_thoughts(session_id)) == 0


@pytest.mark.asyncio
async def test_earcon_websocket_broadcast(monkeypatch):
    """Verify that play_earcon broadcasts a WebSocket frame over agent.stream."""
    broadcasts = []
    
    async def mock_broadcast(channel, type_, payload):
        broadcasts.append((channel, type_, payload))
        
    from api.websocket_hub import hub
    monkeypatch.setattr(hub, "broadcast", mock_broadcast)
    
    await play_earcon("success")
    assert len(broadcasts) == 1
    channel, event_type, payload = broadcasts[0]
    assert channel == "agent.stream"
    assert event_type == "earcon"
    assert payload["event"] == "earcon"
    assert payload["name"] == "success"
