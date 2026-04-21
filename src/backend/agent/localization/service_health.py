"""
Phase 9.4c audit Q6 — external-service health tracker.

A tiny in-memory module each localization adapter pings so the Settings/
Map UI can surface "location enrichment offline" banners. The tracker
stores per-service last-success and last-failure timestamps plus a
sliding status derived from both:

  * ``ok``    — last call succeeded and it was recent
  * ``stale`` — last call succeeded but was more than STALE_AFTER_S ago
  * ``down``  — the most recent call failed

No persistence; after a restart every service starts ``unknown`` and
flips to ``ok`` on the first successful call. This is deliberate: the
audit-Q6 intent is a live-operations banner, not a long-term uptime log.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

Status = Literal["ok", "stale", "down", "unknown"]

# Thresholds: a service is "stale" if its last success was over 10 min ago
# even without any failure since, and "down" if the last call was a failure
# within the last 5 min (after which we reset to stale/unknown).
STALE_AFTER_S = 10 * 60
DOWN_AFTER_FAILURE_S = 5 * 60

TRACKED_SERVICES: tuple[str, ...] = ("nominatim", "overpass", "ipapi")


@dataclass
class _ServiceState:
    last_success_at: float = 0.0
    last_failure_at: float = 0.0
    last_failure_reason: str = ""


_state: dict[str, _ServiceState] = {name: _ServiceState() for name in TRACKED_SERVICES}


def mark_success(service: str) -> None:
    """Record a successful network call. Clears any prior failure state."""
    if service not in _state:
        _state[service] = _ServiceState()
    s = _state[service]
    s.last_success_at = time.time()
    s.last_failure_at = 0.0
    s.last_failure_reason = ""


def mark_failure(service: str, reason: str = "") -> None:
    """Record a failed network call. Stored reason surfaces in the health
    endpoint so operators can tell rate-limit from outage without grepping
    logs."""
    if service not in _state:
        _state[service] = _ServiceState()
    s = _state[service]
    s.last_failure_at = time.time()
    s.last_failure_reason = (reason or "")[:128]


def _status_for(s: _ServiceState, now: float) -> Status:
    # No calls yet — unknown.
    if s.last_success_at == 0.0 and s.last_failure_at == 0.0:
        return "unknown"
    # Recent failure dominates recent success (service is visibly unhealthy now).
    if s.last_failure_at > s.last_success_at and (now - s.last_failure_at) < DOWN_AFTER_FAILURE_S:
        return "down"
    # We have a success — is it fresh?
    if s.last_success_at > 0 and (now - s.last_success_at) > STALE_AFTER_S:
        return "stale"
    if s.last_success_at > 0:
        return "ok"
    return "unknown"


def snapshot() -> dict[str, dict]:
    """Return a JSON-safe snapshot for the /services_health endpoint."""
    now = time.time()
    out: dict[str, dict] = {}
    for name, s in _state.items():
        out[name] = {
            "status": _status_for(s, now),
            "last_success_at": s.last_success_at or None,
            "last_failure_at": s.last_failure_at or None,
            "last_failure_reason": s.last_failure_reason or None,
            "seconds_since_success": (
                int(now - s.last_success_at) if s.last_success_at else None
            ),
        }
    return out


def reset_for_tests() -> None:
    """Clear all tracked state — used by pytest fixtures to avoid bleed-over."""
    for name in list(_state):
        _state[name] = _ServiceState()


__all__ = [
    "Status",
    "TRACKED_SERVICES",
    "mark_success",
    "mark_failure",
    "snapshot",
    "reset_for_tests",
]
