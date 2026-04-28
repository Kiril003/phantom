"""
PHANTOM OS — login-attempt lockout (Day-2 F-15).

The audit threat-model identifies the unauthenticated `/api/v1/auth/login`
endpoints as the highest-value attacker target on the LAN: 6-digit PIN
brute-force takes ~1 minute against a hot-loop attacker. The Tier E
mitigation is a per-IP + per-username sliding-window lockout that's
small, in-memory (single-tenant deploys per the D2-I2 invariant), and
replay-safe.

Behaviour:

* Each failed PIN/RFID attempt registers a (key, ts) row in a deque.
* When the deque holds ≥ ``LOCKOUT_THRESHOLD`` entries within
  ``LOCKOUT_WINDOW_S``, the key is locked for ``LOCKOUT_DURATION_S``.
* Successful auth clears the key's history.
* Both the IP and the username are tracked independently; an attacker
  switching IPs still hits the username gate, and an attacker spraying
  many usernames from one IP still hits the IP gate.

The module is process-local. PHANTOM OS runs single-tenant per the
audit's D2-I2 invariant; horizontal scale-out would need a Redis-backed
re-implementation, but that's out of scope for the current SaaS
baseline.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Deque, Tuple

logger = logging.getLogger(__name__)


# Defaults. Operator-tunable knobs land in `config.py` via the Tier E
# settings UI work, but the hard-coded defaults here ensure the module
# is safe even before settings hydrate (e.g. a daemon that crashes
# before lifespan completes still rejects spray attacks).
LOCKOUT_THRESHOLD: int = 5
LOCKOUT_WINDOW_S: int = 60
LOCKOUT_DURATION_S: int = 15 * 60


# ── Storage ──────────────────────────────────────────────────────────────────

# Per-key sliding window of failed-attempt timestamps. We trim entries
# older than LOCKOUT_WINDOW_S on every read so the deques can't grow
# without bound even if a key is hammered.
_failures: dict[str, Deque[float]] = {}

# Per-key lockout-until timestamp (None when the key is free).
_locked_until: dict[str, float] = {}

# Coarse module-level lock — every operation is short and contention is
# low even under spray. A finer-grained per-key lock isn't worth the
# memory + footgun cost here.
_lock = threading.Lock()


# ── Public API ────────────────────────────────────────────────────────────────


def is_locked(key: str) -> Tuple[bool, int]:
    """Return ``(locked, remaining_s)``.

    ``remaining_s`` is the number of seconds until the lockout expires;
    0 when not locked. Reads-only — does NOT register an attempt or
    extend an existing lockout.
    """
    if not key:
        return False, 0
    now = time.monotonic()
    with _lock:
        until = _locked_until.get(key)
        if until is None or until <= now:
            # Implicit expiry: drop the row so a future query is O(1).
            if until is not None:
                _locked_until.pop(key, None)
            return False, 0
        return True, max(0, int(until - now))


def register_failure(key: str) -> bool:
    """Record one failed auth attempt for ``key``. Returns True iff the
    key transitioned into the locked state on this call (so the caller
    can log the lockout once, not once per subsequent attempt)."""
    if not key:
        return False
    now = time.monotonic()
    with _lock:
        # Lazy-trim the window before deciding whether to lock.
        deck = _failures.setdefault(key, deque())
        cutoff = now - LOCKOUT_WINDOW_S
        while deck and deck[0] < cutoff:
            deck.popleft()
        deck.append(now)
        if len(deck) >= LOCKOUT_THRESHOLD:
            already_locked = _locked_until.get(key, 0.0) > now
            _locked_until[key] = now + LOCKOUT_DURATION_S
            # Drop the failure deck — once locked, the until timestamp
            # is the source of truth.
            _failures.pop(key, None)
            if not already_locked:
                logger.warning(
                    "login_lockout: key %r locked for %d s after %d "
                    "failures within %d s",
                    key, LOCKOUT_DURATION_S, LOCKOUT_THRESHOLD,
                    LOCKOUT_WINDOW_S,
                )
                return True
    return False


def register_success(key: str) -> None:
    """Clear all failure / lockout state for ``key`` after a successful
    auth. Best-effort — missing keys are a no-op."""
    if not key:
        return
    with _lock:
        _failures.pop(key, None)
        _locked_until.pop(key, None)


def reset_for_tests() -> None:
    """Test isolation helper — wipe all module state. Tests that
    exercise the lockout flow MUST call this in their fixture so a
    prior test's deques don't bleed in."""
    with _lock:
        _failures.clear()
        _locked_until.clear()


def _snapshot_for_tests() -> dict[str, dict[str, int]]:
    """Return a JSON-friendly snapshot of internal state — used only by
    tests to confirm cleanup / sliding-window arithmetic."""
    with _lock:
        now = time.monotonic()
        return {
            "failures": {k: len(v) for k, v in _failures.items()},
            "locked_keys": [
                k for k, until in _locked_until.items() if until > now
            ],
        }


__all__ = [
    "is_locked",
    "register_failure",
    "register_success",
    "reset_for_tests",
    "LOCKOUT_THRESHOLD",
    "LOCKOUT_WINDOW_S",
    "LOCKOUT_DURATION_S",
]
