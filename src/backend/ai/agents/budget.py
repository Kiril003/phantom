"""Day-4 Wave-2 X-4 — orchestrator budget split + asyncio.wait
gather-no-cancel (ADR-ORC-004 + ADR-ORC-005).

Per ADR-ORC-004 (per-leaf budget):
  per_sub_ms = (total_ms - merge_reserve_ms) // K
  with a 500 ms floor on per_sub_ms; if the floor cannot be met the
  orchestrator MUST route to single-turn (decided in `decide_mode`).

Per ADR-ORC-005 (gather-no-cancel):
  We use `asyncio.wait(..., return_when=ALL_COMPLETED, timeout=deadline_s)`,
  NOT `gather(..., return_exceptions=True)` wrapped in `wait_for`. The
  latter cancels every surviving task when the outer timeout fires —
  discarding already-completed leaf results. With `wait` the timeout
  surfaces a `(done, pending)` split and we keep the `done` results.

Both helpers are pure-ish (budget split is fully pure;
gather-with-deadline shells out to asyncio but never cancels its
coros itself).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable


# ───────────────────────────────────────────────────────────── budget split ──


#: Hard floor on `per_sub_ms`. Below this the leaf doesn't have
#: enough wall-clock to round-trip a Gemini call + sanitize, so the
#: orchestrator falls through to single-turn instead.
PER_SUB_FLOOR_MS: int = 500


@dataclass(frozen=True)
class BudgetSplit:
    """Closed result struct from `split(...)`. The dataclass shape is
    public so call sites can destructure with `result.per_sub_ms` /
    `result.merge_reserve_ms` rather than positional unpacking that
    would silently regress on a future contract change."""

    per_sub_ms: int
    merge_reserve_ms: int


def split(
    total_ms: int,
    k: int,
    merge_reserve_ms: int,
    *,
    floor_ms: int = PER_SUB_FLOOR_MS,
) -> BudgetSplit:
    """Compute (per_sub_ms, merge_reserve_ms) given the total budget.

    `total_ms`           — chat_tool_max_total_ms (config default 12000).
    `k`                  — fan-out width (chat_orchestrator_max_subagents).
    `merge_reserve_ms`   — chat_orchestrator_merge_reserve_ms.
    `floor_ms`           — minimum per-leaf wall-clock; defaults to 500.

    Floor enforcement: when the natural split `(total - reserve) // k`
    falls below `floor_ms`, BOTH per_sub and reserve clamp to floor_ms.
    The caller (decide_mode) sees a per_sub equal to floor_ms and
    routes to single-turn instead — there's no point spawning K leaves
    that each have 50 ms of budget.

    Defensive: negative or zero inputs yield (floor_ms, floor_ms).
    """
    if not isinstance(total_ms, int) or not isinstance(k, int):
        raise TypeError("total_ms and k must be int")
    if k <= 0:
        # K=0 is meaningless; collapse to (floor, floor).
        return BudgetSplit(per_sub_ms=max(floor_ms, 1), merge_reserve_ms=max(floor_ms, 1))
    if total_ms <= 0 or merge_reserve_ms < 0:
        return BudgetSplit(per_sub_ms=floor_ms, merge_reserve_ms=floor_ms)

    natural = (total_ms - merge_reserve_ms) // k
    if natural < floor_ms:
        return BudgetSplit(per_sub_ms=floor_ms, merge_reserve_ms=floor_ms)
    return BudgetSplit(per_sub_ms=natural, merge_reserve_ms=merge_reserve_ms)


# ─────────────────────────────────────────────────── gather-no-cancel helper ──


async def gather_with_deadline(
    coros: list[Awaitable[Any]],
    *,
    deadline_s: float,
) -> tuple[list[Any], list[Any]]:
    """Run `coros` concurrently with a wall-clock deadline.

    Returns ``(done_results, timed_out_indices)``:
      `done_results`        — same length as `coros`; entries for
                              completed coros are their result; entries
                              for timed-out coros are the sentinel
                              :class:`LeafTimeout` instance, NOT a
                              cancelled task.
      `timed_out_indices`   — convenience list of indices that timed out.

    Per ADR-ORC-005: NEVER cancels surviving tasks. The pending set
    returned by `asyncio.wait` is left running so the next event-loop
    tick can finalise them; the orchestrator merge-fold ignores them
    via the timed_out_indices list.

    `deadline_s` ≤ 0 → behave as if every coro timed out (no work
    actually started). Defensive against a config that pushes per_sub
    below 1 ms.
    """
    if not coros:
        return ([], [])
    if deadline_s <= 0:
        # Don't even start — surface a synthetic timeout for every coro.
        return (
            [LeafTimeout() for _ in coros],
            list(range(len(coros))),
        )

    # Wrap in named tasks so we can map task → original index after
    # asyncio.wait returns.
    tasks: list[asyncio.Task[Any]] = [
        asyncio.ensure_future(coro) for coro in coros
    ]
    try:
        done, pending = await asyncio.wait(
            tasks,
            timeout=deadline_s,
            return_when=asyncio.ALL_COMPLETED,
        )
    except asyncio.CancelledError:
        # Outer cancel propagates; don't swallow it but also don't
        # cancel surviving tasks ourselves (caller may want to await
        # them on the next loop iteration).
        for t in tasks:
            if not t.done():
                t.cancel()
        raise

    results: list[Any] = []
    timed_out: list[int] = []
    for idx, task in enumerate(tasks):
        if task in done:
            try:
                results.append(task.result())
            except BaseException as exc:  # noqa: BLE001
                # Per ADR-ORC-005: a leaf raising bubbles up as its
                # own exception object so the merge fold can record
                # ok=False for that sub_idx without crashing the
                # whole orchestrator turn.
                results.append(exc)
        else:
            # Pending — left running per the no-cancel contract. The
            # orchestrator will surface a synthetic timeout result for
            # this slot.
            results.append(LeafTimeout())
            timed_out.append(idx)
    return results, timed_out


@dataclass(frozen=True)
class LeafTimeout:
    """Sentinel returned by gather_with_deadline for tasks that didn't
    complete inside the wall-clock budget. The orchestrator merge fold
    reads these and emits a synthetic LeafResult(ok=False,
    reason='leaf_timeout') for that sub_idx."""

    reason: str = "leaf_timeout"


__all__ = [
    "BudgetSplit",
    "LeafTimeout",
    "PER_SUB_FLOOR_MS",
    "gather_with_deadline",
    "split",
]
