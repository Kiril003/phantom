"""Reflection-cap guard — auto-pause when revise_strategy repeats.

Covers :class:`agent.loop.RevisionLoopGuard`. The class is intentionally
synchronous and side-effect free so it can be unit-tested without the
agent runtime.
"""
from __future__ import annotations

from agent.kernel.loop import RevisionLoopGuard


def test_increments_on_same_step_same_verdict():
    g = RevisionLoopGuard()
    assert g.observe(step_idx=0, verdict="revise_strategy") == 1
    assert g.observe(step_idx=0, verdict="revise_strategy") == 2
    assert g.observe(step_idx=0, verdict="revise_strategy") == 3


def test_resets_on_different_verdict():
    g = RevisionLoopGuard()
    g.observe(step_idx=0, verdict="revise_strategy")
    g.observe(step_idx=0, verdict="revise_strategy")
    assert g.observe(step_idx=0, verdict="continue") == 0
    # After reset, a new revise_strategy starts fresh at 1.
    assert g.observe(step_idx=0, verdict="revise_strategy") == 1


def test_resets_on_different_step():
    g = RevisionLoopGuard()
    g.observe(step_idx=0, verdict="revise_strategy")
    g.observe(step_idx=0, verdict="revise_strategy")
    # Different step → reset to 1.
    assert g.observe(step_idx=1, verdict="revise_strategy") == 1


def test_should_pause_threshold_5():
    g = RevisionLoopGuard(threshold=5)
    for _ in range(4):
        n = g.observe(step_idx=0, verdict="revise_strategy")
        assert g.should_pause(n) is False
    n = g.observe(step_idx=0, verdict="revise_strategy")
    assert g.should_pause(n) is True


def test_explicit_reset():
    g = RevisionLoopGuard(threshold=5)
    for _ in range(4):
        g.observe(step_idx=0, verdict="revise_strategy")
    g.reset()
    # After reset, the next observe starts from 1 again.
    assert g.observe(step_idx=0, verdict="revise_strategy") == 1


def test_custom_threshold():
    g = RevisionLoopGuard(threshold=2)
    n1 = g.observe(step_idx=3, verdict="revise_strategy")
    n2 = g.observe(step_idx=3, verdict="revise_strategy")
    assert g.should_pause(n1) is False
    assert g.should_pause(n2) is True


def test_revise_subgoal_does_not_increment():
    """`revise_subgoal` is a different verdict and must not count."""
    g = RevisionLoopGuard()
    assert g.observe(step_idx=0, verdict="revise_subgoal") == 0
    assert g.observe(step_idx=0, verdict="revise_subgoal") == 0
    # Then a real revise_strategy starts the counter at 1.
    assert g.observe(step_idx=0, verdict="revise_strategy") == 1
