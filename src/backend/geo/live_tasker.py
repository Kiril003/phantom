"""LiveTasker — Phase 24-F.

Background scheduler for the OmniMap's live layers. Each registered
task runs on its own asyncio loop with the manifest-driven
``poll_interval_s``; failures are caught + back-off-ed; every diff
in the result set is broadcast to the ``"map"`` WebSocket channel
and emitted on the in-process ``event_bus`` so existing voice /
sound / familiar handlers can react.

Phase 24-F ships the tasker + the alarms_ua tick. 24-G+ wire in
DeepStateMap (frontline) and Ukrenergo (blackouts) the same way.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Optional

logger = logging.getLogger(__name__)


# Default per-task back-off ceiling. We start at the manifest's
# poll_interval_s; on consecutive failures we multiply by 2 up to this
# cap so we don't hammer a downed upstream during an outage.
_BACKOFF_CAP_S = 600.0


@dataclass
class LiveTask:
    """One registered live task."""

    name: str
    interval_s: float
    fetch: Callable[[], Awaitable[list[Any]]]
    on_diff: Callable[[str, list[Any]], Awaitable[None]]
    error_count: int = 0
    last_run_at: float = 0.0
    # Момент останнього *вдалого* спостереження. `last_run_at` ставиться до
    # запиту й росте навіть коли джерело лежить — на ньому не можна будувати
    # вік факту, бо тоді бан по частоті виглядає як підтверджений спокій.
    last_ok_at: float = 0.0
    last_count: int = 0
    last_payload_repr: str = ""
    _task: Optional[asyncio.Task] = field(default=None, repr=False)


class LiveTasker:
    """Owns the loop that ticks every registered live task."""

    def __init__(self) -> None:
        self._tasks: dict[str, LiveTask] = {}
        self._stopped = asyncio.Event()
        self._stopped.set()  # not running until start()

    @property
    def names(self) -> list[str]:
        return list(self._tasks.keys())

    def register(
        self,
        name: str,
        *,
        interval_s: float,
        fetch: Callable[[], Awaitable[list[Any]]],
        on_diff: Callable[[str, list[Any]], Awaitable[None]],
    ) -> None:
        if interval_s <= 0:
            raise ValueError("interval_s must be > 0")
        self._tasks[name] = LiveTask(
            name=name, interval_s=interval_s, fetch=fetch, on_diff=on_diff,
        )

    async def start(self) -> None:
        """Spawn one asyncio task per registered live task."""
        if not self._tasks:
            return
        self._stopped = asyncio.Event()
        for task in self._tasks.values():
            task._task = asyncio.create_task(self._run(task), name=f"live:{task.name}")

    async def stop(self) -> None:
        self._stopped.set()
        for task in self._tasks.values():
            if task._task is None:
                continue
            task._task.cancel()
            try:
                await task._task
            except (asyncio.CancelledError, Exception):
                pass
            task._task = None

    async def tick_once(self, name: str) -> bool:
        """Run a single tick of the named task synchronously.

        Useful for tests + admin endpoints. Returns True if the result
        differed from the last seen state.
        """
        task = self._tasks[name]
        return await self._tick(task)

    async def _run(self, task: LiveTask) -> None:
        # First tick happens after a tiny stagger so multiple tasks
        # don't all hit upstream at the exact same monotonic instant.
        await asyncio.sleep(0.1)
        while not self._stopped.is_set():
            try:
                await self._tick(task)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # defensive — a bug in fetch shouldn't kill the task
                logger.exception("live task %s crashed: %s", task.name, exc)
                task.error_count += 1
            wait = self._backoff(task)
            try:
                await asyncio.wait_for(self._stopped.wait(), timeout=wait)
            except asyncio.TimeoutError:
                continue

    async def _tick(self, task: LiveTask) -> bool:
        task.last_run_at = time.time()
        try:
            payload = await task.fetch()
        except Exception as exc:
            task.error_count += 1
            logger.info("live task %s fetch failed: %s", task.name, exc)
            return False
        task.error_count = 0
        task.last_ok_at = time.time()
        # Тасковик віщає лише зміни, тож у мирний час шар мовчить годинами і
        # клієнт не може відрізнити «спокійно й підтверджено» від «не чули
        # нічого». Це — підтвердження без геометрії, раз на такт.
        await broadcast_observation(task.name, task.last_ok_at, len(payload))
        # Diff fingerprint — sorted repr keeps adapter-side ordering
        # changes from being treated as a real diff.
        signature = repr(sorted(repr(item) for item in payload))
        if signature == task.last_payload_repr:
            return False
        task.last_payload_repr = signature
        task.last_count = len(payload)
        try:
            await task.on_diff(task.name, payload)
        except Exception as exc:
            logger.warning("live task %s on_diff handler raised: %s", task.name, exc)
        return True

    def _backoff(self, task: LiveTask) -> float:
        if task.error_count == 0:
            return task.interval_s
        return min(_BACKOFF_CAP_S, task.interval_s * (2 ** min(task.error_count, 6)))

    def stats(self) -> list[dict[str, Any]]:
        return [
            {
                "name": t.name,
                "interval_s": t.interval_s,
                "error_count": t.error_count,
                "last_run_at": t.last_run_at,
                "last_ok_at": t.last_ok_at,
                "last_count": t.last_count,
                "running": t._task is not None and not t._task.done(),
            }
            for t in self._tasks.values()
        ]


# ── Default broadcaster + setup ──────────────────────────────────────────


async def broadcast_observation(layer_id: str, observed_at: float, count: int) -> None:
    """«Шар підтверджено о такій-то» — без геометрії, кожен вдалий такт.

    Мапа старіє стан від цього моменту: спокій живе дві хвилини, тривога —
    десять. Поки підтвердження приходять, спокій лишається спокоєм; щойно
    вони припинились — байдуже, мережа це, сон ноутбука чи бан по частоті —
    шар сам падає в «стан невідомий» і більше нічого не стверджує.
    """
    try:
        from agent.actions.map._common import MapMutation, broadcast_map_mutation

        await broadcast_map_mutation(
            MapMutation(
                op="layer_observed",
                target=layer_id,
                payload={
                    "layer_id": layer_id,
                    "observed_at": observed_at,
                    "count": count,
                },
            ),
        )
    except Exception as exc:
        logger.debug("live observation broadcast skipped: %s", exc)


async def default_on_diff(layer_id: str, payload: list[Any]) -> None:
    """Broadcast the new payload to the `"map"` WS channel + event_bus.

    Each item is expected to expose ``to_geojson_feature()``; if it
    doesn't (custom adapter), it's serialised via Pydantic / dict
    fallthrough.
    """
    features: list[dict[str, Any]] = []
    for item in payload:
        if hasattr(item, "to_geojson_feature"):
            features.append(item.to_geojson_feature())
        elif hasattr(item, "model_dump"):
            features.append(item.model_dump(mode="json"))
        elif isinstance(item, dict):
            features.append(item)
    fc = {"type": "FeatureCollection", "features": features}
    try:
        from agent.actions.map._common import MapMutation, broadcast_map_mutation

        await broadcast_map_mutation(
            MapMutation(
                op="alert",
                target=layer_id,
                payload={
                    "layer_id": layer_id,
                    "feature_collection": fc,
                    "count": len(features),
                },
            ),
            narrative=(
                f"{layer_id}: {len(features)} активних"
                if features else f"{layer_id}: тиша"
            ),
        )
    except Exception as exc:
        logger.debug("live broadcast skipped: %s", exc)
    try:
        from core.event_bus import event_bus

        await event_bus.emit_async(
            f"phantom.live.{layer_id}",
            {"layer_id": layer_id, "count": len(features), "features": features},
        )
    except Exception as exc:
        logger.debug("event_bus emit skipped: %s", exc)


# Process-wide singleton ----------------------------------------------------


_lock = asyncio.Lock()
_tasker: Optional[LiveTasker] = None


def get_live_tasker() -> LiveTasker:
    global _tasker
    if _tasker is None:
        _tasker = LiveTasker()
    return _tasker


async def setup_default_tasks(tasker: Optional[LiveTasker] = None) -> LiveTasker:
    """Register the standard set of live tasks. Idempotent."""
    tk = tasker or get_live_tasker()
    if "alarms_ua" in tk.names:
        return tk
    from .layer_registry import get_layer_registry
    from .sources.alarms_ua import get_default_alarms_ua

    registry = get_layer_registry()
    if not registry.has("air_raid_ua"):
        return tk
    manifest = registry.get("air_raid_ua")
    interval_s = float(manifest.source.poll_interval_s or 30)
    adapter = get_default_alarms_ua()

    async def fetch_alarms_ua() -> list[Any]:
        if not adapter.configured():
            return []
        return await adapter.fetch()

    tk.register(
        "alarms_ua",
        interval_s=interval_s,
        fetch=fetch_alarms_ua,
        on_diff=default_on_diff,
    )
    
    # Phase 24-L — Proximity alerts engine (every 5 seconds)
    async def fetch_proximity() -> list[Any]:
        # This is a bit different as it triggers side effects directly
        # but we can return the active geofences as the "payload"
        from .geofence_engine import GeofenceEngine
        from core.context_engine import context_engine
        from db.database import AsyncSessionLocal
        from db.models import Geofence
        from sqlalchemy import select

        ctx = context_engine.get_snapshot()
        if not ctx or not ctx.get("where") or ctx["where"].get("lat") is None:
            return []

        lat, lon = ctx["where"]["lat"], ctx["where"]["lon"]

        async with AsyncSessionLocal() as db:
            # For simplicity, we just check ALL active geofences
            # In production this would be spatial-indexed
            result = await db.execute(
                select(Geofence).where(Geofence.is_active == True)
            )
            gfs = result.scalars().all()
            
            triggered = []
            for gf in gfs:
                if GeofenceEngine.is_inside(lat, lon, gf):
                    triggered.append({"id": gf.id, "label": gf.label, "state": "inside"})
                else:
                    triggered.append({"id": gf.id, "label": gf.label, "state": "outside"})
            return triggered

    async def on_proximity_diff(name: str, payload: list[Any]) -> None:
        # payload here is the list of statuses.
        # LiveTasker's default on_diff broadcasts it.
        await default_on_diff(name, payload)

    tk.register(
        "proximity",
        interval_s=5.0,
        fetch=fetch_proximity,
        on_diff=on_proximity_diff,
    )

    # Layers whose `source.type` has no fetch adapter wired yet (e.g.
    # `api` — Shodan/OSINT lookups are agent-verb-driven, not polled)
    # must never be silently dropped into the live-task loop with a
    # fetch that would raise every tick (the D-1 ImportError-forever
    # failure mode). We simply don't register them, and log once at
    # setup so the gap is visible without spamming the tick loop.
    from .layer_manifest import LayerSourceType

    _UNIMPLEMENTED_FETCH_SOURCE_TYPES = (LayerSourceType.api,)
    for m in registry.all():
        if m.source.type in _UNIMPLEMENTED_FETCH_SOURCE_TYPES and m.id not in tk.names:
            logger.info(
                "fetch not implemented for source type %s (layer=%s) — "
                "not registering a live task",
                m.source.type.value,
                m.id,
            )

    return tk


async def reset_live_tasker_for_tests() -> LiveTasker:
    global _tasker
    if _tasker is not None:
        await _tasker.stop()
    _tasker = LiveTasker()
    return _tasker


def _live_tasker_lock() -> asyncio.Lock:
    return _lock
