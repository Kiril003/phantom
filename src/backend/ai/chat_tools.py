"""
PHANTOM OS — Phase 10 chat data-tool catalog.

These are DATA-fetching tools the chat LLM can call BEFORE choosing a
response form. Distinct from `response_formatter.RESPONSE_FORM_TOOLS`
(which describe output shape).

Provider-agnostic JSON-Schema definitions. `gemini_provider` converts
them to `types.FunctionDeclaration`; Ollama consumes OpenAI-style tool
specs directly.
"""
from __future__ import annotations

from typing import Any

# ── Catalog ────────────────────────────────────────────────────────────────────

CHAT_DATA_TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_locationhistory",
        "description": (
            "Знайти місця де був юзер у минулому. Використовуй для запитів "
            "'де я був вчора', 'куди я ходив', 'коли був у VSB'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "hours_ago": {
                    "type": "integer",
                    "description": "Скільки годин назад дивитися (1..720). За замовчуванням 24.",
                },
                "query": {
                    "type": "string",
                    "description": "Опціональний фільтр по підрядку у назві місця (place_name ILIKE %query%).",
                },
            },
            "required": [],
        },
    },
    {
        "name": "query_temporal_anchors",
        "description": (
            "Знайти моменти у минулому за станом/настроєм/часовим вікном. "
            "Для запитів 'коли я нервував', 'що робив у FOCUS', 'коли був схвильований'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "state": {
                    "type": "string",
                    "enum": ["SHADOW", "FOCUS", "DIALOGUE", "SENTINEL", "GHOST", "DREAM"],
                    "description": "Фільтр по стану системи.",
                },
                "mood": {
                    "type": "string",
                    "description": "Підрядок настрою (наприклад 'стрес', 'спокій', 'тривога').",
                },
                "hours_ago": {
                    "type": "integer",
                    "description": "Часове вікно у годинах назад (1..720). За замовчуванням 168 (тиждень).",
                },
            },
            "required": [],
        },
    },
    {
        "name": "recall_memory_facts",
        "description": (
            "Семантичний пошук у памʼяті юзера через ChromaDB. Для запитів "
            "'що ти знаєш про X', 'памʼятаєш коли я...', 'факти про роботу'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Текст запиту для семантичного пошуку.",
                },
                "layer": {
                    "type": "string",
                    "enum": ["tactical", "strategic", "archive"],
                    "description": "Шар памʼяті. Опційно; за замовчуванням — всі шари.",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_system_metrics",
        "description": (
            "Поточні метрики Radxa: CPU, RAM, диск, uptime, load average. "
            "Після виклику цього інструменту зазвичай повертай respond_metrics."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_sensor_status",
        "description": (
            "Поточні показники сенсорів: радар, камера, оточення, GPS, батарея. "
            "Для запитів 'хто поруч', 'температура зараз', 'GPS працює'."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "search_web",
        "description": (
            "Пошук актуальної інформації у вебі через Google Search grounding. "
            "Для запитів 'новини', 'хто така X', 'знайди інформацію про Y'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Пошуковий запит.",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_calendar_events",
        "description": (
            "Події календаря у заданому діапазоні. date_range: "
            "'today', 'tomorrow', 'this_week', 'next_week', 'YYYY-MM-DD' "
            "або 'YYYY-MM-DD..YYYY-MM-DD'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "date_range": {
                    "type": "string",
                    "description": "Діапазон дат. Див. опис.",
                },
            },
            "required": ["date_range"],
        },
    },
    {
        "name": "create_calendar_event",
        "description": (
            "Створити нову подію у календарі. ВАЖЛИВО: коли юзер дає контекст "
            "(чому подія, що робити, з ким, деталі) — клади його у поле `notes`, "
            "а не розчиняй у title. title — коротка мітка (2-6 слів), "
            "notes — повний опис / причина / обіцянка. "
            "Час ('завтра', 'сьогодні', '18:00') інтерпретується у локальному "
            "часовому поясі користувача. "
            "start_at: ISO 8601 або природна форма: 'завтра 14:00', "
            "'сьогодні 18:30', '2026-04-25 10:00'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Коротка назва події (2-6 слів), без зайвого контексту.",
                },
                "start_at": {
                    "type": "string",
                    "description": "Початок: ISO 8601 або природна мова (локальний час юзера).",
                },
                "end_at": {
                    "type": "string",
                    "description": "Кінець (опційно). Якщо не задано — +1 година від start_at.",
                },
                "notes": {
                    "type": "string",
                    "description": (
                        "Повний опис / деталі / контекст / причина події. "
                        "Обов'язково заповнюй, якщо юзер надав будь-який контекст "
                        "окрім мінімальної назви."
                    ),
                },
            },
            "required": ["title", "start_at"],
        },
    },
]


DATA_TOOL_NAMES: frozenset[str] = frozenset(t["name"] for t in CHAT_DATA_TOOLS)


def get_tool_schema(name: str) -> dict[str, Any] | None:
    """Return the schema dict for a tool by name, or None if unknown."""
    for tool in CHAT_DATA_TOOLS:
        if tool["name"] == name:
            return tool
    return None


__all__ = [
    "CHAT_DATA_TOOLS",
    "DATA_TOOL_NAMES",
    "get_tool_schema",
]
