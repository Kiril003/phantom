"""
Unit tests for SaaS Rate Limiter.
"""
from __future__ import annotations

import time
from security.rate_limiter import check_rate_limit


def test_rate_limiter_allow() -> None:
    key = f"test_key_allow_{time.time()}"
    allowed, retry_after = check_rate_limit(key, max_requests=5, window_s=60)
    assert allowed is True
    assert retry_after == 0


def test_rate_limiter_block() -> None:
    key = f"test_key_block_{time.time()}"
    for _ in range(5):
        allowed, _ = check_rate_limit(key, max_requests=5, window_s=60)
        assert allowed is True

    # 6th attempt should be blocked
    allowed, retry_after = check_rate_limit(key, max_requests=5, window_s=60)
    assert allowed is False
    assert retry_after > 0
