"""Day-4 Wave-2 X-4 — orchestrator budget split + asyncio.wait
gather-no-cancel (ADR-ORC-004 + ADR-ORC-005).

Closes audit U3-ORCH-H4 (budget exhaustion failure mode).

Coverage:

1. split(12000, 3, 1500) == BudgetSplit(per_sub=3500, reserve=1500)
   — the canonical PHASE1_CONTEXTS default split.
2. split(600, 3, 100) clamps to (500, 500) — floor enforcement when
   the natural split falls below 500 ms per leaf.
3. split with k=0 → (floor, floor); negative total → (floor, floor).
4. PER_SUB_FLOOR_MS == 500.
5. gather_with_deadline returns coro results in original order when
   all complete in time.
6. gather_with_deadline surfaces LeafTimeout sentinels for slots
   that exceeded the deadline AND does NOT cancel the survivors
   (ADR-ORC-005 invariant).
7. gather_with_deadline with deadline_s ≤ 0 returns LeafTimeout for
   every coro without spawning work.
8. A leaf coro that RAISES has its exception captured + returned in
   the result slot (orchestrator merge fold handles ok=False itself).
9. timed_out_indices indexes match the synthetic LeafTimeout slots.
"""
from __future__ import annotations

import asyncio
from dataclasses import is_dataclass

import pytest


# ──────────────────────────────────────────────────────── budget split ──


class TestBudgetSplit:
    def test_canonical_default_split(self):
        from ai.agents import split

        result = split(12000, 3, 1500)
        assert result.per_sub_ms == 3500
        assert result.merge_reserve_ms == 1500

    def test_floor_clamps_below_500(self):
        from ai.agents import split

        # 600 - 100 = 500; 500 // 3 = 166 → below floor → clamp.
        result = split(600, 3, 100)
        assert result.per_sub_ms == 500
        assert result.merge_reserve_ms == 500, (
            "X-4: when per-leaf budget drops below the floor, BOTH "
            "fields clamp to the floor so decide_mode can spot the "
            "degenerate case."
        )

    def test_zero_k_returns_floor(self):
        from ai.agents import split

        result = split(12000, 0, 1500)
        assert result.per_sub_ms >= 500
        assert result.merge_reserve_ms >= 500

    def test_negative_total_returns_floor(self):
        from ai.agents import split

        result = split(-100, 3, 1500)
        assert result.per_sub_ms == 500
        assert result.merge_reserve_ms == 500

    def test_per_sub_floor_constant_is_500(self):
        from ai.agents import PER_SUB_FLOOR_MS

        assert PER_SUB_FLOOR_MS == 500

    def test_split_returns_dataclass(self):
        from ai.agents import BudgetSplit, split

        result = split(12000, 3, 1500)
        assert isinstance(result, BudgetSplit)
        assert is_dataclass(result)

    def test_split_rejects_non_int_inputs(self):
        from ai.agents import split

        with pytest.raises(TypeError):
            split(12000.0, 3, 1500)  # type: ignore[arg-type]
        with pytest.raises(TypeError):
            split(12000, "three", 1500)  # type: ignore[arg-type]


# ─────────────────────────────────────────────── gather-no-cancel helper ──


class TestGatherWithDeadline:
    @pytest.mark.asyncio
    async def test_all_complete_in_time(self):
        from ai.agents import gather_with_deadline

        async def work(idx: int) -> int:
            await asyncio.sleep(0.01)
            return idx * 10

        coros = [work(i) for i in range(3)]
        results, timed_out = await gather_with_deadline(
            coros, deadline_s=1.0
        )
        assert results == [0, 10, 20]
        assert timed_out == []

    @pytest.mark.asyncio
    async def test_zero_deadline_synthesises_timeout_for_all(self):
        from ai.agents import LeafTimeout, gather_with_deadline

        async def never() -> int:
            await asyncio.sleep(10)
            return 0  # pragma: no cover

        coros = [never(), never()]
        results, timed_out = await gather_with_deadline(
            coros, deadline_s=0.0
        )
        assert all(isinstance(r, LeafTimeout) for r in results)
        assert timed_out == [0, 1]
        # Properly close the never-awaited coros so vitest doesn't
        # warn.
        for c in coros:
            c.close()

    @pytest.mark.asyncio
    async def test_partial_timeout_keeps_completed_results(self):
        """ADR-ORC-005 invariant: a partial timeout MUST surface the
        already-completed leaves, NOT cancel them."""
        from ai.agents import LeafTimeout, gather_with_deadline

        async def fast() -> str:
            await asyncio.sleep(0.01)
            return "fast-done"

        async def slow() -> str:
            await asyncio.sleep(2.0)
            return "slow-done"  # pragma: no cover

        coros = [fast(), slow(), fast()]
        results, timed_out = await gather_with_deadline(
            coros, deadline_s=0.2
        )
        assert results[0] == "fast-done"
        assert results[2] == "fast-done"
        assert isinstance(results[1], LeafTimeout)
        assert timed_out == [1]

    @pytest.mark.asyncio
    async def test_leaf_exception_captured_in_slot(self):
        """A coro that raises returns the exception object in its
        results slot — the orchestrator merge fold turns that into
        ok=False without crashing the whole turn."""
        from ai.agents import gather_with_deadline

        async def good() -> str:
            return "ok"

        async def bad() -> str:
            raise RuntimeError("simulated leaf failure")

        results, timed_out = await gather_with_deadline(
            [good(), bad()], deadline_s=1.0
        )
        assert results[0] == "ok"
        assert isinstance(results[1], RuntimeError)
        assert "simulated leaf failure" in str(results[1])
        assert timed_out == []

    @pytest.mark.asyncio
    async def test_empty_coros_returns_empty_lists(self):
        from ai.agents import gather_with_deadline

        results, timed_out = await gather_with_deadline([], deadline_s=1.0)
        assert results == []
        assert timed_out == []

    @pytest.mark.asyncio
    async def test_timed_out_indices_match_results(self):
        """Belt-and-braces — timed_out indices must index into results
        in the same order as the input coros."""
        from ai.agents import LeafTimeout, gather_with_deadline

        async def fast() -> str:
            return "fast"

        async def slow() -> str:
            await asyncio.sleep(2.0)
            return "slow"  # pragma: no cover

        coros = [slow(), fast(), slow()]
        results, timed_out = await gather_with_deadline(
            coros, deadline_s=0.1
        )
        assert timed_out == [0, 2]
        for idx in timed_out:
            assert isinstance(results[idx], LeafTimeout)
        assert results[1] == "fast"
