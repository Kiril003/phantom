"""
Phase 9.2.2 — F-03 blocked-quota probe targets primary directly.

Verifies:
- The probe goes through the primary provider with no router fallback.
- A QUOTA_EXHAUSTED classifier outcome means "still blocked".
- Transient errors (network) don't deadlock the probe.
- Adaptive backoff kicks in after 3 consecutive failures.
"""
from __future__ import annotations

import asyncio
import os

import pytest


os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-2-probe")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


class _RaisingProvider:
    def __init__(self, exc):
        self.exc = exc
        self.calls = 0

    async def generate(self, *a, **kw):
        self.calls += 1
        raise self.exc


class _OkProvider:
    def __init__(self):
        self.calls = 0

    async def generate(self, *a, **kw):
        from ai.provider import AIResponse
        self.calls += 1
        return AIResponse(content="OK", provider="gemini")


# ═════════════════════════════════════════════════════════════════════════════
# 1. Probe targets primary, ignores fallback
# ═════════════════════════════════════════════════════════════════════════════


class TestProbeTargetsPrimary:
    @pytest.mark.asyncio
    async def test_probe_calls_primary_not_fallback(self, monkeypatch):
        from agent import runtime as _rt_mod
        from agent.runtime import AgentRuntime
        from ai.provider import ai_router

        # The repo .env may set primary=ollama; force gemini for the probe test.
        monkeypatch.setattr(_rt_mod.config, "ai_primary_provider", "gemini")

        primary = _OkProvider()
        # Fallback that would explode if probe touched it.
        async def fb_explode(*a, **kw):
            raise AssertionError("fallback must NOT be touched by probe")
        ai_router._providers["gemini"] = primary
        ai_router._providers["ollama"] = type("X", (), {"generate": fb_explode})()
        ai_router._cooling.pop("gemini", None)

        rt = AgentRuntime()
        ok = await rt._probe_provider_recovered()
        assert ok is True
        assert primary.calls == 1

    @pytest.mark.asyncio
    async def test_probe_returns_false_when_primary_quota_exhausted(self, monkeypatch):
        from agent import runtime as _rt_mod
        from agent.runtime import AgentRuntime
        from ai.provider import ai_router

        monkeypatch.setattr(_rt_mod.config, "ai_primary_provider", "gemini")
        quota_exc = Exception(
            "429 RESOURCE_EXHAUSTED. Quota exceeded for metric: "
            "generate_content_free_tier_requests, limit: 20."
        )
        primary = _RaisingProvider(quota_exc)
        ai_router._providers["gemini"] = primary

        rt = AgentRuntime()
        ok = await rt._probe_provider_recovered()
        assert ok is False, "QUOTA_EXHAUSTED → still blocked"
        assert primary.calls == 1

    @pytest.mark.asyncio
    async def test_probe_returns_true_on_transient_network_error(self, monkeypatch):
        """Network hiccup during probe shouldn't leave the task locked forever."""
        from agent import runtime as _rt_mod
        from agent.runtime import AgentRuntime
        from ai.provider import ai_router

        monkeypatch.setattr(_rt_mod.config, "ai_primary_provider", "gemini")
        net_exc = Exception("network unreachable")
        primary = _RaisingProvider(net_exc)
        ai_router._providers["gemini"] = primary

        rt = AgentRuntime()
        ok = await rt._probe_provider_recovered()
        assert ok is True, "transient errors must not deadlock the probe"


# ═════════════════════════════════════════════════════════════════════════════
# 2. Adaptive backoff
# ═════════════════════════════════════════════════════════════════════════════


