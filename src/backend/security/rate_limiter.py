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

logger = logging.getLogger(__name__)

# Default limits: 120 requests per minute per tenant
DEFAULT_RPM = 120
WINDOW_SECONDS = 60

# In-memory sliding window deque per key: key -> deque of timestamps
_REQUEST_HISTORY: dict[str, deque[float]] = defaultdict(deque)


def check_rate_limit(key: str, max_requests: int = DEFAULT_RPM, window_s: int = WINDOW_SECONDS) -> tuple[bool, int]:
    """
    Check if `key` (tenant_id or IP) exceeds `max_requests` in `window_s`.
    Returns (is_allowed, remaining_seconds).
    """
    now = time.time()
    cutoff = now - window_s
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
    client_ip = request.client.host if request.client else "unknown"
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
