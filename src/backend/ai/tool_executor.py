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
from db.models import CalendarEvent, LocationHistory, TemporalAnchor


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

# Day-5 fix — per-tool overrides for network IO. The default 10s is fine
# for in-process tools (DB lookups, memory queries) but external HTTP
# (search, fetch) routinely needs 12-20s on first connect (DNS + TLS
# handshake + Google response). The inner web action keeps its own
# 15s httpx timeout; we just keep the outer guard wider than the inner
# so a network-slow path returns "search exceeded N seconds" with
# context instead of a generic "tool timeout".
PER_TOOL_TIMEOUT_S: dict[str, float] = {
    "web_search": 25.0,
    "web_fetch":  20.0,
    # Voice/STT path occasionally re-warms a faster-whisper instance
    # off the request thread; give it room before the outer guard cuts.
    "transcribe": 25.0,
}


# ── Error helpers ─────────────────────────────────────────────────────────────


def _err(kind: str, message: str) -> dict[str, Any]:
    return {"error": message, "error_kind": kind}


def _ok(**kwargs: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": True}
    out.update(kwargs)
    return out


# ── Argument validation (Day-2 D2-T1 + D2-S2) ────────────────────────────────
#
# These helpers harden the LLM-controlled args before they hit SQL. The
# Day-2 audit threat-modelled three concrete bypasses against the
# previous chat_tool_dispatcher implementation; H-5 collapsed that
# implementation onto tool_executor, so this is now the single place to
# patch all consumers.


def _safe_int(value: Any, *, lo: int, hi: int, default: int) -> int | None:
    """Parse an LLM-supplied integer.

    Day-2 D2-T1: ``int(True) → 1`` / ``int(False) → 0`` — Python's
    bool-to-int coercion silently passes a category mistake. Reject
    bools explicitly so an LLM that hallucinates ``"hours_ago": true``
    doesn't quietly become "1 hour" without anyone noticing.

    Returns ``None`` on rejection so callers can short-circuit with
    invalid_args; clamps to ``[lo, hi]`` on success. ``default`` is
    used when value is ``None`` (LLM omitted the arg).
    """
    if value is None:
        return max(lo, min(hi, default))
    if isinstance(value, bool):
        return None
    try:
        v = int(value)
    except (TypeError, ValueError):
        return None
    return max(lo, min(hi, v))


# Unicode RTL-override / zero-width / bidi-mark codepoints. An LLM that
# echoes user input back into a tool arg can be tricked into hiding
# wildcards inside an RTL-override block (`‮ ... ‬`) or a
# zero-width-space sandwich. Reject any of these so the SQL layer gets
# a flat ASCII-or-printable string.
_UNICODE_DANGER = "".join(
    chr(cp)
    for cp in (
        # Day-3 D3-C-6 (audit-2026-04-30 NEW-SEC-07) extends the Day-2
        # set with NUL, tab, soft hyphen, line / paragraph separators,
        # and the Mongolian zero-width vowel separator. The N-sec
        # walker found these slipping through `_safe_query_str` and
        # landing in the SQL ILIKE clause; the bytestream reaches
        # SQLite's bound-parameter layer fine but the LLM-side log /
        # audit row can be visually corrupted by them. Normalise input
        # to NFC at the entry point so attackers can't construct
        # decomposed-form spoofs of allowed characters.
        0x0000,  # NUL — SQLite bound params handle it but log lines truncate
        0x0009,  # HORIZONTAL TAB — visual layout corruption in logs
        0x00AD,  # SOFT HYPHEN — invisible inside Cyrillic substrings
        0x180E,  # MONGOLIAN VOWEL SEPARATOR — zero-width, missed Day-2
        0x2028,  # LINE SEPARATOR — splits log lines mid-row
        0x2029,  # PARAGRAPH SEPARATOR — same as LINE SEPARATOR
        0x200B,  # ZERO WIDTH SPACE
        0x200C,  # ZERO WIDTH NON-JOINER
        0x200D,  # ZERO WIDTH JOINER
        0x200E,  # LEFT-TO-RIGHT MARK
        0x200F,  # RIGHT-TO-LEFT MARK
        0x202A,  # LEFT-TO-RIGHT EMBEDDING
        0x202B,  # RIGHT-TO-LEFT EMBEDDING
        0x202C,  # POP DIRECTIONAL FORMATTING
        0x202D,  # LEFT-TO-RIGHT OVERRIDE
        0x202E,  # RIGHT-TO-LEFT OVERRIDE
        0x2066,  # LEFT-TO-RIGHT ISOLATE
        0x2067,  # RIGHT-TO-LEFT ISOLATE
        0x2068,  # FIRST STRONG ISOLATE
        0x2069,  # POP DIRECTIONAL ISOLATE
        0xFEFF,  # ZERO WIDTH NO-BREAK SPACE / BOM
    )
)
_UNICODE_DANGER_SET = frozenset(_UNICODE_DANGER)


def _safe_query_str(value: Any, *, max_len: int = 200) -> tuple[str | None, str | None]:
    """Validate + normalise an LLM-supplied substring used in an SQL
    ``ILIKE`` clause.

    Returns ``(cleaned, error_kind)`` — exactly one of the two is None.

    Rejections (Day-2 D2-S2):

    * non-string arg → ``invalid_args`` (LLM asked the wrong type)
    * empty after strip → ``(None, None)`` (treat as "no filter")
    * any RTL/zero-width codepoint → ``invalid_args``
    * length > max_len after strip → ``invalid_args``

    Escapes ``%`` and ``_`` and ``\\`` so the LLM cannot widen its own
    filter to a full-table scan or evade a substring constraint with a
    wildcard. The caller passes the result through SQLAlchemy with a
    matching ``escape="\\\\"`` argument on ``ilike``.
    """
    if value is None:
        return None, None
    if not isinstance(value, str):
        return None, "invalid_args"
    # Day-3 D3-C-6: normalise to NFC before character-class checks so
    # an attacker can't bypass the Cyrillic-homoglyph or RTL filter by
    # supplying a decomposed form (LATIN A + COMBINING) that visually
    # matches an allowed glyph but bypasses the codepoint blocklist.
    import unicodedata as _ud
    s = _ud.normalize("NFC", value).strip()
    if not s:
        return None, None
    if len(s) > max_len:
        return None, "invalid_args"
    if any(ch in _UNICODE_DANGER_SET for ch in s):
        return None, "invalid_args"
    # Escape ILIKE wildcards. Order matters: backslash first so we don't
    # double-escape the substitutions we add. Caller MUST pass
    # ``escape="\\"`` to ilike() so the backslashes are interpreted as
    # escapes rather than literal characters.
    cleaned = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return cleaned, None


# ── Individual tool handlers ─────────────────────────────────────────────────


async def _tool_search_locationhistory(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    hours_ago = _safe_int(args.get("hours_ago"), lo=1, hi=720, default=24)
    if hours_ago is None:
        return _err("invalid_args", "hours_ago must be an integer 1..720")
    query_sub_clean, qerr = _safe_query_str(args.get("query"))
    if qerr:
        return _err(qerr, "query has invalid characters or shape")
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours_ago)

    async with _session_factory()() as db:
        conditions = [
            LocationHistory.user_id == user_id,
            LocationHistory.timestamp >= cutoff,
        ]
        if query_sub_clean:
            conditions.append(
                LocationHistory.place_name.ilike(
                    f"%{query_sub_clean}%", escape="\\"
                )
            )
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
    hours_ago = _safe_int(args.get("hours_ago"), lo=1, hi=720, default=168)
    if hours_ago is None:
        return _err("invalid_args", "hours_ago must be an integer 1..720")

    state = args.get("state")
    if state is not None and not isinstance(state, str):
        return _err("invalid_args", "state must be a string")
    state_norm = state.strip() if isinstance(state, str) and state.strip() else None
    if state_norm is not None and any(ch in _UNICODE_DANGER_SET for ch in state_norm):
        return _err("invalid_args", "state has invalid characters")

    mood_clean, merr = _safe_query_str(args.get("mood"))
    if merr:
        return _err(merr, "mood has invalid characters or shape")

    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours_ago)

    async with _session_factory()() as db:
        conditions = [
            TemporalAnchor.user_id == user_id,
            TemporalAnchor.timestamp >= cutoff,
        ]
        if state_norm:
            conditions.append(TemporalAnchor.state == state_norm)
        if mood_clean:
            conditions.append(
                TemporalAnchor.mood.ilike(f"%{mood_clean}%", escape="\\")
            )

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
    # Day-2 D2-S2: same Unicode/length floor as the ILIKE-bound tools.
    # ChromaDB's vector index doesn't care about wildcards but the audit-
    # log row stores the raw query, so RTL-override hides exfil intent
    # from any later operator review.
    if any(ch in _UNICODE_DANGER_SET for ch in query):
        return _err("invalid_args", "query has invalid characters")
    if len(query) > 500:
        return _err("invalid_args", "query exceeds 500 chars")
    layer = args.get("layer")
    if layer is not None and layer not in ("strategic", "tactical", "archive", "geo", "episode"):
        return _err("invalid_args", "layer must be strategic, tactical, archive, geo, or episode")

    try:
        from memory.brain import memory_brain

        async with _session_factory()() as db:
            hits = await memory_brain.recall(
                db=db,
                user_id=user_id,
                query=query,
                limit=5,
                include_agent=layer in (None, "episode"),
            )
    except Exception as exc:
        logger.debug("memory brain recall failed: %s", exc)
        hits = []

    results: list[dict[str, Any]] = []
    for hit in hits:
        if layer is not None and hit.layer != layer:
            continue
        item: dict[str, Any] = {
            "content": hit.content,
            "layer": hit.layer,
            "source": hit.source,
        }
        if hit.category:
            item["category"] = hit.category
        if hit.importance:
            item["importance"] = hit.importance
        if hit.created_at:
            item["created_at"] = hit.created_at
        item.update({k: v for k, v in hit.metadata.items() if v is not None})
        results.append(item)
        if len(results) >= 5:
            break

    return _ok(results=results, count=len(results))


