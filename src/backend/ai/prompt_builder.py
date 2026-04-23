"""
PHANTOM OS — Prompt Builder.
Assembles the dynamic system prompt from ContextSnapshot, user preferences,
behavioral model, and memory hints.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from ai.personality import (
    PHANTOM_IDENTITY,
    DATA_TOOLS_GUIDANCE,
    RESPONSE_FORMS_GUIDANCE,
    STATE_BEHAVIORS,
    ToneVector,
    calculate_tone,
)

logger = logging.getLogger(__name__)


_SOURCE_LABELS = {
    "gps_hardware": "GPS",
    "browser_geolocation": "browser",
    "ip_estimate": "IP estimate",
    "user_stated": "user-stated",
}


def _format_location_block(where: dict[str, Any]) -> str:
    """Render LOCATION line. Includes any non-empty source, not just hardware GPS.

    Phase 9.4c quick-win #1: pre-fix gate read `where.get("fix")` which is True
    only for hardware GPS. Browser/IP/user-stated populate lat/lon/source but
    leave fix=False, so chat reported "unknown" despite knowing the city.
    """
    source = where.get("source")
    lat = where.get("lat")
    lon = where.get("lon")

    if not source or source == "none" or lat is None or lon is None:
        return "LOCATION: unknown (no localization)"

    place = where.get("place_name") or f"({lat:.4f}, {lon:.4f})"
    label = _SOURCE_LABELS.get(source, source)
    conf = where.get("confidence") or 0.0
    conf_pct = int(round(float(conf) * 100))
    suffix = f"{label}, {conf_pct}% confidence"

    accuracy_m = where.get("accuracy_m")
    if accuracy_m:
        try:
            acc = float(accuracy_m)
        except (TypeError, ValueError):
            acc = 0.0
        if 0 < acc < 1000:
            suffix += f", ±{int(round(acc))}m"
        elif acc >= 1000:
            suffix += f", ±{acc / 1000:.1f}km"

    speed = where.get("speed_kmh") or 0.0
    try:
        speed_f = float(speed)
    except (TypeError, ValueError):
        speed_f = 0.0
    return f"LOCATION: {place} ({suffix}), speed={speed_f:.1f}km/h"


async def fetch_recent_places(
    db: AsyncSession | None,
    user_id: str,
    *,
    hours: int = 24,
    limit: int = 5,
) -> list[tuple[str, datetime]]:
    """Phase 9.4c quick-win #2 — pull distinct LocationHistory places.

    Returns up to ``limit`` (place_name, first_seen) tuples ordered by
    most-recently-first-visited. Same-place rows are collapsed by
    GROUP BY so consecutive duplicates from the resolver writer don't
    pad the list. Best-effort: any DB error returns ``[]`` so a slow or
    locked SQLite never blocks chat reply.
    """
    if db is None:
        return []
    try:
        from db.models import LocationHistory  # noqa: PLC0415
        since = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
        stmt = (
            select(
                LocationHistory.place_name,
                func.min(LocationHistory.timestamp).label("first_seen"),
            )
            .where(
                LocationHistory.user_id == user_id,
                LocationHistory.timestamp >= since,
                LocationHistory.place_name.isnot(None),
            )
            .group_by(LocationHistory.place_name)
            .order_by(desc("first_seen"))
            .limit(limit)
        )
        result = await db.execute(stmt)
        return [(row.place_name, row.first_seen) for row in result.all()]
    except Exception as exc:  # noqa: BLE001
        logger.debug("fetch_recent_places failed: %s", exc)
        return []


def _format_emotion_block(emotion: dict | None) -> str | None:
    """Phase 9.4c-qw fix #5 — render PHANTOM's emotion when notably off baseline.

    Ported from agent.planner.tactical._format_emotion_block but tuned for
    chat: only one short labelled line, no full coaching paragraph. Skipped
    entirely on near-neutral state so a default chat doesn't pay the
    prompt-bloat tax.
    """
    if not emotion:
        return None
    try:
        focus = float(emotion.get("focus", 0.5))
        curiosity = float(emotion.get("curiosity", 0.5))
        concern = float(emotion.get("concern", 0.0))
        fatigue = float(emotion.get("fatigue", 0.0))
    except (TypeError, ValueError):
        return None

    if max(focus, curiosity) < 0.6 and max(concern, fatigue) < 0.3:
        return None

    labels: list[str] = []
    if focus > 0.7:
        labels.append("focused")
    if curiosity > 0.7:
        labels.append("curious")
    if concern > 0.5:
        labels.append("concerned")
    if fatigue > 0.5:
        labels.append("tired")
    if not labels:
        return None

    return (
        f"INNER STATE: {', '.join(labels)} "
        f"(focus={focus:.1f} curiosity={curiosity:.1f} "
        f"concern={concern:.1f} fatigue={fatigue:.1f})"
    )


def _format_nearby_block(features: list[dict]) -> str | None:
    """Phase 9.4c-qw fix #3 — render top-N nearby OSM features."""
    if not features:
        return None
    lines = []
    for f in features[:5]:
        name = f.get("name") or ""
        if not name:
            continue
        ftype = f.get("type") or ""
        dist = f.get("distance_m")
        try:
            dist_i = int(dist)
        except (TypeError, ValueError):
            dist_i = 0
        type_part = f"{ftype}, " if ftype else ""
        lines.append(f"  • {name} ({type_part}{dist_i}m)")
    if not lines:
        return None
    return "NEARBY (within 500m):\n" + "\n".join(lines)


