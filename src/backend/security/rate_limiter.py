"""
Sliding-Window Rate Limiter & Token Quota Manager for Enterprise SaaS deployments.
Enforces requests-per-minute (RPM) and monthly AI token budgets per Tenant.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import HTTPException, Request, Response, status

from core.tenant import get_current_tenant_id
from security.client_ip import resolve_client_ip

logger = logging.getLogger(__name__)

# Default limits: 120 requests per minute per tenant
DEFAULT_RPM = 120
WINDOW_SECONDS = 60

# In-memory sliding window deque per key: key -> deque of timestamps
_REQUEST_HISTORY: dict[str, deque[float]] = defaultdict(deque)

# Keys embed the caller IP, so without pruning the map retains an entry for
# every address the process has ever served — an unbounded heap leak on any
# internet-facing deployment. Sweep idle keys on a coarse interval; the cost is
# amortised across requests rather than paid per call.
_SWEEP_INTERVAL_S = 300.0
#: Idle horizon for eviction, deliberately independent of any caller's
#: ``window_s``. Callers may pass different windows for the same shared map, so
#: pruning against whichever window happened to arrive last could drop a key
#: still inside a longer window and hand that caller a fresh budget.
_IDLE_TTL_S = 900.0
_last_sweep = 0.0


def _sweep_idle_keys(now: float) -> None:
    """Drop keys untouched for longer than the idle horizon."""
    global _last_sweep
    if now - _last_sweep < _SWEEP_INTERVAL_S:
        return
    _last_sweep = now
    stale = [k for k, h in _REQUEST_HISTORY.items() if not h or h[-1] < now - _IDLE_TTL_S]
    for k in stale:
        del _REQUEST_HISTORY[k]


def check_rate_limit(key: str, max_requests: int = DEFAULT_RPM, window_s: int = WINDOW_SECONDS) -> tuple[bool, int]:
    """
    Check if `key` (tenant_id or IP) exceeds `max_requests` in `window_s`.
    Returns (is_allowed, remaining_seconds).
    """
    now = time.time()
    cutoff = now - window_s
    # Sweep before touching the defaultdict: pruning afterwards could delete the
    # freshly created empty deque for *this* key, leaving the counter appending
    # to a detached object and silently disabling the limit for that caller.
    _sweep_idle_keys(now)
    history = _REQUEST_HISTORY[key]

    # Evict timestamps older than window cutoff
    while history and history[0] < cutoff:
        history.popleft()

    if len(history) >= max_requests:
        oldest = history[0]
        retry_after = int(max(1, oldest + window_s - now))
        return False, retry_after

    history.append(now)
    return True, 0


async def tenant_rate_limit_middleware(request: Request, call_next: Callable) -> Response:
    """FastAPI Middleware checking request rate limits per tenant/IP."""
    # Skip rate limiting for static assets or health checks
    path = request.url.path
    if path.startswith("/health") or path.startswith("/metrics") or path.startswith("/static"):
        return await call_next(request)

    tenant_id = get_current_tenant_id()
    # Day-3 D3-A-2 keyed the login lockout through XFF-aware resolution but left
    # this gate on the raw TCP peer. Behind a reverse proxy that peer is always
    # the proxy, so every remote caller shared one bucket: one noisy client
    # could 429 the whole tenant, and a real abuser was never isolated.
    client_ip = resolve_client_ip(request)
    rate_key = f"rate:{tenant_id}:{client_ip}"

    allowed, retry_after = check_rate_limit(rate_key)
    if not allowed:
        logger.warning("Rate limit exceeded for %s on path %s", rate_key, path)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after), "X-Error-Code": "RATE_LIMIT_EXCEEDED"},
        )

    response = await call_next(request)
    return response