async def _tool_get_system_metrics(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    try:
        import psutil

        # Day-2 D2-D-cpu (audit-2026-04-29): read the 1 Hz background
        # sample instead of paying the cpu_percent(interval=...) cost
        # on the chat hot path. With 4 call_with_tools iterations per
        # turn the dispatcher would otherwise have stacked enough cpu
        # reads to drift the chat-turn budget by hundreds of ms even
        # though interval=None is technically non-blocking.
        from system_metrics_sampler import get_cpu_percent
        cpu_pct = float(get_cpu_percent())
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

    grounded = bool(sources)
    logger.info(
        "search_web: query=%r grounded=%s sources=%d summary_len=%d",
        query.strip()[:80], grounded, len(sources), len(summary),
    )
    return _ok(summary=summary, sources=sources, grounded=grounded)


# ── Date parsing for calendar tools ───────────────────────────────────────────
#
# Phase 10.3 — natural-language date keywords ("today", "tomorrow", "завтра",
# бла бла) and bare ISO dates are interpreted in the USER's local timezone, not
# UTC. The Radxa device is colocated with the user, so the system's local tz
# is a correct proxy. Storage and query comparison still use UTC — we convert
# at the boundary so SQLite's naive DATETIME columns stay consistent.


def _local_tz():
    """System's current local timezone (UTC offset is resolved at call time so
    DST transitions don't stick on an old offset)."""
    return datetime.now().astimezone().tzinfo


def _today_local() -> date:
    """User's local 'today' date."""
    return datetime.now().astimezone().date()


def _local_to_utc(dt: datetime) -> datetime:
    """Convert a tz-aware datetime to UTC. Naive input is treated as local."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_local_tz())
    return dt.astimezone(timezone.utc)


def _parse_date_range(expr: str) -> tuple[datetime, datetime] | None:
    """Resolve a textual date range to (start_utc, end_utc). None on failure.

    Keywords like "today"/"tomorrow"/"this_week"/"next_week" and bare
    YYYY-MM-DD dates are interpreted in the user's LOCAL timezone, then
    converted to UTC for DB comparison.
    """
    if not isinstance(expr, str) or not expr.strip():
        return None
    e = expr.strip().lower()
    today = _today_local()
    tz = _local_tz()

    def day_bounds(d: date) -> tuple[datetime, datetime]:
        start_local = datetime.combine(d, dtime.min).replace(tzinfo=tz)
        end_local = datetime.combine(d, dtime.max).replace(tzinfo=tz)
        return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)

    def range_bounds(d0: date, d1: date) -> tuple[datetime, datetime]:
        start_local = datetime.combine(d0, dtime.min).replace(tzinfo=tz)
        end_local = datetime.combine(d1, dtime.max).replace(tzinfo=tz)
        return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)

    if e == "today":
        return day_bounds(today)
    if e == "tomorrow":
        return day_bounds(today + timedelta(days=1))
    if e == "yesterday":
        return day_bounds(today - timedelta(days=1))
    if e == "this_week":
        start_d = today - timedelta(days=today.weekday())
        end_d = start_d + timedelta(days=6)
        return range_bounds(start_d, end_d)
    if e == "next_week":
        start_d = today - timedelta(days=today.weekday()) + timedelta(days=7)
        end_d = start_d + timedelta(days=6)
        return range_bounds(start_d, end_d)

    # YYYY-MM-DD..YYYY-MM-DD range
    m = re.match(r"^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$", e)
    if m:
        try:
            d0 = date.fromisoformat(m.group(1))
            d1 = date.fromisoformat(m.group(2))
        except ValueError:
            return None
        return range_bounds(d0, d1)

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
    """Resolve a single datetime from ISO 8601 or a small UA/EN natural form.

    Returns a tz-aware UTC datetime. ISO 8601 input without a tz offset and
    natural-language forms ("завтра 14:00", "tomorrow at 9") are interpreted
    as the user's LOCAL wall-clock time before being normalised to UTC.
    """
    if not isinstance(expr, str) or not expr.strip():
        return None
    s = expr.strip()
    tz = _local_tz()

    # Try ISO 8601 first (full timestamp or YYYY-MM-DD[ T]HH:MM).
    for candidate in (s, s.replace(" ", "T")):
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                # Naive ISO → user meant local wall clock.
                dt = dt.replace(tzinfo=tz)
            return dt.astimezone(timezone.utc)
        except ValueError:
            pass

    lower = s.lower()
    today = _today_local()
    base: date | None = None
    if "завтра" in lower or "tomorrow" in lower:
        base = today + timedelta(days=1)
    elif "сьогодні" in lower or "today" in lower:
        base = today
    elif "післязавтра" in lower:
        base = today + timedelta(days=2)

    if base is None:
        # Last-resort — YYYY-MM-DD without time (default 09:00 local).
        m = re.search(r"(\d{4}-\d{2}-\d{2})", lower)
        if m:
            try:
                d = date.fromisoformat(m.group(1))
            except ValueError:
                return None
            return (
                datetime.combine(d, dtime(9, 0))
                .replace(tzinfo=tz)
                .astimezone(timezone.utc)
            )
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
    return (
        datetime.combine(base, dtime(hour, minute))
        .replace(tzinfo=tz)
        .astimezone(timezone.utc)
    )


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

    # Day-5 W-2c — build a CalendarScene envelope for the new event.
    # The FE expects a full week view; we provide the labels for the current week.
    today_l = _today_local()
    monday_l = today_l - timedelta(days=today_l.weekday())
    weekday_labels = ("ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "НД")
    date_labels = tuple((monday_l + timedelta(days=i)).strftime("%d.%m") for i in range(7))

    # Position percentage within the 24h column
    y_pct = (event.start_at.hour * 60 + event.start_at.minute) / (24 * 60) * 100
    duration_min = (event.end_at - event.start_at).total_seconds() / 60 if event.end_at else 60
    h_pct = max(5, duration_min / (24 * 60) * 100)  # min 5% height for visibility

    scene_event = {
        "event_id": str(event.id),
        "day_index": event.start_at.weekday(),
        "y_pct": round(y_pct, 1),
        "h_pct": round(h_pct, 1),
        "category": "personal",
        "label": event.title,
        "starts_at_ms": int(event.start_at.timestamp() * 1000),
        "ends_at_ms": int(event.end_at.timestamp() * 1000) if event.end_at else 0,
    }

    scene = {
        "kind": "calendar",
        "data": {
            "week_start_iso": monday_l.isoformat(),
            "today_iso": today_l.isoformat(),
            "weekday_labels": weekday_labels,
            "date_labels": date_labels,
            "events": [scene_event],
            "total_count": 1,
            "ai_suggestion": "Подію додано до вашого розкладу.",
        }
    }

    return _ok(
        id=event.id,
        title=event.title,
        start_at=event.start_at.isoformat(),
        end_at=event.end_at.isoformat(),
        status="created",
        scene=scene,
    )


# ── Phase-6 T1 — extended tool surface ───────────────────────────────────────
#
# Closes the audit-2026-04-30 finding that the agent only had 8 tools
# while phase-5 shipped UI/REST for ~20 actions (timer/alarm CRUD,
# sandbox kicks, audit query, wardriving query, etc.). Each handler
# below preserves the {"ok": True, ...} / {"error": "...",
# "error_kind": "..."} contract and uses a fresh AsyncSession so a
# tool call inside a chat turn doesn't reuse the chat's session.


async def _tool_create_timer(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    label = args.get("label") or "Timer"
    duration_s = args.get("duration_s")
    if not isinstance(duration_s, (int, float)) or duration_s <= 0:
        return _err("invalid_args", "duration_s must be a positive number")
    duration_s = int(duration_s)
    if duration_s > 86400:
        return _err("invalid_args", "duration_s must be <= 86400 (24h)")
    if not isinstance(label, str):
        return _err("invalid_args", "label must be string")
    label = label.strip()[:256] or "Timer"

    from db.tools_repo import create_timer as _create_timer
    async with _session_factory()() as db:
        timer = await _create_timer(db, user_id, label, duration_s)

    scene = {
        "kind": "timer",
        "data": {
            "timer_id": str(timer.id),
            "label": timer.label,
            "duration_sec": duration_s,
            "remaining_sec": duration_s,
            "started_at_ms": int(time.time() * 1000),
            "ends_at_ms": int(timer.ends_at.timestamp() * 1000) if timer.ends_at else 0,
            "status": "active",
        }
    }

    return _ok(
        id=timer.id,
        label=timer.label,
        ends_at=timer.ends_at.isoformat() if timer.ends_at else None,
        duration_s=duration_s,
        status="active",
        scene=scene,
    )


async def _tool_cancel_timer(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    timer_id = args.get("timer_id")
    if not isinstance(timer_id, str) or not timer_id.strip():
        return _err("invalid_args", "timer_id is required")
    from db.tools_repo import cancel_timer as _cancel_timer
    async with _session_factory()() as db:
        ok = await _cancel_timer(db, user_id, timer_id.strip())
    if not ok:
        return _err("not_found", f"no timer with id={timer_id!r}")
    return _ok(id=timer_id.strip(), status="cancelled")


async def _tool_list_timers(_args: dict[str, Any], user_id: str) -> dict[str, Any]:
    from db.tools_repo import get_timers as _get_timers
    async with _session_factory()() as db:
        rows = await _get_timers(db, user_id)
    return _ok(
        timers=[
            {
                "id": t.id,
                "label": t.label,
                "ends_at": t.ends_at.isoformat() if t.ends_at else None,
                "duration_s": t.duration_s,
            }
            for t in rows
        ],
        count=len(rows),
    )


async def _tool_create_alarm(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    time_str = args.get("time")
    repeat = args.get("repeat") or "once"
    label = args.get("label") or ""
    if not isinstance(time_str, str) or not re.match(r"^\d{2}:\d{2}$", time_str):
        return _err("invalid_args", "time must be HH:MM 24h string")
    if repeat not in ("once", "daily", "weekdays"):
        return _err("invalid_args", "repeat must be once|daily|weekdays")
    if not isinstance(label, str):
        return _err("invalid_args", "label must be string")
    
    from db.tools_repo import create_alarm as _create_alarm
    async with _session_factory()() as db:
        alarm = await _create_alarm(db, user_id, label.strip()[:256], time_str, repeat)

    # Day-5 W-2c — build an AlarmScene envelope.
    WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    now = datetime.now(timezone.utc)
    
    # Coerce to UTC aware if naive (SQLite fallback)
    fire_at = alarm.next_trigger
    if fire_at and fire_at.tzinfo is None:
        fire_at = fire_at.replace(tzinfo=timezone.utc)

    scene = {
        "kind": "alarm",
        "data": {
            "alarm_id": str(alarm.id),
            "fire_at_ms": int(fire_at.timestamp() * 1000) if fire_at else 0,
            "weekday": WEEKDAYS[fire_at.weekday()] if fire_at else "MON",
            "display_time": alarm.time_str,
            "display_date": fire_at.strftime("%d.%m") if fire_at else "",
            "display_weekday_short": fire_at.strftime("%a").upper() if fire_at else "",
            "sound": "default",
            "repeat_daily": alarm.repeat == "daily",
            "fires_in_ms": int((fire_at - now).total_seconds() * 1000) if fire_at else 0,
            "ai_note": "Будильник встановлено.",
        }
    }

    return _ok(
        id=alarm.id,
        time=alarm.time_str,
        repeat=alarm.repeat,
        label=alarm.label,
        next_trigger=alarm.next_trigger.isoformat() if alarm.next_trigger else None,
        scene=scene,
    )


async def _tool_delete_alarm(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    alarm_id = args.get("alarm_id")
    if not isinstance(alarm_id, str) or not alarm_id.strip():
        return _err("invalid_args", "alarm_id is required")
    from db.tools_repo import delete_alarm as _delete_alarm
    async with _session_factory()() as db:
        ok = await _delete_alarm(db, user_id, alarm_id.strip())
    if not ok:
        return _err("not_found", f"no alarm with id={alarm_id!r}")
    return _ok(id=alarm_id.strip(), status="deleted")


async def _tool_set_alarm_active(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    alarm_id = args.get("alarm_id")
    active = args.get("active")
    if not isinstance(alarm_id, str) or not alarm_id.strip():
        return _err("invalid_args", "alarm_id is required")
    if not isinstance(active, bool):
        return _err("invalid_args", "active must be boolean")
    from db.tools_repo import set_alarm_active as _set_active
    async with _session_factory()() as db:
        ok = await _set_active(db, user_id, alarm_id.strip(), active)
    if not ok:
        return _err("not_found", f"no alarm with id={alarm_id!r}")
    return _ok(id=alarm_id.strip(), active=active)


async def _tool_list_alarms(_args: dict[str, Any], user_id: str) -> dict[str, Any]:
    from db.tools_repo import get_alarms as _get_alarms
    async with _session_factory()() as db:
        rows = await _get_alarms(db, user_id)
    return _ok(
        alarms=[
            {
                "id": a.id,
                "time": a.time_str,
                "repeat": a.repeat,
                "label": a.label,
                "active": a.active,
                "next_trigger": a.next_trigger.isoformat() if a.next_trigger else None,
            }
            for a in rows
        ],
        count=len(rows),
    )


async def _tool_update_calendar_event(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    event_id = args.get("event_id")
    if not isinstance(event_id, str) or not event_id.strip():
        return _err("invalid_args", "event_id is required")
    title = args.get("title") if isinstance(args.get("title"), str) else None
    description = args.get("description") if isinstance(args.get("description"), str) else None
    start_expr = args.get("start_at")
    end_expr = args.get("end_at")
    location = args.get("location") if isinstance(args.get("location"), str) else None
    all_day = args.get("all_day") if isinstance(args.get("all_day"), bool) else None
    start_dt = _parse_datetime_freeform(start_expr) if isinstance(start_expr, str) else None
    end_dt = _parse_datetime_freeform(end_expr) if isinstance(end_expr, str) else None
    if isinstance(start_expr, str) and start_dt is None:
        return _err("invalid_args", f"could not parse start_at={start_expr!r}")
    if isinstance(end_expr, str) and end_dt is None:
        return _err("invalid_args", f"could not parse end_at={end_expr!r}")
    from db.tools_repo import update_calendar_event as _update
    async with _session_factory()() as db:
        event = await _update(
            db, user_id, event_id.strip(),
            title=title, description=description,
            start_at=start_dt, end_at=end_dt,
            all_day=all_day, location=location,
        )
    if event is None:
        return _err("not_found", f"no event with id={event_id!r}")
    return _ok(
        id=event.id,
        title=event.title,
        start_at=event.start_at.isoformat(),
        end_at=event.end_at.isoformat(),
        status="updated",
    )


async def _tool_delete_calendar_event(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    event_id = args.get("event_id")
    if not isinstance(event_id, str) or not event_id.strip():
        return _err("invalid_args", "event_id is required")
    from db.tools_repo import delete_calendar_event as _delete
    async with _session_factory()() as db:
        ok = await _delete(db, user_id, event_id.strip())
    if not ok:
        return _err("not_found", f"no event with id={event_id!r}")
    return _ok(id=event_id.strip(), status="deleted")


async def _tool_query_audit_log(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Last N agent_audit rows for the caller. Filterable by action_name."""
    limit = args.get("limit") or 20
    action_name = args.get("action_name")
    if not isinstance(limit, int) or limit < 1 or limit > 200:
        return _err("invalid_args", "limit must be 1..200")
    from db.models import AgentAuditEntry
    from sqlalchemy import desc, select as _select
    async with _session_factory()() as db:
        stmt = _select(AgentAuditEntry).order_by(desc(AgentAuditEntry.timestamp)).limit(limit)
        if isinstance(action_name, str) and action_name.strip():
            stmt = stmt.where(AgentAuditEntry.action_name == action_name.strip())
        rows = (await db.execute(stmt)).scalars().all()
    return _ok(
        entries=[
            {
                "task_id": r.task_id,
                "action_name": r.action_name,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                "elapsed_ms": r.elapsed_ms,
                "risk_level": r.risk_level,
                "intent": r.intent,
            }
            for r in rows
        ],
        count=len(rows),
    )


async def _tool_query_wardriving(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Recent wifi/BLE wardriving records. Optional ssid_substr filter."""
    _ = user_id  # wardriving rows are device-global, not user-scoped
    limit = args.get("limit") or 50
    ssid_substr = args.get("ssid_substr")
    if not isinstance(limit, int) or limit < 1 or limit > 500:
        return _err("invalid_args", "limit must be 1..500")
    try:
        from db.models import WardrivingRecord
    except ImportError:
        return _err("not_implemented", "wardriving model not present in this build")
    from sqlalchemy import desc, select as _select
    async with _session_factory()() as db:
        stmt = _select(WardrivingRecord).order_by(desc(WardrivingRecord.timestamp)).limit(limit)
        if isinstance(ssid_substr, str) and ssid_substr.strip():
            stmt = stmt.where(WardrivingRecord.ssid.ilike(f"%{ssid_substr.strip()}%"))
        rows = (await db.execute(stmt)).scalars().all()
    return _ok(
        records=[
            {
                "ssid": r.ssid,
                "bssid": r.bssid,
                "rssi": r.rssi,
                "lat": r.lat,
                "lon": r.lon,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            }
            for r in rows
        ],
        count=len(rows),
    )


async def _tool_list_files(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Operator-scoped directory listing inside the file_manager allow-list."""
    _ = user_id
    path = args.get("path")
    if path is not None and not isinstance(path, str):
        return _err("invalid_args", "path must be string or null")
    limit = args.get("limit") or 50
    if not isinstance(limit, int) or limit < 1 or limit > 200:
        return _err("invalid_args", "limit must be 1..200")
    try:
        from tools.file_manager import list_dir_raw
        return _ok(**list_dir_raw(path=path, limit=limit))
    except FileNotFoundError as exc:
        return _err("not_found", str(exc))
    except ValueError as exc:
        return _err("forbidden", str(exc))


async def _tool_read_file(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Read a single file inside the allow-list, capped at 1 MiB."""
    _ = user_id
    path = args.get("path")
    if not isinstance(path, str) or not path.strip():
        return _err("invalid_args", "path is required")
    try:
        from tools.file_manager import read_file as _rf
        return _ok(**_rf(path=path.strip()))
    except FileNotFoundError as exc:
        return _err("not_found", str(exc))
    except IsADirectoryError as exc:
        return _err("invalid_args", f"path is a directory: {exc}")
    except ValueError as exc:
        return _err("forbidden", str(exc))


async def _tool_search_files(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Substring filename search inside the allow-list."""
    _ = user_id
    query = args.get("query")
    if not isinstance(query, str) or not query.strip():
        return _err("invalid_args", "query is required")
    root = args.get("root") if isinstance(args.get("root"), str) else None
    limit = args.get("limit") or 9
    if not isinstance(limit, int) or limit < 1 or limit > 50:
        return _err("invalid_args", "limit must be 1..50")
    try:
        from tools.file_manager import search_files
        scene = search_files(root=root, query=query.strip(), limit=limit)
    except ValueError as exc:
        return _err("invalid_args", str(exc))
    return _ok(
        root_display=scene.root_display,
        total_matches=scene.total_matches,
        matches=[m.model_dump() for m in scene.matches],
    )


async def _tool_write_file(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Write a UTF-8 text file inside the allow-list. 5 MiB cap."""
    _ = user_id
    path = args.get("path")
    content = args.get("content")
    overwrite = args.get("overwrite", True)
    if not isinstance(path, str) or not path.strip():
        return _err("invalid_args", "path is required")
    if not isinstance(content, str):
        return _err("invalid_args", "content must be string")
    if not isinstance(overwrite, bool):
        return _err("invalid_args", "overwrite must be boolean")
    try:
        from tools.file_manager import write_file as _wf
        return _ok(**_wf(path=path.strip(), content=content, overwrite=overwrite))
    except FileExistsError as exc:
        return _err("conflict", str(exc))
    except IsADirectoryError as exc:
        return _err("invalid_args", f"path is a directory: {exc}")
    except ValueError as exc:
        msg = str(exc)
        kind = "too_large" if "exceeds write cap" in msg else "forbidden"
        return _err(kind, msg)


async def _tool_make_directory(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    _ = user_id
    path = args.get("path")
    if not isinstance(path, str) or not path.strip():
        return _err("invalid_args", "path is required")
    try:
        from tools.file_manager import make_directory as _md
        return _ok(**_md(path=path.strip()))
    except FileExistsError as exc:
        return _err("conflict", str(exc))
    except ValueError as exc:
        return _err("forbidden", str(exc))


async def _tool_create_checkpoint(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Create a planner checkpoint row. ROOT-style operation but agent-callable
    so the operator can voice-trigger 'збережи стан'."""
    reason = args.get("reason") or "manual"
    goal = args.get("goal") or "manual checkpoint"
    if reason not in ("manual", "auto_reflect", "pause", "shutdown"):
        return _err("invalid_args", "reason must be manual|auto_reflect|pause|shutdown")
    if not isinstance(goal, str) or not goal.strip():
        return _err("invalid_args", "goal must be non-empty string")
    try:
        from agent.kernel.audit import save_checkpoint
        from agent.schemas import Checkpoint, SelfModel
    except Exception as exc:
        return _err("not_implemented", f"checkpoint stack unavailable: {exc}")
    payload = Checkpoint(
        task_id=f"manual:{user_id}",
        reason=reason,  # type: ignore[arg-type]
        goal=goal.strip(),
        sub_goals=[],
        observations=[],
        self_model=SelfModel(
            identity="PHANTOM manual checkpoint",
            hardware={"trigger": "agent_tool"},
        ),
        step_idx=0,
    )
    try:
        cp_id = await save_checkpoint(payload)
    except Exception as exc:
        return _err("exception", f"save_checkpoint failed: {exc}")
    return _ok(checkpoint_id=cp_id, reason=reason, goal=goal.strip())


# ── Phase 17b — chat-driven Custom Agent management ──────────────────────────
#
# These tools let PHANTOM author, list, run, and delete saved "Васі-агенти"
# from inside a normal chat turn. The studio API at /api/v1/studio is the
# same surface the OperatorLayout AgentStudioOverlay uses; here we wrap it
# so the chat LLM can pick the right tool when the user says
# "PHANTOM, створи агента що щоранку збиратиме новини про дрони".


async def _tool_studio_list_agents(args: dict[str, Any], user_id: str) -> dict[str, Any]:  # noqa: ARG001
    try:
        from agent.studio.repository import list_agents
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")
    try:
        rows = await list_agents(user_id, limit=50)
    except Exception as exc:
        return _err("studio_list_failed", f"{type(exc).__name__}: {exc}")
    agents = [
        {
            "id": a.id,
            "name": a.name,
            "description": a.description,
            "tags": list(a.tags or []),
            "schedule_kind": a.schedule.kind if a.schedule else "manual",
            "enabled": bool(a.enabled),
            "last_run_at": a.last_run_at.isoformat() if a.last_run_at else None,
            "run_count": int(a.run_count or 0),
            "success_rate": round(float(a.success_rate), 3),
            "card_count": len(a.cards or []),
        }
        for a in rows
    ]
    return _ok(agents=agents, count=len(agents))


async def _tool_studio_get_agent(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    agent_id = str(args.get("agent_id") or "").strip()
    if not agent_id:
        return _err("invalid_args", "agent_id is required")
    try:
        from agent.studio.repository import get_agent
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")
    try:
        agent = await get_agent(agent_id)
    except Exception as exc:
        return _err("studio_get_failed", f"{type(exc).__name__}: {exc}")
    if agent is None:
        return _err("not_found", f"agent {agent_id} not found")
    if agent.owner_user_id != user_id:
        return _err("forbidden", "agent belongs to a different user")
    return _ok(agent=agent.model_dump(mode="json"))


async def _tool_studio_create_agent(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    name = str(args.get("name") or "").strip()
    if len(name) < 2:
        return _err("invalid_args", "name must be at least 2 characters")
    if len(name) > 160:
        return _err("invalid_args", "name longer than 160 characters")
    description = str(args.get("description") or "").strip()[:2000]
    goal_template = str(args.get("goal_template") or "").strip()[:4000]

    raw_tags = args.get("tags") or []
    tags: list[str] = []
    if isinstance(raw_tags, list):
        for t in raw_tags:
            if isinstance(t, str) and t.strip():
                tags.append(t.strip()[:32])
        tags = tags[:8]

    raw_schedule = args.get("schedule") or {}
    if not isinstance(raw_schedule, dict):
        raw_schedule = {}

    try:
        from agent.studio import CustomAgent, Schedule
        from agent.studio.repository import save_agent
        from agent.studio.validate import has_blockers, validate_agent
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")

    try:
        schedule = Schedule(**raw_schedule)
    except Exception as exc:
        return _err("invalid_schedule", f"{type(exc).__name__}: {exc}")

    agent = CustomAgent(
        owner_user_id=user_id,
        name=name,
        description=description,
        goal_template=goal_template,
        tags=tags,
        schedule=schedule,
        enabled=bool(args.get("enabled", True)),
    )
    issues = validate_agent(agent)
    if has_blockers(issues):
        return _err(
            "validation_failed",
            "; ".join(i.message for i in issues if i.severity == "blocker")[:300],
        )
    try:
        saved = await save_agent(agent)
    except Exception as exc:
        return _err("studio_save_failed", f"{type(exc).__name__}: {exc}")
    return _ok(
        agent_id=saved.id,
        name=saved.name,
        next_step=(
            "Агент створено. Додавай картки джерел і виходів через "
            "AgentStudio overlay або викликай мене знову з кратким описом "
            "потрібних кроків — я допоможу скласти DAG."
        ),
    )


async def _tool_studio_run_agent(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    agent_id = str(args.get("agent_id") or "").strip()
    if not agent_id:
        return _err("invalid_args", "agent_id is required")
    raw_inputs = args.get("inputs") or {}
    if not isinstance(raw_inputs, dict):
        return _err("invalid_args", "inputs must be an object")
    track = str(args.get("track") or "background").strip()
    if track not in {"foreground", "background"}:
        track = "background"
    note = str(args.get("note") or "").strip()[:240] or None

    try:
        from agent.studio import RunSpec
        from agent.studio.repository import get_agent
        from agent.studio.runner import run_custom_agent
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")

    try:
        agent = await get_agent(agent_id)
    except Exception as exc:
        return _err("studio_get_failed", f"{type(exc).__name__}: {exc}")
    if agent is None:
        return _err("not_found", f"agent {agent_id} not found")
    if agent.owner_user_id != user_id:
        return _err("forbidden", "agent belongs to a different user")
    if not agent.enabled:
        return _err("agent_disabled", f"agent {agent.name} is disabled")

    spec = RunSpec(agent_id=agent.id, inputs=raw_inputs, track=track, note=note)  # type: ignore[arg-type]
    try:
        task_id, run_id = await run_custom_agent(
            agent, spec, triggered_by="chat",
        )
    except Exception as exc:
        return _err("studio_run_failed", f"{type(exc).__name__}: {exc}")
    return _ok(task_id=task_id, run_id=run_id, agent_name=agent.name, track=track)


async def _tool_studio_delete_agent(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    agent_id = str(args.get("agent_id") or "").strip()
    if not agent_id:
        return _err("invalid_args", "agent_id is required")
    try:
        from agent.studio.repository import delete_agent, get_agent
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")
    try:
        agent = await get_agent(agent_id)
    except Exception as exc:
        return _err("studio_get_failed", f"{type(exc).__name__}: {exc}")
    if agent is None:
        return _err("not_found", f"agent {agent_id} not found")
    if agent.owner_user_id != user_id:
        return _err("forbidden", "agent belongs to a different user")
    try:
        deleted = await delete_agent(agent_id)
    except Exception as exc:
        return _err("studio_delete_failed", f"{type(exc).__name__}: {exc}")
    return _ok(deleted=bool(deleted), agent_name=agent.name)


async def _studio_load_owned(agent_id: str, user_id: str) -> tuple[Any, dict[str, Any] | None]:
    """Shared helper: load agent + verify ownership. Returns (agent, error)."""
    try:
        from agent.studio.repository import get_agent
    except Exception as exc:
        return None, _err("import_error", f"studio unavailable: {exc}")
    try:
        agent = await get_agent(agent_id)
    except Exception as exc:
        return None, _err("studio_get_failed", f"{type(exc).__name__}: {exc}")
    if agent is None:
        return None, _err("not_found", f"agent {agent_id} not found")
    if agent.owner_user_id != user_id:
        return None, _err("forbidden", "agent belongs to a different user")
    return agent, None


async def _studio_save_with_validation(agent: Any) -> dict[str, Any] | None:
    """Validate + persist. Returns error dict on failure, None on success."""
    try:
        from agent.studio.repository import save_agent
        from agent.studio.validate import has_blockers, validate_agent
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")
    issues = validate_agent(agent)
    if has_blockers(issues):
        return _err(
            "validation_failed",
            "; ".join(i.message for i in issues if i.severity == "blocker")[:300],
        )
    try:
        await save_agent(agent)
    except Exception as exc:
        return _err("studio_save_failed", f"{type(exc).__name__}: {exc}")
    return None


async def _tool_studio_update_agent(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    agent_id = str(args.get("agent_id") or "").strip()
    if not agent_id:
        return _err("invalid_args", "agent_id is required")
    agent, err = await _studio_load_owned(agent_id, user_id)
    if err is not None:
        return err

    # Apply only fields the LLM included; leave the rest untouched. This
    # lets PHANTOM say "rename it to X" without resending the full agent.
    if "name" in args:
        new_name = str(args.get("name") or "").strip()
        if len(new_name) < 2 or len(new_name) > 160:
            return _err("invalid_args", "name must be 2-160 characters")
        agent.name = new_name
    if "description" in args:
        agent.description = str(args.get("description") or "").strip()[:2000]
    if "goal_template" in args:
        agent.goal_template = str(args.get("goal_template") or "").strip()[:4000]
    if "tags" in args:
        raw = args.get("tags") or []
        if not isinstance(raw, list):
            return _err("invalid_args", "tags must be an array")
        clean: list[str] = []
        for t in raw:
            if isinstance(t, str) and t.strip():
                clean.append(t.strip()[:32])
        agent.tags = clean[:8]
    if "enabled" in args:
        agent.enabled = bool(args.get("enabled"))
    if "schedule" in args:
        try:
            from agent.studio import Schedule
        except Exception as exc:
            return _err("import_error", f"studio unavailable: {exc}")
        raw_sched = args.get("schedule") or {}
        if not isinstance(raw_sched, dict):
            return _err("invalid_args", "schedule must be an object")
        try:
            agent.schedule = Schedule(**raw_sched)
        except Exception as exc:
            return _err("invalid_schedule", f"{type(exc).__name__}: {exc}")

    err = await _studio_save_with_validation(agent)
    if err is not None:
        return err
    return _ok(agent_id=agent.id, name=agent.name, updated=True)


async def _tool_studio_add_card(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    agent_id = str(args.get("agent_id") or "").strip()
    if not agent_id:
        return _err("invalid_args", "agent_id is required")
    agent, err = await _studio_load_owned(agent_id, user_id)
    if err is not None:
        return err

    kind = str(args.get("kind") or "").strip()
    category = str(args.get("category") or "").strip()
    if not kind or not category:
        return _err("invalid_args", "kind and category are required")
    title = str(args.get("title") or "").strip()[:160]
    description = str(args.get("description") or "").strip()[:600]
    config = args.get("config") or {}
    if not isinstance(config, dict):
        return _err("invalid_args", "config must be an object")

    try:
        from agent.studio import AgentCard
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")
    try:
        card = AgentCard(
            kind=kind,  # type: ignore[arg-type]
            category=category,  # type: ignore[arg-type]
            title=title,
            description=description,
            config=config,
        )
    except Exception as exc:
        return _err("invalid_card", f"{type(exc).__name__}: {exc}")

    if len(agent.cards) >= 32:
        return _err(
            "card_limit",
            "agent has 32 cards already — drop one before adding more",
        )
    agent.cards = list(agent.cards) + [card]

    err = await _studio_save_with_validation(agent)
    if err is not None:
        return err
    return _ok(
        agent_id=agent.id,
        card_id=card.id,
        card_count=len(agent.cards),
        next_step=(
            f"Картку '{card.title or card.kind}' додано. Якщо ця картка "
            "має споживати вихід попередньої — викликай studio_link_cards "
            f"з from_card_id={agent.cards[-2].id if len(agent.cards) >= 2 else '<prev>'} "
            f"to_card_id={card.id}."
        ),
    )


async def _tool_studio_remove_card(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    agent_id = str(args.get("agent_id") or "").strip()
    card_id = str(args.get("card_id") or "").strip()
    if not agent_id or not card_id:
        return _err("invalid_args", "agent_id and card_id are required")
    agent, err = await _studio_load_owned(agent_id, user_id)
    if err is not None:
        return err

    before = len(agent.cards)
    agent.cards = [c for c in agent.cards if c.id != card_id]
    if len(agent.cards) == before:
        return _err("not_found", f"card {card_id} not on this agent")
    # Drop dangling links so validate_agent doesn't blocker on them.
    agent.links = [
        l for l in agent.links
        if l.from_card_id != card_id and l.to_card_id != card_id
    ]

    err = await _studio_save_with_validation(agent)
    if err is not None:
        return err
    return _ok(
        agent_id=agent.id,
        card_id=card_id,
        card_count=len(agent.cards),
        link_count=len(agent.links),
    )


async def _tool_studio_link_cards(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    agent_id = str(args.get("agent_id") or "").strip()
    from_card_id = str(args.get("from_card_id") or "").strip()
    to_card_id = str(args.get("to_card_id") or "").strip()
    if not agent_id or not from_card_id or not to_card_id:
        return _err(
            "invalid_args", "agent_id, from_card_id, to_card_id are required"
        )
    if from_card_id == to_card_id:
        return _err("invalid_args", "from_card_id and to_card_id must differ")
    label = str(args.get("label") or "").strip()[:32] or None

    agent, err = await _studio_load_owned(agent_id, user_id)
    if err is not None:
        return err

    card_ids = {c.id for c in agent.cards}
    if from_card_id not in card_ids:
        return _err("not_found", f"from_card_id {from_card_id} not on this agent")
    if to_card_id not in card_ids:
        return _err("not_found", f"to_card_id {to_card_id} not on this agent")

    # Prevent duplicate edges with the same label.
    for link in agent.links:
        if (
            link.from_card_id == from_card_id
            and link.to_card_id == to_card_id
            and (link.label or None) == label
        ):
            return _err(
                "duplicate_link",
                "this exact edge already exists — pass a different label or skip",
            )

    try:
        from agent.studio import AgentCardLink
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")
    new_link = AgentCardLink(
        from_card_id=from_card_id, to_card_id=to_card_id, label=label,
    )
    agent.links = list(agent.links) + [new_link]

    err = await _studio_save_with_validation(agent)
    if err is not None:
        return err
    return _ok(agent_id=agent.id, link_count=len(agent.links))


async def _tool_studio_add_recipient(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    agent_id = str(args.get("agent_id") or "").strip()
    if not agent_id:
        return _err("invalid_args", "agent_id is required")
    channel = str(args.get("channel") or "").strip()
    target = str(args.get("target") or "").strip()
    if not channel or not target:
        return _err("invalid_args", "channel and target are required")
    label = str(args.get("label") or "").strip()[:120] or None

    agent, err = await _studio_load_owned(agent_id, user_id)
    if err is not None:
        return err

    try:
        from agent.studio import Recipient
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")
    try:
        recipient = Recipient(
            channel=channel,  # type: ignore[arg-type]
            target=target,
            label=label,
            enabled=bool(args.get("enabled", True)),
        )
    except Exception as exc:
        return _err("invalid_recipient", f"{type(exc).__name__}: {exc}")

    if len(agent.recipients) >= 16:
        return _err(
            "recipient_limit",
            "agent has 16 recipients already — drop one before adding",
        )
    agent.recipients = list(agent.recipients) + [recipient]

    err = await _studio_save_with_validation(agent)
    if err is not None:
        return err
    return _ok(
        agent_id=agent.id,
        recipient_id=recipient.id,
        recipient_count=len(agent.recipients),
    )


async def _tool_studio_set_inputs_schema(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Replace the agent's `inputs_schema` — the typed parameters the
    operator (or another caller) supplies at run-time. Each entry is an
    `InfoNeed`-shaped dict; on agent run, missing required fields surface
    through the existing AskUser flow with the same rich variant UI.

    Pass an empty list to clear the schema (agent runs with empty inputs).
    """
    agent_id = str(args.get("agent_id") or "").strip()
    if not agent_id:
        return _err("invalid_args", "agent_id is required")
    raw_inputs = args.get("inputs")
    if raw_inputs is None:
        raw_inputs = []
    if not isinstance(raw_inputs, list):
        return _err("invalid_args", "inputs must be an array")
    if len(raw_inputs) > 16:
        return _err("invalid_args", "inputs cap is 16 entries")

    agent, err = await _studio_load_owned(agent_id, user_id)
    if err is not None:
        return err

    try:
        from agent.schemas import InfoNeed
    except Exception as exc:
        return _err("import_error", f"schemas unavailable: {exc}")

    parsed: list[Any] = []
    for idx, entry in enumerate(raw_inputs):
        if not isinstance(entry, dict):
            return _err("invalid_args", f"inputs[{idx}] must be an object")
        # The schema is a TEMPLATE — task_id is filled at runtime by the
        # AskUser action when an actual InfoNeed instance is registered.
        # Stamp a placeholder here so Pydantic accepts the shape.
        entry = dict(entry)
        entry.setdefault("task_id", "<template>")
        try:
            need = InfoNeed(**entry)
        except Exception as exc:
            return _err(
                "invalid_inputs_entry",
                f"inputs[{idx}]: {type(exc).__name__}: {exc}",
            )
        parsed.append(need)

    agent.inputs_schema = parsed

    err = await _studio_save_with_validation(agent)
    if err is not None:
        return err
    return _ok(
        agent_id=agent.id,
        inputs_schema_size=len(parsed),
        next_step=(
            "Тепер при `studio_run_agent` потрібно передати inputs словник "
            "із полями що відповідають schema. Якщо required-полів бракує — "
            "agent зачекає AskUser-пропозиції на запуску."
        ),
    )


async def _tool_studio_remove_recipient(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    agent_id = str(args.get("agent_id") or "").strip()
    recipient_id = str(args.get("recipient_id") or "").strip()
    if not agent_id or not recipient_id:
        return _err("invalid_args", "agent_id and recipient_id are required")
    agent, err = await _studio_load_owned(agent_id, user_id)
    if err is not None:
        return err

    before = len(agent.recipients)
    agent.recipients = [r for r in agent.recipients if r.id != recipient_id]
    if len(agent.recipients) == before:
        return _err("not_found", f"recipient {recipient_id} not on this agent")

    err = await _studio_save_with_validation(agent)
    if err is not None:
        return err
    return _ok(
        agent_id=agent.id,
        recipient_id=recipient_id,
        recipient_count=len(agent.recipients),
    )


async def _tool_studio_card_catalog(args: dict[str, Any], user_id: str) -> dict[str, Any]:  # noqa: ARG001
    try:
        from agent.studio.catalog import list_catalog
    except Exception as exc:
        return _err("import_error", f"studio unavailable: {exc}")
    try:
        entries = list_catalog()
    except Exception as exc:
        return _err("studio_catalog_failed", f"{type(exc).__name__}: {exc}")
    grouped: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        try:
            payload = entry.model_dump(mode="json") if hasattr(entry, "model_dump") else dict(entry)  # type: ignore[arg-type]
        except Exception:
            continue
        cat = str(payload.get("category") or "other")
        grouped.setdefault(cat, []).append(
            {
                "kind": payload.get("kind"),
                "title": payload.get("title") or payload.get("kind"),
                "description": payload.get("description") or "",
            }
        )
    return _ok(categories=grouped, total=sum(len(v) for v in grouped.values()))


# ── Phase 25-C — Vault chat tools ─────────────────────────────────────────────


_VAULT_KNOWN_KINDS = frozenset({
    "email_account", "service_login", "messenger", "phone",
    "company", "payment_method", "api_key", "document", "contact",
    "wifi_network", "crypto_wallet", "custom",
})


def _vault_serialise(card: Any) -> dict[str, Any]:
    """Render a VaultCard ORM row for the chat layer. Mirrors the REST
    masking in routes_vault — secret values are returned as "***" and the
    parallel `field_kinds` map tells AI which fields are secret-but-revealable."""
    import json as _json
    raw = _json.loads(card.fields_json or "{}")
    plain: dict[str, str] = {}
    kinds: dict[str, str] = {}
    for name, payload in raw.items():
        if not isinstance(payload, dict):
            continue
        is_secret = bool(payload.get("secret"))
        kinds[name] = "secret" if is_secret else "plain"
        plain[name] = "***" if is_secret else str(payload.get("v", ""))
    tags = _json.loads(card.tags_json or "[]")
    return {
        "id": card.id,
        "kind": card.kind,
        "label": card.label,
        "tags": list(tags) if isinstance(tags, list) else [],
        "ai_writable": bool(card.ai_writable),
        "fields": plain,
        "field_kinds": kinds,
        "deleted_at": card.deleted_at.isoformat() if card.deleted_at else None,
        "created_at": card.created_at.isoformat() if card.created_at else None,
        "updated_at": card.updated_at.isoformat() if card.updated_at else None,
    }


def _vault_encode_fields(
    *, fields: dict[str, Any], user_id: str, card_id: str,
) -> str:
    """Build the storage blob. Encrypts each `secret=True` value with the
    same vault_crypto path used by the REST layer so a card created via
    chat is indistinguishable from one created via /vault/cards."""
    import json as _json
    from security.vault_crypto import encrypt_field
    out: dict[str, dict[str, Any]] = {}
    for name, payload in fields.items():
        if not isinstance(payload, dict):
            continue
        secret = bool(payload.get("secret"))
        value = str(payload.get("value") or "")
        if secret:
            out[name] = {
                "v": encrypt_field(
                    user_id=user_id, card_id=card_id,
                    field_name=name, plaintext=value,
                ),
                "secret": True,
            }
        else:
            out[name] = {"v": value, "secret": False}
    return _json.dumps(out, ensure_ascii=False)


async def _tool_vault_list(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    import json as _json
    from sqlalchemy import desc, select
    from db.models import VaultCard
    kind = args.get("kind")
    tag = args.get("tag")
    if kind and kind not in _VAULT_KNOWN_KINDS:
        return _err("invalid_args", f"unknown kind '{kind}'")
    async with _session_factory()() as db:
        stmt = select(VaultCard).where(
            VaultCard.owner_user_id == user_id,
            VaultCard.deleted_at.is_(None),
        )
        if kind:
            stmt = stmt.where(VaultCard.kind == kind)
        stmt = stmt.order_by(desc(VaultCard.updated_at))
        rows = (await db.execute(stmt)).scalars().all()
    if tag:
        rows = [
            r for r in rows
            if tag in (_json.loads(r.tags_json or "[]") or [])
        ]
    cards = [_vault_serialise(r) for r in rows]
    return _ok(cards=cards, count=len(cards))


async def _tool_vault_get(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    from sqlalchemy import select
    from db.models import VaultCard
    card_id = str(args.get("card_id") or "").strip()
    if not card_id:
        return _err("invalid_args", "card_id is required")
    async with _session_factory()() as db:
        stmt = select(VaultCard).where(
            VaultCard.id == card_id,
            VaultCard.owner_user_id == user_id,
            VaultCard.deleted_at.is_(None),
        )
        card = (await db.execute(stmt)).scalar_one_or_none()
    if card is None:
        return _err("not_found", f"card {card_id} not found")
    return _ok(card=_vault_serialise(card))


async def _tool_vault_create(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    import json as _json
    from db.models import VaultAuditEntry, VaultCard
    kind = str(args.get("kind") or "").strip()
    if kind not in _VAULT_KNOWN_KINDS:
        return _err(
            "invalid_args",
            f"unknown kind '{kind}'; allowed: {sorted(_VAULT_KNOWN_KINDS)}",
        )
    label = str(args.get("label") or "").strip()
    if len(label) < 1 or len(label) > 160:
        return _err("invalid_args", "label must be 1..160 chars")
    fields = args.get("fields") or {}
    if not isinstance(fields, dict):
        return _err("invalid_args", "fields must be a dict of {name:{value,secret}}")
    raw_tags = args.get("tags") or []
    tags = [str(t)[:64] for t in raw_tags if isinstance(t, (str, int))][:40]

    async with _session_factory()() as db:
        card = VaultCard(
            owner_user_id=user_id,
            kind=kind,
            label=label,
            tags_json=_json.dumps(tags, ensure_ascii=False),
            ai_writable=True,
        )
        db.add(card)
        await db.flush()
        card.fields_json = _vault_encode_fields(
            fields=fields, user_id=user_id, card_id=card.id,
        )
        db.add(VaultAuditEntry(
            user_id=user_id,
            card_id=card.id,
            action="create",
            actor="ai",
            details_json=_json.dumps(
                {"kind": kind, "label": label,
                 "field_names": list(fields.keys())},
                ensure_ascii=False,
            ),
        ))
        await db.commit()
        await db.refresh(card)
    return _ok(card=_vault_serialise(card))


async def _tool_vault_update(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    import json as _json
    from datetime import datetime, timezone
    from sqlalchemy import select
    from db.models import VaultAuditEntry, VaultCard
    card_id = str(args.get("card_id") or "").strip()
    if not card_id:
        return _err("invalid_args", "card_id is required")

    async with _session_factory()() as db:
        stmt = select(VaultCard).where(
            VaultCard.id == card_id,
            VaultCard.owner_user_id == user_id,
            VaultCard.deleted_at.is_(None),
        )
        card = (await db.execute(stmt)).scalar_one_or_none()
        if card is None:
            return _err("not_found", f"card {card_id} not found")
        if not bool(card.ai_writable):
            return _err(
                "forbidden",
                "this card is marked ai_writable=false — operator must "
                "edit it via the Vault UI",
            )
        changed: list[str] = []
        if "label" in args and args["label"] is not None:
            new_label = str(args["label"]).strip()
            if 1 <= len(new_label) <= 160:
                card.label = new_label
                changed.append("label")
            else:
                return _err("invalid_args", "label must be 1..160 chars")
        if "tags" in args and args["tags"] is not None:
            raw_tags = args["tags"] or []
            if isinstance(raw_tags, list):
                tags = [str(t)[:64] for t in raw_tags if isinstance(t, (str, int))][:40]
                card.tags_json = _json.dumps(tags, ensure_ascii=False)
                changed.append("tags")
        if "ai_writable" in args and args["ai_writable"] is not None:
            card.ai_writable = bool(args["ai_writable"])
            changed.append("ai_writable")
        if "fields" in args and args["fields"] is not None:
            fields = args["fields"] or {}
            if not isinstance(fields, dict):
                return _err("invalid_args", "fields must be a dict")
            existing = _json.loads(card.fields_json or "{}")
            new_blob = _vault_encode_fields(
                fields=fields, user_id=user_id, card_id=card.id,
            )
            new_raw = _json.loads(new_blob)
            existing.update(new_raw)
            card.fields_json = _json.dumps(existing, ensure_ascii=False)
            changed.append("fields")
        card.updated_at = datetime.now(tz=timezone.utc)
        db.add(VaultAuditEntry(
            user_id=user_id,
            card_id=card.id,
            action="update",
            actor="ai",
            details_json=_json.dumps({"changed": changed}, ensure_ascii=False),
        ))
        await db.commit()
        await db.refresh(card)
    return _ok(card=_vault_serialise(card))


async def _tool_vault_delete(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    import json as _json
    from datetime import datetime, timezone
    from sqlalchemy import select
    from db.models import VaultAuditEntry, VaultCard
    card_id = str(args.get("card_id") or "").strip()
    if not card_id:
        return _err("invalid_args", "card_id is required")
    async with _session_factory()() as db:
        stmt = select(VaultCard).where(
            VaultCard.id == card_id,
            VaultCard.owner_user_id == user_id,
            VaultCard.deleted_at.is_(None),
        )
        card = (await db.execute(stmt)).scalar_one_or_none()
        if card is None:
            return _err("not_found", f"card {card_id} not found")
        if not bool(card.ai_writable):
            return _err("forbidden", "card is ai_writable=false")
        card.deleted_at = datetime.now(tz=timezone.utc)
        db.add(VaultAuditEntry(
            user_id=user_id, card_id=card.id,
            action="delete", actor="ai",
            details_json=_json.dumps({}, ensure_ascii=False),
        ))
        await db.commit()
    return _ok(deleted=True, card_id=card_id)


async def _tool_vault_reveal(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Phase 25-D — return plaintext for ONE secret field on ONE card.

    HIGH RISK: the plaintext flows back through the LLM tool-call return
    path so the model has it in its working context. The operator gates
    THIS tool via the agent loop's risk gate (Phase 23-D Council +
    Phase 19-4 phone approval) BEFORE the dispatcher invokes the
    handler — by the time we reach this code the human approval has
    already happened.

    Audit: actor="ai", details include field_name + justification + an
    `accessed_via` marker so the operator can distinguish chat-tool
    reveals from REST-driven (Settings UI) reveals.
    """
    import json as _json
    from datetime import datetime, timezone
    from sqlalchemy import select
    from db.models import VaultAuditEntry, VaultCard
    from security.vault_crypto import InvalidVaultToken, decrypt_field

    card_id = str(args.get("card_id") or "").strip()
    field_name = str(args.get("field_name") or "").strip()
    justification = str(args.get("justification") or "").strip()
    if not card_id:
        return _err("invalid_args", "card_id is required")
    if not field_name:
        return _err("invalid_args", "field_name is required")
    if len(justification) < 4 or len(justification) > 240:
        return _err(
            "invalid_args",
            "justification is required (4..240 chars) and is logged "
            "in the audit trail; tell the user why you need plaintext",
        )

    async with _session_factory()() as db:
        stmt = select(VaultCard).where(
            VaultCard.id == card_id,
            VaultCard.owner_user_id == user_id,
            VaultCard.deleted_at.is_(None),
        )
        card = (await db.execute(stmt)).scalar_one_or_none()
        if card is None:
            return _err("not_found", f"card {card_id} not found")

        raw = _json.loads(card.fields_json or "{}")
        payload = raw.get(field_name)
        if not isinstance(payload, dict):
            return _err("not_found", f"field '{field_name}' not on card")
        if not payload.get("secret"):
            return _err(
                "not_secret",
                f"field '{field_name}' is plain — read via vault_get",
            )
        try:
            plaintext = decrypt_field(
                user_id=user_id,
                card_id=card.id,
                field_name=field_name,
                token=str(payload.get("v") or ""),
            )
        except InvalidVaultToken as exc:
            return _err(
                "vault_key_rotation_required",
                f"decrypt failed: {exc}; operator must run the "
                f"vault re-encrypt migration",
            )

        revealed_at = datetime.now(tz=timezone.utc)
        card.last_accessed_at = revealed_at
        db.add(VaultAuditEntry(
            user_id=user_id,
            card_id=card.id,
            action="reveal",
            actor="ai",
            details_json=_json.dumps(
                {
                    "field_name": field_name,
                    "justification": justification,
                    "accessed_via": "chat_tool",
                },
                ensure_ascii=False,
            ),
        ))
        await db.commit()

    return _ok(
        card_id=card_id,
        field_name=field_name,
        value=plaintext,
        revealed_at=revealed_at.isoformat(),
    )


async def _tool_vault_restore(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    import json as _json
    from datetime import datetime, timezone
    from sqlalchemy import select
    from db.models import VaultAuditEntry, VaultCard
    card_id = str(args.get("card_id") or "").strip()
    if not card_id:
        return _err("invalid_args", "card_id is required")
    async with _session_factory()() as db:
        stmt = select(VaultCard).where(
            VaultCard.id == card_id,
            VaultCard.owner_user_id == user_id,
        )
        card = (await db.execute(stmt)).scalar_one_or_none()
        if card is None:
            return _err("not_found", f"card {card_id} not found")
        if card.deleted_at is None:
            return _ok(card=_vault_serialise(card), already_active=True)
        card.deleted_at = None
        card.updated_at = datetime.now(tz=timezone.utc)
        db.add(VaultAuditEntry(
            user_id=user_id, card_id=card.id,
            action="restore", actor="ai",
            details_json=_json.dumps({}, ensure_ascii=False),
        ))
        await db.commit()
        await db.refresh(card)
    return _ok(card=_vault_serialise(card))


async def _tool_get_my_location(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    try:
        from core.context_engine import context_engine
        snap = context_engine.get_snapshot()
    except Exception as exc:
        return _err("network", f"context_engine unavailable: {exc}")

    where = snap.get("where", {})
    if where.get("lat") is None or where.get("lon") is None:
        return _ok(
            lat=None,
            lon=None,
            place_name=where.get("place_name"),
            accuracy_m=None,
            fix=False,
        )

    return _ok(
        lat=where["lat"],
        lon=where["lon"],
        place_name=where.get("place_name"),
        accuracy_m=where.get("accuracy_m"),
        fix=where.get("fix", False),
    )


async def _tool_get_internal_state(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    try:
        from ai.sentience.endocrine import endocrine_system
        bias = endocrine_system.get_personality_bias()
        return _ok(
            tone_warmth=float(bias["tone_warmth"]),
            verbosity=float(bias["verbosity"]),
            creativity=float(bias["creativity"]),
            mood_trend=str(bias.get("mood_trend", "stable")),
        )
    except Exception as exc:
        return _err("internal", f"endocrine_system unavailable: {exc}")


async def _tool_get_recent_hearing(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    window_s = int(args.get("window_s", 30))
    try:
        from core.context_engine import context_engine
        recent = context_engine.get_recent_hearing(window_s)
        return _ok(
            window_s=window_s,
            transcripts=recent,
            count=len(recent)
        )
    except Exception as exc:
        return _err("internal", f"failed to get hearing buffer: {exc}")


async def _tool_run_terminal_command(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    # Day-5: Execute arbitrary terminal command directly from chat.
    # Wraps asyncio.create_subprocess_shell to provide raw access without strict bwrap.
    import asyncio
    command = args.get("command")
    if not command:
        return {"ok": False, "error": "command required", "error_kind": "validation"}
    
    timeout_s = int(args.get("timeout_s", 60))
    
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
            stdout = stdout_b.decode("utf-8", errors="replace")
            stderr = stderr_b.decode("utf-8", errors="replace")
            return {
                "ok": True,
                "stdout": stdout,
                "stderr": stderr,
                "return_code": proc.returncode,
            }
        except asyncio.TimeoutError:
            proc.terminate()
            # Try to get whatever was outputted before timeout
            try:
                stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=2.0)
                stdout = stdout_b.decode("utf-8", errors="replace")
                stderr = stderr_b.decode("utf-8", errors="replace")
            except asyncio.TimeoutError:
                proc.kill()
                stdout = "<process killed, no output captured>"
                stderr = ""
                
            return {
                "ok": False, 
                "error": f"timeout after {timeout_s}s", 
                "error_kind": "timeout",
                "stdout": stdout,
                "stderr": stderr
            }
    except Exception as e:
        return {"ok": False, "error": str(e), "error_kind": "execution_failed"}



async def _tool_search_nearby_places(args: dict[str, Any], user_id: str, db: AsyncSession) -> dict[str, Any]:
    from agent.actions.map.query_nearby import MapQueryNearby
    from agent.base import ActionContext
    
    query = args.get("query")
    try:
        radius_m = int(args.get("radius_m", 1000))
    except (ValueError, TypeError):
        radius_m = 1000
        
    action = MapQueryNearby(
        query=query,
        radius_m=radius_m,
        lat=None,
        lon=None,
        user_id=user_id
    )
    ctx = ActionContext(session_id="chat", message_id="chat", step=1, extras={"user_id": user_id})
    res = await action.execute(ctx)
    
    if res.ok:
        return _ok(res.output)
    else:
        return _err(res.output.get("reason", "unknown"), str(res.output.get("error", "Unknown error")))

# ── Dispatcher ────────────────────────────────────────────────────────────────



_HANDLERS: dict[str, Any] = {
    "search_nearby_places": _tool_search_nearby_places,
    "search_locationhistory": _tool_search_locationhistory,
    "query_temporal_anchors": _tool_query_temporal_anchors,
    "recall_memory_facts": _tool_recall_memory_facts,
    "get_system_metrics": _tool_get_system_metrics,
    "get_sensor_status": _tool_get_sensor_status,
    "get_my_location": _tool_get_my_location,
    "get_internal_state": _tool_get_internal_state,
    "get_recent_hearing": _tool_get_recent_hearing,
    "run_terminal_command": _tool_run_terminal_command,
    "search_web": _tool_search_web,
    "get_calendar_events": _tool_get_calendar_events,
    "create_calendar_event": _tool_create_calendar_event,
    # Phase-6 T1 expansion (audit-2026-04-30):
    "create_timer": _tool_create_timer,
    "cancel_timer": _tool_cancel_timer,
    "list_timers": _tool_list_timers,
    "create_alarm": _tool_create_alarm,
    "delete_alarm": _tool_delete_alarm,
    "set_alarm_active": _tool_set_alarm_active,
    "list_alarms": _tool_list_alarms,
    "update_calendar_event": _tool_update_calendar_event,
    "delete_calendar_event": _tool_delete_calendar_event,
    "query_audit_log": _tool_query_audit_log,
    "query_wardriving": _tool_query_wardriving,
    "create_checkpoint": _tool_create_checkpoint,
    "list_files": _tool_list_files,
    "read_file": _tool_read_file,
    "search_files": _tool_search_files,
    "write_file": _tool_write_file,
    "make_directory": _tool_make_directory,
    # Phase 17b — chat-driven Custom Agent management ("Васі-агенти").
    "studio_list_agents": _tool_studio_list_agents,
    "studio_get_agent": _tool_studio_get_agent,
    "studio_create_agent": _tool_studio_create_agent,
    "studio_run_agent": _tool_studio_run_agent,
    "studio_delete_agent": _tool_studio_delete_agent,
    "studio_card_catalog": _tool_studio_card_catalog,
    # Phase 17b-chat-2 — chat-driven editing of an existing custom agent.
    "studio_update_agent": _tool_studio_update_agent,
    "studio_add_card": _tool_studio_add_card,
    "studio_remove_card": _tool_studio_remove_card,
    "studio_link_cards": _tool_studio_link_cards,
    "studio_add_recipient": _tool_studio_add_recipient,
    "studio_remove_recipient": _tool_studio_remove_recipient,
    "studio_set_inputs_schema": _tool_studio_set_inputs_schema,
    # Phase 25-C — Personal Vault chat-driven CRUD.
    "vault_list": _tool_vault_list,
    "vault_get": _tool_vault_get,
    "vault_create": _tool_vault_create,
    "vault_update": _tool_vault_update,
    "vault_delete": _tool_vault_delete,
    "vault_restore": _tool_vault_restore,
    # Phase 25-D — HIGH RISK: returns plaintext to the LLM context.
    # Gated upstream by the agent loop's risk gate (Phase 23-D Council
    # + Phase 19-4 phone approval) BEFORE this handler runs.
    "vault_reveal": _tool_vault_reveal,
}


def _args_snippet(args: dict[str, Any], *, max_len: int = 200) -> str:
    """Compact, safe repr of tool args for log lines. Truncated to max_len chars."""
    try:
        parts: list[str] = []
        for k, v in args.items():
            if isinstance(v, str):
                sv = v if len(v) < 60 else v[:57] + "..."
                parts.append(f"{k}={sv!r}")
            else:
                parts.append(f"{k}={v!r}")
        snippet = "{" + ", ".join(parts) + "}"
    except Exception:
        snippet = "<unrepr>"
    if len(snippet) > max_len:
        snippet = snippet[: max_len - 3] + "..."
    return snippet


async def execute_tool(
    tool_name: str,
    args: dict[str, Any] | None,
    user_id: str,
    *,
    timeout_s: float | None = None,
) -> dict[str, Any]:
    """
    Dispatch a tool call. NEVER raises — always returns a result dict.

    On success: ``{"ok": True, ...}``.
    On failure: ``{"error": "...", "error_kind": "..."}``.

    The effective timeout is, in order:
      1. ``timeout_s`` argument (explicit override).
      2. ``PER_TOOL_TIMEOUT_S[tool_name]`` (network IO bumps).
      3. ``TOOL_TIMEOUT_S`` (10s in-process default).
    """
    handler = _HANDLERS.get(tool_name)
    if handler is None:
        return _err("unknown_tool", f"no handler for tool '{tool_name}'")

    safe_args = dict(args) if isinstance(args, dict) else {}
    snippet = _args_snippet(safe_args)
    # Pre-invocation line so Phase 10.3 Gate 6 (grep the log for 'invoked
    # tool=<name>') can verify *which* tool actually fired, independent of
    # whether it succeeded.
    logger.info(
        "tool_executor: invoked tool=%s user=%s args=%s",
        tool_name, user_id, snippet,
    )
    effective_timeout = (
        timeout_s
        if timeout_s is not None
        else PER_TOOL_TIMEOUT_S.get(tool_name, TOOL_TIMEOUT_S)
    )
    t0 = time.monotonic()
    try:
        result = await asyncio.wait_for(
            handler(safe_args, user_id),
            timeout=effective_timeout,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "tool_executor: %s timed out after %.1fs", tool_name, effective_timeout
        )
        return _err(
            "timeout",
            f"tool '{tool_name}' exceeded {effective_timeout:.1f}s",
        )
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
