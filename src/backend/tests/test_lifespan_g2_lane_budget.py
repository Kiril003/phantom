"""Lifespan G2 warmup — a wedged lane must not hold startup open.

`lifespan_warmup` documents two invariants: "no G2 failure ever aborts the
lifespan" and a ≤ 2000 ms p95 budget for G1+G2. A lane that never returns
satisfies neither — it is not an exception, so the per-lane `try/except` never
sees it, and `asyncio.gather` waits on it forever.

That is not hypothetical: `_lane_minilm` pulls sentence-transformers, which
fetches the encoder over the network on a cold cache. On a device with no route
out — the normal state for a local-first product — startup parked indefinitely
and the daemon never became ready.
"""
from __future__ import annotations

import asyncio

import pytest

import lifespan_warmup


@pytest.mark.asyncio
async def test_a_wedged_lane_does_not_park_startup(monkeypatch, caplog):
    hung_started = asyncio.Event()
    fast_ran = False

    async def _hung_lane() -> None:
        hung_started.set()
        await asyncio.sleep(3600)

    async def _fast_lane() -> None:
        nonlocal fast_ran
        fast_ran = True

    monkeypatch.setattr(
        lifespan_warmup, "_G2_LANES", (("wedged", _hung_lane), ("fast", _fast_lane))
    )
    monkeypatch.setattr(lifespan_warmup, "G2_LANE_TIMEOUT_S", 0.25)

    # Must return on its own; the outer wait_for is the test's own safety net.
    await asyncio.wait_for(lifespan_warmup.run_g2_parallel(), timeout=10)

    assert hung_started.is_set(), "the wedged lane never actually started"
    assert fast_ran, "a healthy lane must still complete alongside a wedged one"
    assert any(
        "exceeded its" in r.getMessage() and "wedged" in r.getMessage()
        for r in caplog.records
    ), "operators need a WARN naming the lane that blew its budget"


@pytest.mark.asyncio
async def test_a_lane_raising_still_lets_the_others_finish(monkeypatch):
    fast_ran = False

    async def _broken_lane() -> None:
        raise RuntimeError("lane escaped its own guard")

    async def _fast_lane() -> None:
        nonlocal fast_ran
        fast_ran = True

    monkeypatch.setattr(
        lifespan_warmup, "_G2_LANES", (("broken", _broken_lane), ("fast", _fast_lane))
    )

    # No exception may escape: startup continues regardless of lane health.
    await asyncio.wait_for(lifespan_warmup.run_g2_parallel(), timeout=10)
    assert fast_ran


@pytest.mark.asyncio
async def test_healthy_lanes_are_not_slowed_by_the_ceiling(monkeypatch):
    """The budget is a ceiling, not a delay — normal startup must not wait it out."""
    async def _quick() -> None:
        await asyncio.sleep(0)

    monkeypatch.setattr(
        lifespan_warmup, "_G2_LANES", tuple((f"quick{i}", _quick) for i in range(5))
    )
    monkeypatch.setattr(lifespan_warmup, "G2_LANE_TIMEOUT_S", 30.0)

    loop = asyncio.get_running_loop()
    started = loop.time()
    await lifespan_warmup.run_g2_parallel()
    assert loop.time() - started < 1.0
