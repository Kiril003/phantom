"""
Phase 9.4b — LocationHistory writer + reverse-geocode enricher.

Runs two background tasks, both opt-in via
``config.agent_location_history_enabled``:

  * Writer polls the resolver on the same cadence as the context tick
    (reuses the cached estimate — no extra network). Appends an entry
    when the user has moved > min_distance_m OR min_interval_s has
    elapsed since the last write. Auto-prunes rows older than
    retention_days.

  * Enricher runs less frequently (default hourly). Finds rows with
    ``place_name IS NULL`` and reverse-geocodes them via Nominatim.
    Hard cap per-cycle (100 rows) respects the 1 req/s policy and
    also avoids blocking shutdown.

All work is best-effort. On network / DB failure, the task logs and
continues on the next tick. No ``await`` ever raises to the caller.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from agent.localization import get_resolver
from agent.localization.base import LocationEstimate, haversine_km
from config import config

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


# ── Writer ──────────────────────────────────────────────────────────────────


class LocationHistoryWriter:
    """Appends to :class:`LocationHistory` on meaningful position changes.

    Needs a user id — single-user PHANTOM so we pass whichever ROOT user
    the lifespan resolves. If no user exists yet we skip writes silently
    until one is created.
    """

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self._last_written: Optional[LocationEstimate] = None
        self._last_written_at: Optional[datetime] = None
        self._prune_task_counter: int = 0

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="location_history_writer")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await self._task
        self._task = None

    async def _run(self) -> None:
        # Tick every 10 s — cheap (no network, cached estimate) and gives
        # us plenty of resolution without burning CPU.
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=10.0)
                break
            except asyncio.TimeoutError:
                pass
            if not getattr(config, "agent_location_history_enabled", True):
                continue
            try:
                await self._tick()
            except Exception as exc:  # noqa: BLE001
                logger.debug("location history writer tick raised: %s", exc)

    async def _tick(self) -> None:
        resolver = get_resolver()
        estimate = resolver.last_estimate()
        if estimate is None:
            return

        now = _utcnow()
        min_dist_m = float(getattr(config, "agent_location_history_min_distance_m", 50.0) or 50.0)
        min_interval_s = float(getattr(config, "agent_location_history_min_interval_s", 300) or 300)

        if self._last_written is not None and self._last_written_at is not None:
            elapsed = (now - self._last_written_at).total_seconds()
            dist_m = haversine_km(
                self._last_written.lat, self._last_written.lon,
                estimate.lat, estimate.lon,
            ) * 1000.0
            if elapsed < min_interval_s and dist_m < min_dist_m:
                return

        # Resolve the "owning" user before writing.
        user_id = await self._pick_user_id()
        if user_id is None:
            return

        from db.database import get_session
        try:
            async with get_session() as db:
                await self._write(db, user_id, estimate)
                # Occasionally prune expired rows (~ every 50 writes).
                self._prune_task_counter += 1
                if self._prune_task_counter % 50 == 0:
                    await self._prune(db, user_id)
        except Exception as exc:  # noqa: BLE001
            logger.info("location history write failed: %s", exc)
            return

        self._last_written = estimate
        self._last_written_at = now

    async def _write(self, db: AsyncSession, user_id: str, est: LocationEstimate) -> None:
        from db.models import LocationHistory
        import uuid
        row = LocationHistory(
            id=str(uuid.uuid4()),
            user_id=user_id,
            lat=float(est.lat),
            lon=float(est.lon),
            source=est.source,
            confidence=float(est.confidence),
            accuracy_m=est.accuracy_m,
            timestamp=_utcnow(),
        )
        db.add(row)
        await db.flush()

    async def _prune(self, db: AsyncSession, user_id: str) -> None:
        from db.models import LocationHistory
        retention_days = int(
            getattr(config, "agent_location_history_retention_days", 90) or 90
        )
        cutoff = _utcnow() - timedelta(days=retention_days)
        await db.execute(
            delete(LocationHistory).where(
                LocationHistory.user_id == user_id,
                LocationHistory.timestamp < cutoff,
            )
        )
        await db.flush()

    async def _pick_user_id(self) -> Optional[str]:
        from db.database import get_session
        from db.models import User
        try:
            async with get_session() as db:
                result = await db.execute(select(User).order_by(User.created_at.asc()).limit(1))
                user = result.scalar_one_or_none()
                return user.id if user is not None else None
        except Exception:
            return None


# ── Enricher ────────────────────────────────────────────────────────────────


class LocationHistoryEnricher:
    """Reverse-geocodes LocationHistory rows lazily.

    On each cycle: select up to ``batch_size`` rows with ``place_name IS
    NULL``, reverse-geocode via Nominatim, update the row. The 1 req/s
    rate limit is enforced by the adapter.
    """

    BATCH_SIZE = 100

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="location_history_enricher")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await self._task
        self._task = None

    async def _run(self) -> None:
        # Wait one minute before the first enrich cycle — gives the writer
        # time to queue up rows.
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=60.0)
            return
        except asyncio.TimeoutError:
            pass
        while not self._stop_event.is_set():
            interval = float(getattr(config, "agent_location_history_enricher_interval_s", 3600) or 3600)
            try:
                await self._cycle()
            except Exception as exc:  # noqa: BLE001
                logger.debug("enricher cycle raised: %s", exc)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
                break
            except asyncio.TimeoutError:
                continue

    async def _cycle(self) -> int:
        if not getattr(config, "agent_location_history_enabled", True):
            return 0
        if not getattr(config, "agent_nominatim_enabled", True):
            return 0
        from agent.localization.adapters.nominatim import get_default_nominatim
        from db.database import get_session
        from db.models import LocationHistory

        geocoder = get_default_nominatim()
        updated = 0

        async with get_session() as db:
            result = await db.execute(
                select(LocationHistory)
                .where(LocationHistory.place_name.is_(None))
                .order_by(LocationHistory.timestamp.desc())
                .limit(self.BATCH_SIZE)
            )
            rows = list(result.scalars().all())

        for row in rows:
            try:
                rev = await geocoder.reverse(row.lat, row.lon)
            except Exception as exc:  # noqa: BLE001
                logger.debug("reverse geocode failed for %s: %s", row.id, exc)
                continue
            if rev is None:
                continue
            try:
                async with get_session() as db2:
                    await db2.execute(
                        update(LocationHistory)
                        .where(LocationHistory.id == row.id)
                        .values(
                            place_name=rev.display_name[:512] if rev.display_name else None,
                            country=rev.country,
                            country_code=rev.country_code,
                            city=rev.city,
                        )
                    )
                updated += 1
            except Exception as exc:  # noqa: BLE001
                logger.debug("enricher DB update failed for %s: %s", row.id, exc)

        return updated


# ── Singletons ──────────────────────────────────────────────────────────────

_writer: Optional[LocationHistoryWriter] = None
_enricher: Optional[LocationHistoryEnricher] = None


def get_writer() -> LocationHistoryWriter:
    global _writer
    if _writer is None:
        _writer = LocationHistoryWriter()
    return _writer


def get_enricher() -> LocationHistoryEnricher:
    global _enricher
    if _enricher is None:
        _enricher = LocationHistoryEnricher()
    return _enricher


__all__ = [
    "LocationHistoryWriter",
    "LocationHistoryEnricher",
    "get_writer",
    "get_enricher",
]
