"""
PHANTOM OS — Prompt Builder.
Assembles the dynamic system prompt from ContextSnapshot, user preferences,
behavioral model, and memory hints.
"""
from __future__ import annotations

from typing import Any

from config import config
from ai.personality import (
    PHANTOM_IDENTITY,
    STATE_BEHAVIORS,
    ToneVector,
    calculate_tone,
)


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


def build_system_prompt(
    snapshot: dict[str, Any],
    user_dict: dict[str, Any],
    behavioral_model: dict[str, Any],
    memory_hints: list[str] | None = None,
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

    # 6. Environment context
    when = snapshot.get("when", {})
    where = snapshot.get("where", {})
    body = snapshot.get("body", {})
    env = snapshot.get("env", {})

    parts.append(f"\nTIME: {when.get('time', '??:??')}, {when.get('day_of_week', '?')}")
    if when.get("is_night"):
        parts.append("(night mode — be minimal)")

    parts.append(_format_location_block(where))

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

    # 8. Extra prompt from user settings
    if config.ai_system_prompt_extra.strip():
        parts.append(f"\nEXTRA INSTRUCTIONS:\n{config.ai_system_prompt_extra.strip()}")

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
