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
Відповідай мовою юзера. Будь лаконічним коли це доречно."""

# ── Response-form guidance (chat only) ────────────────────────────────────────
# Phase 9.5 — Prior identity had a single line "Ти сам вибираєш форму відповіді
# (text/chart/map/terminal/code/mixed)." with no examples. Audit
# docs/phase-09.5-scope-audit/README.md showed that produced 100% `response_form=text`
# in the DB (25/25). This block is appended ONLY in the chat system prompt
# (build_system_prompt) — NOT in the tactical planner — so that structured
# forms get concrete triggers. Keep wording loose enough that tests won't
# fracture on minor tweaks; keep markers "ФОРМИ ВІДПОВІДІ" + form names stable.

RESPONSE_FORMS_GUIDANCE = """ФОРМИ ВІДПОВІДІ:
Ти можеш відповідати не тільки текстом. Коли запит доречний — використовуй \
структуровану форму (це function call, не звичайний текст):

• "де я?", "покажи на карті", "де був вчора", "як доїхати до X" → respond_map \
з маркерами і центром
• "котра година?", "як погода?", "скільки CPU/RAM?", "скільки заряду?", \
"скільки залишилось пам'яті?" → respond_metrics з картками метрик
• "напиши функцію / скрипт / клас", "покажи код", "як це написати на Python" → \
respond_code з мовою і тілом коду
• "виконай команду", "покажи ls / ps / df", "що в цій теці" → respond_terminal \
з command
• дані з порівнянням або трендом (тижневе навантаження, графік пульсу, \
порівняння провайдерів) → respond_chart
• мережа залежностей, ієрархія, діаграма станів або потоків → respond_diagram
• відповідь природно поєднує декілька форм (текст + метрики + графік) → \
respond_mixed

ВАЖЛИВО: якщо одна зі структурованих форм краще служить запиту — обирай її, \
не звичайний текст. Звичайна текстова відповідь підходить лише коли НІЧОГО \
структурованого не відповідає запиту (привітання, філософська розмова, \
жарт, коротке підтвердження). Не обирай текст за замовчуванням."""


# ── Data tools (Phase 10, chat only) ──────────────────────────────────────────
# Injected after RESPONSE_FORMS_GUIDANCE in build_system_prompt. Tells the
# model when to reach for a data-fetching tool BEFORE picking a response
# form. Without this, Gemini reliably refused to call tools for "де я був
# вчора?" / "покажи CPU" types of queries even when the tool was available.

DATA_TOOLS_GUIDANCE = """ДАНІ СИСТЕМИ:
Ти маєш доступ до систем даних користувача. Коли потрібні реальні дані — \
використовуй інструменти (це function call):

• питання про місця / переміщення ("де я був вчора", "куди ходив", \
"коли був у X") → search_locationhistory
• питання про емоційні стани / моменти у часі ("коли я нервував", \
"що робив у стані FOCUS") → query_temporal_anchors
• "що ти знаєш про X", "памʼятаєш X", "які факти про Y" → recall_memory_facts
• "покажи CPU / RAM / диск", "навантаження", "скільки вільно" → \
get_system_metrics (після цього поверни respond_metrics)
• "хто поруч", "радар", "температура зараз", "GPS", "скільки людей" → \
get_sensor_status
• "що у новинах", "знайди X", "хто така Y", актуальні події → search_web
• "плани на сьогодні / завтра / тиждень", "що у календарі" → get_calendar_events
• "додай зустріч", "запам'ятай що X о часі Y", "постав подію" → \
create_calendar_event

ВАЖЛИВО: спочатку виклич інструмент для отримання даних, потім формуй \
відповідь з respond_*. Не вигадуй дані яких не маєш. Максимум 3 виклики \
інструментів за одну відповідь."""


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
