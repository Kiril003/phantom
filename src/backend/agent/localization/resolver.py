"""
Phase 9.4b — LocalizationResolver.

Queries registered sources in trust-order, applies sanity checks against
recent history, returns the best estimate or None. The resolver is a
module-level singleton because ContextEngine pulls from it every 500ms
and we want source state (rate-limit counters, caches) to persist.
"""
from __future__ import annotations

import asyncio
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Iterable, Optional

from config import config

from .base import (
    LocalizationError,
    LocationEstimate,
    LocalizationSource,
    haversine_km,
)

logger = logging.getLogger(__name__)


class LocalizationResolver:
    """Resolves the current position by querying sources in trust-order.

    Sanity check: reject any estimate that would require moving faster than
    ``config.agent_localization_sanity_max_speed_kmh`` from the last accepted
    position within a 5 s window. Rationale: a 500-km jump in under 5 s is
    almost certainly a buggy IP lookup or a clock-skew replay, not a user
    who took a rocket. The check is skipped when ``dt`` is long enough that
    fast motion is physically plausible (e.g. 10 min commute).
    """

    # Sanity check window — above this gap, we stop policing velocity.
    SANITY_WINDOW_S = 5.0

    def __init__(self, sources: Optional[Iterable[LocalizationSource]] = None) -> None:
        self._sources: list[LocalizationSource] = []
        if sources:
            for s in sources:
                self.add_source(s)
        self._history: deque[LocationEstimate] = deque(maxlen=50)
        self._lock = asyncio.Lock()

    # ── Registration ─────────────────────────────────────────────────────────

    def add_source(self, source: LocalizationSource) -> None:
        """Add (or replace) a source by name, keeping the list sorted by trust desc."""
        self._sources = [s for s in self._sources if s.name != source.name]
        self._sources.append(source)
        self._sources.sort(key=lambda s: -s.trust_level)

    def remove_source(self, name: str) -> None:
        self._sources = [s for s in self._sources if s.name != name]

    @property
    def sources(self) -> list[LocalizationSource]:
        return list(self._sources)

    # ── Resolution ───────────────────────────────────────────────────────────

    async def resolve(self) -> Optional[LocationEstimate]:
        """Walk sources in trust order. Return first passing estimate, or None."""
        if not getattr(config, "agent_localization_enabled", True):
            return None
        async with self._lock:
            for source in self._sources:
                try:
                    if not source.is_available():
                        continue
                except Exception as exc:  # noqa: BLE001
                    logger.debug("source %s is_available() raised: %s", source.name, exc)
                    continue
                try:
                    estimate = await source.get_position()
                except LocalizationError as exc:
                    logger.info("source %s unavailable: %s", source.name, exc)
                    continue
                except Exception as exc:  # noqa: BLE001
                    logger.warning("source %s raised unexpectedly: %s", source.name, exc)
                    continue
                if estimate is None:
                    continue
                if self._is_identity_duplicate(estimate):
                    # Same source + same coordinates as the last accepted
                    # fix — an idempotent re-read, not a replay. Return it
                    # without double-appending to history (keeps the deque
                    # free for genuine motion).
                    return estimate
                if not self._passes_sanity(estimate):
                    logger.warning(
                        "rejecting implausible fix from %s: %.5f,%.5f",
                        source.name, estimate.lat, estimate.lon,
                    )
                    continue
                self._history.append(estimate)
                return estimate
        return None

    # ── Sanity ───────────────────────────────────────────────────────────────

    def _is_identity_duplicate(self, estimate: LocationEstimate) -> bool:
        """True when this estimate has the same source and coordinates as the
        most recent accepted fix.

        Phase 9.4c.1 hotfix — previously the resolver treated any
        ``dt_s <= 0`` reading as a replay attack and rejected it. That
        misfired on cached ``LocationEstimate`` objects whose timestamp
        was frozen at construction, trapping the chain in a 500 ms
        rejection loop. Matching by identity first lets genuinely
        idempotent re-reads pass through while still letting the velocity
        check catch real clock-skew replays (different coords, older
        timestamp) below.
        """
        if not self._history:
            return False
        last = self._history[-1]
        return (
            estimate.source == last.source
            and estimate.lat == last.lat
            and estimate.lon == last.lon
        )

    def _passes_sanity(self, estimate: LocationEstimate) -> bool:
        """Reject any estimate that would require implausible velocity from the
        last accepted position (within SANITY_WINDOW_S). Past that window any
        motion is physically plausible so we don't penalise it.

        Identity-duplicate estimates are handled upstream in :meth:`resolve`
        and never reach this method, so ``dt_s <= 0`` here means a genuine
        backwards-clock situation with different coordinates.
        """
        if not self._history:
            return True
        last = self._history[-1]
        # A strictly more trustworthy source supersedes the last accepted fix
        # outright. The velocity guard exists to catch IP-lookup jumps and
        # clock-skew replays *within* a trust tier — it must never let a
        # lower-trust prior veto a higher-trust fix that legitimately
        # disagrees with it. Concretely: at cold start the IP source
        # (trust 30, ~50 km accuracy) resolves first and lands in history;
        # the accurate browser fix (trust 70) then arrives within the 5 s
        # window and, being the true position, sits >1.5 km from the IP
        # centroid. Without this branch the velocity check rejected the
        # browser fix as "implausible" and the map kept showing the coarse
        # IP centroid. A higher-trust source is authoritative — accept it
        # and re-baseline from it.
        if estimate.trust_level > last.trust_level:
            return True
        dt_s = (estimate.timestamp - last.timestamp).total_seconds()
        if dt_s <= 0:
            # Replay or clock skew with different coords — reject.
            return False
        if dt_s >= self.SANITY_WINDOW_S:
            return True
        dist_km = haversine_km(last.lat, last.lon, estimate.lat, estimate.lon)
        max_kmh = float(getattr(config, "agent_localization_sanity_max_speed_kmh", 1080.0) or 1080.0)
        implied_kmh = (dist_km / dt_s) * 3600.0
        return implied_kmh <= max_kmh

    # ── Introspection ────────────────────────────────────────────────────────

    def last_estimate(self) -> Optional[LocationEstimate]:
        return self._history[-1] if self._history else None

    def recent_history(self, n: int = 10) -> list[LocationEstimate]:
        return list(self._history)[-n:]


# ── Singleton wiring ────────────────────────────────────────────────────────

_resolver: Optional[LocalizationResolver] = None


def get_resolver() -> LocalizationResolver:
    """Return the module-level resolver, constructing an empty one on first call.

    Sources are added by :func:`agent.localization.wire_default_sources` at
    lifespan startup (or by tests wiring their own set).
    """
    global _resolver
    if _resolver is None:
        _resolver = LocalizationResolver()
    return _resolver


def set_resolver(resolver: Optional[LocalizationResolver]) -> None:
    global _resolver
    _resolver = resolver


__all__ = ["LocalizationResolver", "get_resolver", "set_resolver"]
