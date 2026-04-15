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

    if where.get("fix"):
        place = where.get("place_name") or f"({where['lat']:.4f}, {where['lon']:.4f})"
        parts.append(f"LOCATION: {place}, speed={where.get('speed_kmh', 0):.1f}km/h")
    else:
        parts.append("LOCATION: unknown (no GPS fix)")

    bpm = body.get("breathing_bpm")
    stress = body.get("stress_level", 0.3)
    if bpm is not None:
        parts.append(f"BODY: breathing={bpm}bpm, stress={stress:.1f}, state={body.get('breathing_state', '?')}")

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
