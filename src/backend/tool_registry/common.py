"""Shared helpers for tool families — moved verbatim from ai/tool_executor.py (G1.1)."""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any

from config import config
from db import database as _db

logger = logging.getLogger(__name__)

def _session_factory():
    """Resolve the current AsyncSessionLocal — dynamic so tests can swap it."""
    return _db.AsyncSessionLocal

def _err(kind: str, message: str) -> dict[str, Any]:
    return {"error": message, "error_kind": kind}

def _ok(**kwargs: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": True}
    out.update(kwargs)
    return out

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