class TestProbeAdaptiveBackoff:
    @pytest.mark.asyncio
    async def test_backoff_kicks_in_after_three_failures(self, monkeypatch):
        """After 3 consecutive Falses, the probe interval grows."""
        from agent import runtime as _rt_mod
        from agent.runtime import AgentRuntime, TaskState
        from agent.schemas import SelfModel

        rt = AgentRuntime()
        rt.foreground_slot = TaskState(
            id="t-probe-backoff", goal="g", track="foreground", status="running",
            self_model=SelfModel(),
        )

        sleeps: list[float] = []
        probe_calls = {"n": 0}

        async def fake_sleep(s):
            sleeps.append(s)

        async def fake_probe(self):
            probe_calls["n"] += 1
            # Succeed on the 5th probe; fail before that.
            return probe_calls["n"] >= 5

        monkeypatch.setattr(_rt_mod.asyncio, "sleep", fake_sleep)
        monkeypatch.setattr(AgentRuntime, "_probe_provider_recovered", fake_probe)
        monkeypatch.setattr(_rt_mod.config, "agent_blocked_quota_probe_s", 60)
        monkeypatch.setattr(_rt_mod.config, "agent_blocked_quota_probe_max_s", 600)

        async def _np(*a, **kw): pass
        monkeypatch.setattr(rt, "_broadcast", _np)
        async def _ts(*a, **kw): pass
        monkeypatch.setattr(_rt_mod, "update_task_status", _ts)

        ok = await rt.enter_blocked_quota(rt.foreground_slot, "test")
        assert ok is True
        # Sleeps: probe1=60, probe2=60, probe3=60, probe4=120 (backoff), probe5=240
        # The probe SUCCEEDS on call 5. After we've slept 5 times.
        assert sleeps[:3] == [60.0, 60.0, 60.0], f"first 3 should be base 60s; got {sleeps}"
        # The 4th sleep should be > 60s (backoff started).
        assert sleeps[3] > 60.0, f"4th sleep should grow past base; got {sleeps[3]}"
        # All sleeps should be capped at max.
        assert all(s <= 600.0 for s in sleeps)

    @pytest.mark.asyncio
    async def test_backoff_capped_at_max(self, monkeypatch):
        from agent import runtime as _rt_mod
        from agent.runtime import AgentRuntime, TaskState
        from agent.schemas import SelfModel

        rt = AgentRuntime()
        rt.foreground_slot = TaskState(
            id="t-probe-cap", goal="g", track="foreground", status="running",
            self_model=SelfModel(),
        )
        sleeps: list[float] = []
        probe_calls = {"n": 0}

        async def fake_sleep(s):
            sleeps.append(s)

        async def fake_probe(self):
            probe_calls["n"] += 1
            # Succeed only after 12 calls so backoff has time to grow.
            return probe_calls["n"] >= 12

        monkeypatch.setattr(_rt_mod.asyncio, "sleep", fake_sleep)
        monkeypatch.setattr(AgentRuntime, "_probe_provider_recovered", fake_probe)
        monkeypatch.setattr(_rt_mod.config, "agent_blocked_quota_probe_s", 60)
        monkeypatch.setattr(_rt_mod.config, "agent_blocked_quota_probe_max_s", 240)

        async def _np(*a, **kw): pass
        monkeypatch.setattr(rt, "_broadcast", _np)
        async def _ts(*a, **kw): pass
        monkeypatch.setattr(_rt_mod, "update_task_status", _ts)

        await rt.enter_blocked_quota(rt.foreground_slot, "test")
        # Once we exceed max_interval, sleeps must stay at the cap.
        assert max(sleeps) == 240.0, f"max sleep must equal cap (240); got {max(sleeps)}"


# ═════════════════════════════════════════════════════════════════════════════
# 3. Config keys exist
# ═════════════════════════════════════════════════════════════════════════════


class TestConfigKeys:
    def test_probe_config_keys_exist(self):
        from config import config
        assert hasattr(config, "agent_blocked_quota_probe_s")
        assert hasattr(config, "agent_blocked_quota_probe_max_s")
        assert config.agent_blocked_quota_probe_s == 60
        assert config.agent_blocked_quota_probe_max_s == 600
