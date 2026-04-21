"""
Phase 9.4c audit E1 — both track deques are bounded.

Foreground queue has always been empty in practice (foreground refuses
work when busy) but the deque itself is now bounded so a stray enqueue
cannot unbounded-grow the process.
"""
from __future__ import annotations

from agent.runtime import AgentRuntime


def test_foreground_queue_bounded() -> None:
    r = AgentRuntime()
    fg = r._track_queues["foreground"]
    assert fg.maxlen is not None and fg.maxlen > 0


def test_background_queue_bounded() -> None:
    r = AgentRuntime()
    bg = r._track_queues["background"]
    assert bg.maxlen is not None and bg.maxlen > 0


def test_foreground_queue_maxlen_drops_oldest() -> None:
    r = AgentRuntime()
    fg = r._track_queues["foreground"]
    cap = fg.maxlen or 50
    for i in range(cap + 5):
        fg.append(("sentinel", i))  # type: ignore[arg-type]
    assert len(fg) == cap
    # The first five appends should have been evicted.
    first = next(iter(fg))
    assert first[1] == 5  # type: ignore[misc]
