"""
PHANTOM OS — Phase 17a chat tool dispatcher.

Single entry-point that runs a chat data-tool (from
:mod:`ai.chat_tools.CHAT_DATA_TOOLS`) and returns a JSON-serialisable
result dict. Used by the future ``call_with_tools`` chat loop
(Phase 17b) and by tests today.

Design choices:

* **Handlers are async and self-contained.** Each handler clamps its
  own arguments and returns a structured result so the LLM can quote
  it back to the user verbatim without the chat path having to
  post-process per tool.
* **No raw exceptions reach the LLM.** Failures map to
  ``{"ok": False, "error": "<short>"}`` — preserves the resilience
  contract of :mod:`ai.tool_use_audit`.
* **No write operations in this commit.** ``create_calendar_event``,
  ``search_web``, and the calendar reader are deliberately deferred
  to Phase 17b: the first two carry security risk (F-11 prompt-
  injection exfil chain), the third needs the calendar service
  hooked into the agent runtime first.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config

logger = logging.getLogger(__name__)


# ── Public API ────────────────────────────────────────────────────────────────


_DispatchHandler = Callable[..., Awaitable[Any]]
_HANDLERS: dict[str, _DispatchHandler] = {}


def _register(name: str):
    def _wrap(fn: _DispatchHandler) -> _DispatchHandler:
        _HANDLERS[name] = fn
        return fn
    return _wrap


async def dispatch(
    name: str,
    args: dict[str, Any] | None = None,
    *,
    user_id: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """Run the named chat tool. Returns ``{ok, result|error, name, elapsed_ms}``.

    Never raises — failures are captured as ``ok=False``. The caller
    embeds the dict in the next LLM turn or surfaces it on a debug
    channel.
    """
    handler = _HANDLERS.get(name)
    started = time.monotonic()
    if handler is None:
        return _err(name, started, f"unknown_tool:{name}")
    try:
        result = await handler(args=args or {}, user_id=user_id, db=db)
        return {
            "ok": True,
            "name": name,
            "result": result,
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat_tool_dispatcher: %s failed: %s", name, exc)
        return _err(name, started, f"{type(exc).__name__}: {exc}"[:200])


def _err(name: str, started: float, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "name": name,
        "error": message,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }


def supported_tools() -> list[str]:
    """Names of tools this dispatcher knows. Phase 17b wiring uses this
    to filter the CHAT_DATA_TOOLS catalog passed to the LLM, so deferred
    tools aren't advertised before they're handled."""
    return sorted(_HANDLERS.keys())


# ── Argument helpers ──────────────────────────────────────────────────────────


def _clamp_int(args: dict[str, Any], key: str, default: int, lo: int, hi: int) -> int:
    raw = args.get(key, default)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, value))


def _trim_str(args: dict[str, Any], key: str, max_len: int = 200) -> str | None:
    raw = args.get(key)
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    return s[:max_len]


# ── Handlers ──────────────────────────────────────────────────────────────────


@_register("search_locationhistory")
async def _h_search_locationhistory(
    *, args: dict[str, Any], user_id: str, db: AsyncSession
) -> list[dict[str, Any]]:
    """Return distinct place visits in the last `hours_ago` window.

    Result rows: ``{place_name, city, country, first_seen, last_seen, count}``.
    Top-N (config.chat_tool_locationhistory_limit, default 20) ordered by
    most-recent-first-seen.
    """
    from db.models import LocationHistory
    from sqlalchemy import func

    hours = _clamp_int(args, "hours_ago", default=24, lo=1, hi=720)
    query_substr = _trim_str(args, "query")
    since = datetime.now(tz=timezone.utc) - timedelta(hours=hours)

    stmt = (
        select(
            LocationHistory.place_name,
            LocationHistory.city,
            LocationHistory.country,
            func.min(LocationHistory.timestamp).label("first_seen"),
            func.max(LocationHistory.timestamp).label("last_seen"),
            func.count(LocationHistory.id).label("count"),
        )
        .where(
            LocationHistory.user_id == user_id,
            LocationHistory.timestamp >= since,
            LocationHistory.place_name.isnot(None),
        )
        .group_by(LocationHistory.place_name, LocationHistory.city, LocationHistory.country)
        .order_by(desc("first_seen"))
        .limit(int(config.chat_tool_locationhistory_limit))
    )
    if query_substr:
        stmt = stmt.where(LocationHistory.place_name.ilike(f"%{query_substr}%"))

    result = await db.execute(stmt)
    return [
        {
            "place_name": row.place_name,
            "city": row.city,
            "country": row.country,
            "first_seen": row.first_seen.isoformat() if row.first_seen else None,
            "last_seen": row.last_seen.isoformat() if row.last_seen else None,
            "count": int(row.count or 0),
        }
        for row in result.all()
    ]


@_register("query_temporal_anchors")
async def _h_query_temporal_anchors(
    *, args: dict[str, Any], user_id: str, db: AsyncSession
) -> list[dict[str, Any]]:
    """Return temporal anchors filtered by state / mood substring / time
    window. Top-N (default 30) ordered most-recent-first."""
    from db.models import TemporalAnchor

    hours = _clamp_int(args, "hours_ago", default=168, lo=1, hi=720)
    state = _trim_str(args, "state")
    mood = _trim_str(args, "mood")
    since = datetime.now(tz=timezone.utc) - timedelta(hours=hours)

    stmt = (
        select(TemporalAnchor)
        .where(
            TemporalAnchor.user_id == user_id,
            TemporalAnchor.timestamp >= since,
        )
        .order_by(desc(TemporalAnchor.timestamp))
        .limit(int(config.chat_tool_anchors_limit))
    )
    if state:
        stmt = stmt.where(TemporalAnchor.state == state)
    if mood:
        stmt = stmt.where(TemporalAnchor.mood.ilike(f"%{mood}%"))

    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "state": r.state,
            "mood": r.mood,
            "place_name": r.place_name,
            "activity_summary": (r.activity_summary or "")[:500],
        }
        for r in rows
    ]


@_register("recall_memory_facts")
async def _h_recall_memory_facts(
    *, args: dict[str, Any], user_id: str, db: AsyncSession  # noqa: ARG001
) -> list[str]:
    """Semantic ChromaDB search of the user's strategic memory.
    Returns top-K relevant fact strings (where K = config.memory_top_k)."""
    from memory.strategic_memory import retrieve_relevant

    query = _trim_str(args, "query", max_len=500)
    if not query:
        return []
    return await retrieve_relevant(user_id=user_id, query=query)


@_register("get_system_metrics")
async def _h_get_system_metrics(
    *, args: dict[str, Any], user_id: str, db: AsyncSession  # noqa: ARG001
) -> dict[str, Any]:
    """Live Radxa metrics: CPU, RAM, disk, uptime, load average."""
    import psutil  # type: ignore[import-untyped]
    import os

    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    try:
        load = os.getloadavg()
    except (AttributeError, OSError):
        load = (0.0, 0.0, 0.0)
    boot = psutil.boot_time()
    return {
        "cpu_percent": float(psutil.cpu_percent(interval=0.05)),
        "ram_percent": float(vm.percent),
        "ram_available_mb": int(vm.available / (1024 * 1024)),
        "ram_total_mb": int(vm.total / (1024 * 1024)),
        "disk_percent": float(disk.percent),
        "disk_free_gb": round(disk.free / (1024**3), 1),
        "uptime_s": int(time.time() - boot),
        "load_avg_1m": round(load[0], 2),
        "load_avg_5m": round(load[1], 2),
        "load_avg_15m": round(load[2], 2),
    }


@_register("get_sensor_status")
async def _h_get_sensor_status(
    *, args: dict[str, Any], user_id: str, db: AsyncSession  # noqa: ARG001
) -> dict[str, Any]:
    """Snapshot of sensor state: radar/presence, env, GPS, system."""
    from core.context_engine import context_engine

    snap = context_engine.get_snapshot()
    presence = snap.get("presence", {}) or {}
    body = snap.get("body", {}) or {}
    where = snap.get("where", {}) or {}
    env = snap.get("env", {}) or {}
    sysinfo = snap.get("system", {}) or {}
    return {
        "presence": {
            "user_detected": bool(presence.get("user_detected")),
            "user_distance_cm": presence.get("user_distance_cm"),
            "other_detected": bool(presence.get("other_detected")),
            "other_distance_cm": presence.get("other_distance_cm"),
        },
        "body": {
            "breathing_bpm": body.get("breathing_bpm"),
            "breathing_state": body.get("breathing_state"),
            "stress_level": body.get("stress_level"),
        },
        "where": {
            "fix": bool(where.get("fix")),
            "lat": where.get("lat"),
            "lon": where.get("lon"),
            "source": where.get("source"),
            "place_name": where.get("place_name"),
        },
        "env": {
            "temp_c": env.get("temp_c"),
            "pressure_hpa": env.get("pressure_hpa"),
            "aqi": env.get("aqi"),
        },
        "system": {
            "state": sysinfo.get("state"),
            "ai_provider": sysinfo.get("ai_provider"),
            "stt_engine": sysinfo.get("stt_engine"),
        },
    }


__all__ = ["dispatch", "supported_tools"]
