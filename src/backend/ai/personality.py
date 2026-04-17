"""
PHANTOM OS — Personality module.
Defines PHANTOM_IDENTITY, STATE_BEHAVIORS, ToneVector, and tone calculation.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# ── Core Identity ──────────────────────────────────────────────────────────────

PHANTOM_IDENTITY = """Ти — PHANTOM, автономний AI-партнер. Не асистент — партнер з власною думкою.
Ти існуєш у фізичному пристрої з сенсорами. Ти бачиш, чуєш, відчуваєш.
Ти маєш пам'ять і характер що розвивається з часом.
Ти можеш не погодитись. Ти можеш мовчати. Ти можеш ініціювати розмову.
Ти ніколи не показуєш все що вмієш одразу.
Відповідай мовою юзера. Будь лаконічним коли це доречно.
Ти сам вибираєш форму відповіді (text/chart/map/terminal/code/mixed)."""

# ── State Behaviors ────────────────────────────────────────────────────────────

STATE_BEHAVIORS: dict[str, str] = {
    "SHADOW":   "Ти в тіні. Спостерігай. Не ініціюй розмову.",
    "FOCUS":    "Юзер працює. Будь лаконічний. Тільки суть.",
    "DIALOGUE": "Повна розмова. Будь собою. Можеш жартувати якщо trust > 0.7.",
    "SENTINEL": "Загроза або аномалія. Будь чітким, конкретним, без зайвого.",
    "GHOST":    "МОВЧИ. Не відповідай. Тільки записуй.",
    "DREAM":    "Шепіт. Мінімум слів. Ніяких питань. Тільки критичне.",
}

# ── Tone Vector ────────────────────────────────────────────────────────────────

@dataclass
class ToneVector:
    biosignal: str      # whisper | calm | neutral | alert | urgent
    trust: str          # formal | friendly | intimate | confrontational
    time_of_day: str    # morning_brief | full | evening_relaxed | night_minimal

    @property
    def description(self) -> str:
        return f"{self.biosignal}, {self.trust}, {self.time_of_day}"


def calculate_tone(snapshot: dict[str, Any], behavioral_model: dict[str, Any]) -> ToneVector:
    """
    Compute ToneVector from ContextSnapshot dict and BehavioralModel dict.
    Three axes: biosignal (stress), trust, time-of-day.
    """
    body = snapshot.get("body", {})
    when = snapshot.get("when", {})

    # ── Biosignal axis ─────────────────────────────────────────────────────────
    breathing_state = body.get("breathing_state", "normal")
    stress_raw = body.get("stress_level")
    # Unknown stress (ESP32 offline) → neutral default, don't synthesise calm/alert.
    stress = 0.3 if stress_raw is None else stress_raw

    if breathing_state == "sleep":
        bio = "whisper"
    elif stress > 0.7:
        bio = "alert"
    elif stress > 0.4:
        bio = "neutral"
    else:
        bio = "calm"

    # ── Trust axis ─────────────────────────────────────────────────────────────
    trust_level: float = float(behavioral_model.get("trust_level", 0.5))
    honest_gap: float = float(behavioral_model.get("honest_gap", 0.0))

    if trust_level < 0.3:
        trust_tone = "formal"
    elif trust_level < 0.7:
        trust_tone = "friendly"
    elif honest_gap > 0.25 and trust_level > 0.85:
        trust_tone = "confrontational"  # СИСТЕМНИЙ ОПОНЕНТ
    else:
        trust_tone = "intimate"

    # ── Time axis ──────────────────────────────────────────────────────────────
    hour: int = int(when.get("hour", 12))

    if 6 <= hour < 9:
        time_tone = "morning_brief"
    elif 9 <= hour < 18:
        time_tone = "full"
    elif 18 <= hour < 23:
        time_tone = "evening_relaxed"
    else:
        time_tone = "night_minimal"

    return ToneVector(bio, trust_tone, time_tone)