def _format_recent_places_block(
    places: list[tuple[str, datetime]] | None,
) -> str | None:
    if not places:
        return None
    lines = []
    for name, ts in places:
        try:
            stamp = ts.strftime("%H:%M %a")
        except Exception:
            stamp = "?"
        lines.append(f"  • {name} ({stamp})")
    return "RECENT PLACES (last 24h):\n" + "\n".join(lines)


def build_system_prompt(
    snapshot: dict[str, Any],
    user_dict: dict[str, Any],
    behavioral_model: dict[str, Any],
    memory_hints: list[str] | None = None,
    recent_places: list[tuple[str, datetime]] | None = None,
    emotion: dict | None = None,
) -> str:
    """
    Build the full dynamic system prompt for one AI turn.

    Args:
        snapshot:          ContextSnapshot dict (from ContextEngine).
        user_dict:         User fields: username, role, preferences.
        behavioral_model:  BehavioralModel dict (trust_level, honest_gap, …).
        memory_hints:      Top-K relevant facts from ChromaDB (optional override).

    Returns:
        Assembled system prompt string.
    """
    parts: list[str] = []

    # 1. Core identity
    parts.append(PHANTOM_IDENTITY)

    # 2. Current state behavior
    state: str = snapshot.get("system", {}).get("state", "SHADOW")
    parts.append(f"\nCURRENT STATE: {state}")
    parts.append(STATE_BEHAVIORS.get(state, STATE_BEHAVIORS["SHADOW"]))

    # 3. Tone adaptation (3 axes)
    tone: ToneVector = calculate_tone(snapshot, behavioral_model)
    parts.append(f"\nTONE: {tone.description}")

    # 4. User context
    username = user_dict.get("username", "unknown")
    role = user_dict.get("role", "GUEST")
    trust = behavioral_model.get("trust_level", 0.5)
    response_pref = behavioral_model.get("response_preference", "")
    parts.append(f"\nUSER: {username}, role={role}, trust={trust:.2f}")
    if response_pref:
        parts.append(f"PREFERENCE: {response_pref}")

    # Preferred language
    prefs: dict[str, Any] = user_dict.get("preferences", {})
    lang = prefs.get("language", "uk")
    if lang == "auto" or config.ai_response_language == "auto":
        parts.append("LANGUAGE: respond in the language the user writes to you")
    else:
        effective_lang = config.ai_response_language if config.ai_response_language != "auto" else lang
        parts.append(f"LANGUAGE: {effective_lang}")

    # 5. Memory hints
    hints = memory_hints if memory_hints is not None else snapshot.get("memory_hints", [])
    if hints:
        hints_str = "; ".join(hints[:5])
        parts.append(f"\nRELEVANT MEMORY: {hints_str}")

    # 5b. Recent visited places (Phase 9.4c-qw fix #2)
    recent_block = _format_recent_places_block(recent_places)
    if recent_block:
        parts.append("\n" + recent_block)

    # 6. Environment context
    when = snapshot.get("when", {})
    where = snapshot.get("where", {})
    body = snapshot.get("body", {})
    env = snapshot.get("env", {})

    parts.append(f"\nTIME: {when.get('time', '??:??')}, {when.get('day_of_week', '?')}")
    if when.get("is_night"):
        parts.append("(night mode — be minimal)")

    parts.append(_format_location_block(where))

    # Nearby OSM features (Phase 9.4c-qw fix #3)
    nearby_block = _format_nearby_block(snapshot.get("nearby") or [])
    if nearby_block:
        parts.append(nearby_block)

    bpm = body.get("breathing_bpm")
    stress = body.get("stress_level")
    if bpm is not None:
        stress_txt = f"{stress:.1f}" if stress is not None else "unknown"
        parts.append(f"BODY: breathing={bpm}bpm, stress={stress_txt}, state={body.get('breathing_state', '?')}")

    temp = env.get("temp_c")
    if temp is not None:
        parts.append(f"ENV: {temp:.1f}°C, aqi={env.get('aqi', '?')}")

    # 7. System status
    sys = snapshot.get("system", {})
    parts.append(
        f"\nSYSTEM: cpu={sys.get('cpu_percent', 0):.0f}%, "
        f"ram={sys.get('ram_percent', 0):.0f}%, "
        f"ai={sys.get('ai_provider', 'unknown')}"
    )

    # 7b. Emotion (Phase 9.4c-qw fix #5) — only when notably off baseline.
    emotion_block = _format_emotion_block(emotion)
    if emotion_block:
        parts.append("\n" + emotion_block)

    # 8. Extra prompt from user settings
    if config.ai_system_prompt_extra.strip():
        parts.append(f"\nEXTRA INSTRUCTIONS:\n{config.ai_system_prompt_extra.strip()}")

    # 9. Response-form guidance (Phase 9.5) — chat only. See personality.py.
    parts.append("\n" + RESPONSE_FORMS_GUIDANCE)

    # 10. Data-tool guidance (Phase 10) — chat only. Tells the model when
    # to reach for a CHAT_DATA_TOOLS function before picking a response
    # form. Appended LAST so it's the freshest instruction in context.
    parts.append("\n" + DATA_TOOLS_GUIDANCE)

    return "\n".join(parts)


def build_history_messages(
    session_messages: list[dict[str, Any]],
    max_turns: int = 20,
) -> list[dict[str, str]]:
    """
    Convert stored ChatMessages to provider-agnostic history format.
    Returns list of {"role": "user"|"assistant", "content": "..."}.
    Trims to last max_turns to stay within context window.
    """
    result: list[dict[str, str]] = []
    for msg in session_messages[-max_turns * 2:]:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            result.append({"role": role, "content": content})
    return result
