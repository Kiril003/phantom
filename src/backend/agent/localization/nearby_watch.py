"""
Phase 9.4b — NEAR_REMEMBERED_PLACE trigger emitter.

Consulted from ContextEngine.resolve_localization (after an accepted
fix). When the current position is within
``config.agent_near_remembered_radius_m`` of any MemoryFact row, emit
a :class:`ProactiveTrigger` of kind ``NEAR_REMEMBERED_PLACE``. Dedup:
at most one trigger per hour (``agent_near_remembered_dedup_s``).

Cheap — the DB query is bounded by the tactical-layer radius and
results are cached; it runs at most once per 30 s per tick path.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from config import config

logger = logging.getLogger(__name__)


_last_trigger_at: Optional[datetime] = None
_last_memory_id: Optional[str] = None


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


async def check_and_emit(lat: float, lon: float) -> Optional[dict]:
    """Scan nearby memories and emit NEAR_REMEMBERED_PLACE if appropriate.

    Returns the payload dict for the emitted trigger (tests inspect it)
    or None when no trigger fired.
    """
    global _last_trigger_at, _last_memory_id
    dedup_s = int(getattr(config, "agent_near_remembered_dedup_s", 3600) or 3600)
    radius_m = float(getattr(config, "agent_near_remembered_radius_m", 200.0) or 200.0)
    now = _utcnow()
    if _last_trigger_at is not None and (now - _last_trigger_at).total_seconds() < dedup_s:
        return None

    user_id = await _pick_user_id()
    if user_id is None:
        return None

    from db.database import get_session
    from memory.geo_query import find_memories_near
    try:
        async with get_session() as db:
            hits = await find_memories_near(
                db, user_id=user_id, lat=lat, lon=lon,
                radius_km=radius_m / 1000.0, limit=1,
            )
    except Exception as exc:  # noqa: BLE001
        logger.debug("NEAR_REMEMBERED scan failed: %s", exc)
        return None

    if not hits:
        return None
    top = hits[0]
    if top["id"] == _last_memory_id:
        # Same memory as last time — don't spam the user.
        return None

    payload = {
        "memory_id": top["id"],
        "place_name": top.get("place_name"),
        "distance_m": top.get("distance_m"),
        "content": top["content"][:160],
    }
    try:
        from agent.cognition.proactive.loop import get_loop
        from agent.cognition.proactive.triggers import ProactiveTrigger, ProactiveTriggerKind
        loop = get_loop()
        if loop is not None:
            loop.push_trigger(ProactiveTrigger(
                kind=ProactiveTriggerKind.NEAR_REMEMBERED_PLACE,
                priority=5,
                context=payload,
            ))
    except Exception as exc:  # noqa: BLE001
        logger.debug("push NEAR_REMEMBERED_PLACE trigger failed: %s", exc)

    _last_trigger_at = now
    _last_memory_id = top["id"]
    return payload


async def _pick_user_id() -> Optional[str]:
    from db.database import get_session
    from db.models import User
    from sqlalchemy import select
    try:
        async with get_session() as db:
            result = await db.execute(select(User).order_by(User.created_at.asc()).limit(1))
            user = result.scalar_one_or_none()
            return user.id if user is not None else None
    except Exception:
        return None


def reset_state() -> None:
    """Tests: clear dedup memory."""
    global _last_trigger_at, _last_memory_id
    _last_trigger_at = None
    _last_memory_id = None


__all__ = ["check_and_emit", "reset_state"]
