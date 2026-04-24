"""
PHANTOM OS — Phase 10 chat tool executor.

Dispatches data-fetching tool calls to typed handlers. Every handler
returns either a ``{"ok": True, ...}`` success dict or a
``{"error": str, "error_kind": str}`` failure dict — NEVER raises. Each
handler is wrapped in ``asyncio.wait_for(..., timeout=5s)`` so a slow
external service (e.g. Nominatim, Gemini grounding) can't drag the
whole chat turn past the tolerable ceiling.

The chat loop (gemini_provider.generate) picks up the result and
passes it back to Gemini as a tool-response Part. The LLM then has
real data in context and emits a response_form.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, select

from config import config
from db import database as _db
from db.models import CalendarEvent, LocationHistory, MemoryFact, TemporalAnchor


def _session_factory():
    """Resolve the current AsyncSessionLocal — dynamic so tests can swap it."""
    return _db.AsyncSessionLocal

logger = logging.getLogger(__name__)


TOOL_TIMEOUT_S: float = 10.0
MAX_TOOL_CALLS_PER_TURN: int = 3

# Why 10s, not 5s: chat routes hold an open AsyncSession for the whole turn
# (user write → LLM loop → assistant write), so a tool handler that opens a
# second SQLite session can wait on BUSY for a few seconds while the first
# session settles. 5s was not enough during live tests. With the 3-call
# cap, worst case is ~30s of tool wall-clock.


# ── Error helpers ─────────────────────────────────────────────────────────────


def _err(kind: str, message: str) -> dict[str, Any]:
    return {"error": message, "error_kind": kind}


def _ok(**kwargs: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": True}
    out.update(kwargs)
    return out


# ── Individual tool handlers ─────────────────────────────────────────────────


async def _tool_search_locationhistory(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    hours_ago = args.get("hours_ago")
    if hours_ago is None:
        hours_ago = 24
    try:
        hours_ago = max(1, min(720, int(hours_ago)))
    except (TypeError, ValueError):
        return _err("invalid_args", "hours_ago must be an integer 1..720")
    query_sub = args.get("query")
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours_ago)

    async with _session_factory()() as db:
        conditions = [
            LocationHistory.user_id == user_id,
            LocationHistory.timestamp >= cutoff,
        ]
        if isinstance(query_sub, str) and query_sub.strip():
            conditions.append(LocationHistory.place_name.ilike(f"%{query_sub.strip()}%"))
        stmt = (
            select(LocationHistory)
            .where(and_(*conditions))
            .order_by(LocationHistory.timestamp.desc())
            .limit(10)
        )
        rows = (await db.execute(stmt)).scalars().all()

    results = [
        {
            "place_name": r.place_name or "(unnamed)",
            "lat": r.lat,
            "lon": r.lon,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "source": r.source,
            "confidence": r.confidence,
        }
        for r in rows
    ]
    return _ok(results=results, count=len(results))


async def _tool_query_temporal_anchors(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    state = args.get("state")
    mood_sub = args.get("mood")
    hours_ago = args.get("hours_ago", 168)
    try:
        hours_ago = max(1, min(720, int(hours_ago)))
    except (TypeError, ValueError):
        return _err("invalid_args", "hours_ago must be an integer 1..720")

    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours_ago)

    async with _session_factory()() as db:
        conditions = [
            TemporalAnchor.user_id == user_id,
            TemporalAnchor.timestamp >= cutoff,
        ]
        if isinstance(state, str) and state.strip():
            conditions.append(TemporalAnchor.state == state.strip())
        if isinstance(mood_sub, str) and mood_sub.strip():
            conditions.append(TemporalAnchor.mood.ilike(f"%{mood_sub.strip()}%"))

        stmt = (
            select(TemporalAnchor)
            .where(and_(*conditions))
            .order_by(TemporalAnchor.timestamp.desc())
            .limit(10)
        )
        rows = (await db.execute(stmt)).scalars().all()

    results = [
        {
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "activity_summary": r.activity_summary,
            "state": r.state,
            "mood": r.mood,
            "place_name": r.place_name,
            "lat": r.lat,
            "lon": r.lon,
        }
        for r in rows
    ]
    return _ok(results=results, count=len(results))


async def _tool_recall_memory_facts(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    query = args.get("query")
    if not isinstance(query, str) or not query.strip():
        return _err("invalid_args", "query is required and must be non-empty")
    layer = args.get("layer")

    # Layer 'strategic' = ChromaDB vector search. 'tactical'/'archive' = SQL layer.
    # When no layer is passed, fan out to strategic (the best for 'what do you know about X'),
    # and fall through to tactical-SQL if strategic yields nothing.
    results: list[dict[str, Any]] = []

    want_strategic = layer is None or layer == "strategic"
    want_sql_layer = layer in (None, "tactical", "archive")

    if want_strategic:
        try:
            from memory.strategic_memory import retrieve_relevant

            hits = await retrieve_relevant(user_id=user_id, query=query, top_k=5)
            for h in hits:
                results.append({"content": h, "layer": "strategic", "source": "chroma"})
        except Exception as exc:
            logger.debug("chroma retrieve failed: %s", exc)

    if want_sql_layer and len(results) < 5:
        async with _session_factory()() as db:
            conditions = [MemoryFact.user_id == user_id, MemoryFact.is_sealed.is_(False)]
            if layer in ("tactical", "archive"):
                conditions.append(MemoryFact.layer == layer)
            stmt = (
                select(MemoryFact)
                .where(and_(*conditions))
                .order_by(MemoryFact.importance.desc(), MemoryFact.created_at.desc())
                .limit(5 - len(results))
            )
            rows = (await db.execute(stmt)).scalars().all()
            for r in rows:
                results.append(
                    {
                        "content": r.content,
                        "layer": r.layer,
                        "category": r.category,
                        "importance": r.importance,
                        "created_at": r.created_at.isoformat() if r.created_at else None,
                        "place_name": r.place_name,
                    }
                )

    return _ok(results=results[:5], count=len(results[:5]))


async def _tool_get_system_metrics(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    try:
        import psutil

        cpu_pct = psutil.cpu_percent(interval=None)
        vm = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        boot_ts = psutil.boot_time()
        uptime_sec = max(0, int(time.time() - boot_ts))
        try:
            load_1, load_5, load_15 = psutil.getloadavg()
        except (AttributeError, OSError):
            load_1 = load_5 = load_15 = 0.0
    except Exception as exc:
        return _err("network", f"psutil failure: {exc}")

    return _ok(
        cpu_pct=round(cpu_pct, 1),
        ram_used_mb=int(vm.used / (1024 * 1024)),
        ram_total_mb=int(vm.total / (1024 * 1024)),
        ram_pct=round(vm.percent, 1),
        disk_used_gb=round(disk.used / (1024 ** 3), 2),
        disk_total_gb=round(disk.total / (1024 ** 3), 2),
        disk_pct=round(disk.percent, 1),
        uptime_sec=uptime_sec,
        load_1min=round(load_1, 2),
        load_5min=round(load_5, 2),
        load_15min=round(load_15, 2),
    )


async def _tool_get_sensor_status(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    try:
        from core.context_engine import context_engine

        snap = context_engine.get_snapshot()
    except Exception as exc:
        return _err("network", f"context_engine unavailable: {exc}")

    body = snap.get("body", {}) or {}
    presence = snap.get("presence", {}) or {}
    env = snap.get("env", {}) or {}
    where = snap.get("where", {}) or {}
    who = snap.get("who", {}) or {}

    faces_count = 0
    if presence.get("user_detected"):
        faces_count += 1
    if presence.get("other_detected"):
        faces_count += 1

    return _ok(
        radar={
            "presence": bool(presence.get("user_detected") or presence.get("other_detected")),
            "breathing_bpm": body.get("breathing_bpm"),
            "breathing_state": body.get("breathing_state"),
            "user_distance_cm": body.get("user_distance_cm") or presence.get("user_distance_cm"),
            "other_distance_cm": presence.get("other_distance_cm"),
        },
        camera={
            "face_tracked": bool(who.get("user_id")),
            "faces_count": faces_count,
        },
        environment={
            "temp_c": env.get("temp_c"),
            "pressure_hpa": env.get("pressure_hpa"),
            "aqi": env.get("aqi"),
        },
        gps={
            "lat": where.get("lat"),
            "lon": where.get("lon"),
            "accuracy_m": where.get("accuracy_m"),
            "fix": bool(where.get("fix")),
            "place_name": where.get("place_name"),
        },
        battery={
            "pct": None,
            "charging": None,
        },
    )


async def _tool_search_web(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    query = args.get("query")
    if not isinstance(query, str) or not query.strip():
        return _err("invalid_args", "query is required")

    # Only Gemini provides grounded Google search. If primary isn't gemini
    # or the key is missing, degrade gracefully.
    if config.ai_primary_provider != "gemini" or not config.ai_gemini_api_key:
        return _err("unavailable", "web search unavailable via local model")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=config.ai_gemini_api_key)
        response = await client.aio.models.generate_content(
            model=config.ai_gemini_model,
            contents=[{"role": "user", "parts": [{"text": query.strip()}]}],
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                max_output_tokens=800,
            ),
        )
    except Exception as exc:
        return _err("network", f"gemini grounding failed: {exc}")

    summary = (getattr(response, "text", None) or "").strip()
    sources: list[dict[str, str]] = []
    try:
        candidate = response.candidates[0] if getattr(response, "candidates", None) else None
        gm = getattr(candidate, "grounding_metadata", None) if candidate else None
        chunks = getattr(gm, "grounding_chunks", None) if gm else None
        if chunks:
            for ch in chunks[:5]:
                web = getattr(ch, "web", None)
                if web is None:
                    continue
                sources.append(
                    {
                        "title": getattr(web, "title", "") or "",
                        "url": getattr(web, "uri", "") or "",
                        "snippet": "",
                    }
                )
    except Exception as exc:
        logger.debug("grounding metadata extraction failed: %s", exc)

    if not summary and not sources:
        return _err("network", "grounded search returned empty result")

    return _ok(summary=summary, sources=sources)


# ── Date parsing for calendar tools ───────────────────────────────────────────


def _today_utc() -> date:
    return datetime.now(tz=timezone.utc).date()


def _parse_date_range(expr: str) -> tuple[datetime, datetime] | None:
    """Resolve a textual date range to (start_utc, end_utc). None on failure."""
    if not isinstance(expr, str) or not expr.strip():
        return None
    e = expr.strip().lower()
    today = _today_utc()

    def day_bounds(d: date) -> tuple[datetime, datetime]:
        start = datetime.combine(d, dtime.min).replace(tzinfo=timezone.utc)
        end = datetime.combine(d, dtime.max).replace(tzinfo=timezone.utc)
        return start, end

    if e == "today":
        return day_bounds(today)
    if e == "tomorrow":
        return day_bounds(today + timedelta(days=1))
    if e == "yesterday":
        return day_bounds(today - timedelta(days=1))
    if e == "this_week":
        start_d = today - timedelta(days=today.weekday())
        end_d = start_d + timedelta(days=6)
        return (
            datetime.combine(start_d, dtime.min).replace(tzinfo=timezone.utc),
            datetime.combine(end_d, dtime.max).replace(tzinfo=timezone.utc),
        )
    if e == "next_week":
        start_d = today - timedelta(days=today.weekday()) + timedelta(days=7)
        end_d = start_d + timedelta(days=6)
        return (
            datetime.combine(start_d, dtime.min).replace(tzinfo=timezone.utc),
            datetime.combine(end_d, dtime.max).replace(tzinfo=timezone.utc),
        )

    # YYYY-MM-DD..YYYY-MM-DD range
    m = re.match(r"^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$", e)
    if m:
        try:
            d0 = date.fromisoformat(m.group(1))
            d1 = date.fromisoformat(m.group(2))
        except ValueError:
            return None
        return (
            datetime.combine(d0, dtime.min).replace(tzinfo=timezone.utc),
            datetime.combine(d1, dtime.max).replace(tzinfo=timezone.utc),
        )

    # Single YYYY-MM-DD
    m = re.match(r"^\d{4}-\d{2}-\d{2}$", e)
    if m:
        try:
            d = date.fromisoformat(e)
        except ValueError:
            return None
        return day_bounds(d)

    return None


_HOUR_RE = re.compile(r"(?:о|об|at)?\s*(\d{1,2})(?::(\d{2}))?")


def _parse_datetime_freeform(expr: str) -> datetime | None:
    """Resolve a single datetime from ISO 8601 or a small UA/EN natural form."""
    if not isinstance(expr, str) or not expr.strip():
        return None
    s = expr.strip()

    # Try ISO 8601 first (full timestamp or YYYY-MM-DD[ T]HH:MM).
    for candidate in (s, s.replace(" ", "T")):
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            pass

    lower = s.lower()
    today = _today_utc()
    base: date | None = None
    if "завтра" in lower or "tomorrow" in lower:
        base = today + timedelta(days=1)
    elif "сьогодні" in lower or "today" in lower:
        base = today
    elif "післязавтра" in lower:
        base = today + timedelta(days=2)

    if base is None:
        # Last-resort — YYYY-MM-DD without time (default 09:00).
        m = re.search(r"(\d{4}-\d{2}-\d{2})", lower)
        if m:
            try:
                d = date.fromisoformat(m.group(1))
            except ValueError:
                return None
            return datetime.combine(d, dtime(9, 0)).replace(tzinfo=timezone.utc)
        return None

    m = _HOUR_RE.search(lower)
    hour = 9
    minute = 0
    if m:
        try:
            hour = max(0, min(23, int(m.group(1))))
            minute = max(0, min(59, int(m.group(2)))) if m.group(2) else 0
        except ValueError:
            return None
    return datetime.combine(base, dtime(hour, minute)).replace(tzinfo=timezone.utc)


async def _tool_get_calendar_events(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    expr = args.get("date_range", "today")
    window = _parse_date_range(expr)
    if window is None:
        return _err("invalid_args", f"could not parse date_range={expr!r}")
    start_utc, end_utc = window

    async with _session_factory()() as db:
        stmt = (
            select(CalendarEvent)
            .where(
                CalendarEvent.user_id == user_id,
                CalendarEvent.start_at >= start_utc,
                CalendarEvent.start_at <= end_utc,
            )
            .order_by(CalendarEvent.start_at.asc())
            .limit(20)
        )
        rows = (await db.execute(stmt)).scalars().all()

    events = [
        {
            "id": r.id,
            "title": r.title,
            "start_at": r.start_at.isoformat() if r.start_at else None,
            "end_at": r.end_at.isoformat() if r.end_at else None,
            "notes": r.description or "",
            "location": r.location,
        }
        for r in rows
    ]
    return _ok(
        range={"start": start_utc.isoformat(), "end": end_utc.isoformat()},
        events=events,
        count=len(events),
    )


async def _tool_create_calendar_event(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    title = args.get("title")
    start_expr = args.get("start_at")
    end_expr = args.get("end_at")
    notes = args.get("notes") or ""

    if not isinstance(title, str) or not title.strip():
        return _err("invalid_args", "title is required")
    if not isinstance(start_expr, str) or not start_expr.strip():
        return _err("invalid_args", "start_at is required")

    start_dt = _parse_datetime_freeform(start_expr)
    if start_dt is None:
        return _err("invalid_args", f"could not parse start_at={start_expr!r}")

    end_dt: datetime | None = None
    if isinstance(end_expr, str) and end_expr.strip():
        end_dt = _parse_datetime_freeform(end_expr)
        if end_dt is None:
            return _err("invalid_args", f"could not parse end_at={end_expr!r}")
    if end_dt is None:
        end_dt = start_dt + timedelta(hours=1)

    if end_dt < start_dt:
        return _err("invalid_args", "end_at must be >= start_at")

    async with _session_factory()() as db:
        event = CalendarEvent(
            user_id=user_id,
            title=title.strip(),
            description=notes,
            start_at=start_dt,
            end_at=end_dt,
            all_day=False,
        )
        db.add(event)
        await db.commit()
        await db.refresh(event)

    return _ok(
        id=event.id,
        title=event.title,
        start_at=event.start_at.isoformat(),
        end_at=event.end_at.isoformat(),
        status="created",
    )


# ── Dispatcher ────────────────────────────────────────────────────────────────


_HANDLERS: dict[str, Any] = {
    "search_locationhistory": _tool_search_locationhistory,
    "query_temporal_anchors": _tool_query_temporal_anchors,
    "recall_memory_facts": _tool_recall_memory_facts,
    "get_system_metrics": _tool_get_system_metrics,
    "get_sensor_status": _tool_get_sensor_status,
    "search_web": _tool_search_web,
    "get_calendar_events": _tool_get_calendar_events,
    "create_calendar_event": _tool_create_calendar_event,
}


async def execute_tool(
    tool_name: str,
    args: dict[str, Any] | None,
    user_id: str,
    *,
    timeout_s: float = TOOL_TIMEOUT_S,
) -> dict[str, Any]:
    """
    Dispatch a tool call. NEVER raises — always returns a result dict.

    On success: ``{"ok": True, ...}``.
    On failure: ``{"error": "...", "error_kind": "..."}``.
    """
    handler = _HANDLERS.get(tool_name)
    if handler is None:
        return _err("unknown_tool", f"no handler for tool '{tool_name}'")

    safe_args = dict(args) if isinstance(args, dict) else {}
    t0 = time.monotonic()
    try:
        result = await asyncio.wait_for(handler(safe_args, user_id), timeout=timeout_s)
    except asyncio.TimeoutError:
        logger.warning("tool_executor: %s timed out after %.1fs", tool_name, timeout_s)
        return _err("timeout", f"tool '{tool_name}' exceeded {timeout_s:.1f}s")
    except Exception as exc:
        logger.exception("tool_executor: %s raised", tool_name)
        return _err("exception", f"{type(exc).__name__}: {exc}")

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    if isinstance(result, dict):
        result.setdefault("_elapsed_ms", elapsed_ms)
        logger.info(
            "tool_executor: %s %s in %dms",
            tool_name,
            "ok" if result.get("ok") else f"error={result.get('error_kind')}",
            elapsed_ms,
        )
        return result
    return _err("exception", f"tool '{tool_name}' returned non-dict: {type(result).__name__}")


__all__ = [
    "execute_tool",
    "TOOL_TIMEOUT_S",
    "MAX_TOOL_CALLS_PER_TURN",
]
