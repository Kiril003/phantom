"""Приймальня публічна — отже мусить уміти сказати «досить»."""
from __future__ import annotations

import pytest

from messenger.guard import FRAME_LIMIT_BYTES, GuardRejected, InboxGuard


def test_empty_frame_is_refused():
    guard = InboxGuard()
    with pytest.raises(GuardRejected):
        guard.check("1.2.3.4", 0)


def test_oversized_frame_is_refused_before_any_crypto():
    guard = InboxGuard()
    with pytest.raises(GuardRejected):
        guard.check("1.2.3.4", FRAME_LIMIT_BYTES + 1)


def test_normal_traffic_passes():
    guard = InboxGuard(max_per_window=5)
    for _ in range(5):
        guard.check("1.2.3.4", 300)


def test_flood_from_one_source_is_stopped():
    guard = InboxGuard(max_per_window=3)
    for _ in range(3):
        guard.check("1.2.3.4", 300)
    with pytest.raises(GuardRejected):
        guard.check("1.2.3.4", 300)


def test_one_flooder_does_not_block_everyone_else():
    guard = InboxGuard(max_per_window=2)
    guard.check("flooder", 300)
    guard.check("flooder", 300)
    with pytest.raises(GuardRejected):
        guard.check("flooder", 300)

    guard.check("marta", 300)  # чужа адреса не постраждала


def test_the_window_moves_on():
    guard = InboxGuard(window_s=10.0, max_per_window=2)
    guard.check("1.2.3.4", 300, now=0.0)
    guard.check("1.2.3.4", 300, now=1.0)
    with pytest.raises(GuardRejected):
        guard.check("1.2.3.4", 300, now=2.0)

    guard.check("1.2.3.4", 300, now=100.0)
