"""Tier-C I-5 — Day-2 D2-D-cpu / PERF-17b: 1 Hz cached CPU sampler.

Pre-H-5 chat_tool_dispatcher's `get_system_metrics` handler called
``psutil.cpu_percent(interval=0.05)`` per chat turn — 200 ms of
event-loop block per 4-iteration call_with_tools turn. H-5 collapsed
the dispatcher onto tool_executor (which uses ``interval=None``) and
this commit adds a 1 Hz background sampler so the value is fresh
without a per-call psutil read.

Tests pin:
* sampler API surface (start/stop/get/is_running)
* idempotent start (no double-spawn on re-import)
* graceful stop (no leaked tasks)
* tool_executor.get_system_metrics reads the cached value
"""

from __future__ import annotations

import asyncio

import pytest


@pytest.fixture(autouse=True)
def _reset_sampler():
    # Test isolation: each test starts with a clean sampler module
    # state, even if a previous test left a cached value or a still-
    # running task object lying around.
    import system_metrics_sampler
    system_metrics_sampler._reset_for_tests()
    yield
    system_metrics_sampler._reset_for_tests()


class TestI5SamplerLifecycle:
    @pytest.mark.asyncio
    async def test_start_then_stop_runs_cleanly(self):
        import system_metrics_sampler as s
        assert s.is_running() is False
        await s.start()
        assert s.is_running() is True
        # Give the loop a tick — sampler primes + sets a value.
        await asyncio.sleep(0.05)
        await s.stop()
        assert s.is_running() is False

    @pytest.mark.asyncio
    async def test_start_is_idempotent(self):
        import system_metrics_sampler as s
        await s.start()
        first_task = s._sampler_task
        await s.start()  # second call must NOT spawn a new task
        assert s._sampler_task is first_task, (
            "I-5 regression: start() spawned a duplicate sampler task — "
            "lifespan re-import or hot-reload would leak."
        )
        await s.stop()

    @pytest.mark.asyncio
    async def test_get_cpu_percent_returns_zero_before_start(self):
        import system_metrics_sampler as s
        # Sampler not started — get returns the 0.0 sentinel.
        assert s.get_cpu_percent() == 0.0

    @pytest.mark.asyncio
    async def test_sampler_eventually_caches_a_value(self):
        # The 1 Hz cadence + interval=None semantics mean the first cycle
        # writes 0.0 (since-startup CPU read with no prior baseline can
        # return 0). After at least one full sample interval the cache
        # holds whatever the OS reports.
        import system_metrics_sampler as s
        await s.start()
        # Two ticks gives the prime read + one real sample.
        await asyncio.sleep(1.2)
        v = s.get_cpu_percent()
        assert v >= 0.0
        assert v <= 100.0
        await s.stop()


class TestI6PerfTotalCapConfig:
    """PERF-17b: chat_tool_max_total_ms is the per-turn wall-clock cap
    Phase 17b's call_with_tools loop must honour. We can't yet test
    the loop itself (Tier D land) but the config knob has to exist with
    a sane default so the loop has something to read.
    """

    def test_config_field_exists_with_sane_default(self):
        from config import PhantomConfig

        v = PhantomConfig.model_fields["chat_tool_max_total_ms"].default
        # Must be > per-call timeout (else the per-call path can't
        # complete). Must be < tolerable chat-turn budget (~30 s).
        assert isinstance(v, int)
        assert 5_000 <= v <= 30_000, (
            "PERF-17b regression: chat_tool_max_total_ms is outside the "
            "5..30 s band the audit calls 'tolerable'."
        )

    def test_total_cap_exceeds_per_call_cap(self):
        from config import PhantomConfig

        per_call_s = float(
            PhantomConfig.model_fields["chat_tool_call_timeout_s"].default
        )
        total_ms = int(
            PhantomConfig.model_fields["chat_tool_max_total_ms"].default
        )
        # Allow at least one full per-call window to fit inside the
        # per-turn ceiling — otherwise a single legitimate tool call
        # could exhaust the turn budget.
        assert total_ms >= int(per_call_s * 1000)


class TestI5ToolExecutorReadsCache:
    @pytest.mark.asyncio
    async def test_tool_get_system_metrics_uses_cached_cpu(self, monkeypatch):
        # Stash a sentinel in the cache and confirm tool_executor reports
        # it back instead of calling psutil directly. We monkeypatch
        # psutil.cpu_percent to FAIL — if tool_executor still calls it,
        # the test surfaces the regression.
        import system_metrics_sampler as s
        from ai.tool_executor import execute_tool

        s._set_cached(42.7)

        import psutil
        original_cpu = psutil.cpu_percent

        def _boom(*a, **kw):
            raise RuntimeError(
                "I-5 regression: get_system_metrics called psutil.cpu_percent "
                "directly instead of reading the 1 Hz cache."
            )

        monkeypatch.setattr(psutil, "cpu_percent", _boom)
        try:
            out = await execute_tool("get_system_metrics", {}, "phantom")
            assert out["ok"] is True
            assert out["cpu_pct"] == 42.7
        finally:
            monkeypatch.setattr(psutil, "cpu_percent", original_cpu)
