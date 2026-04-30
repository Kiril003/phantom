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
    # ── Phase-6 T2 — extended tool schemas (audit-2026-04-30) ──────────────
    # Each maps 1:1 to a handler in tool_executor._HANDLERS. Descriptions
    # in Ukrainian + English so Gemini picks them on either-language input.
    {
        "name": "create_timer",
        "description": (
            "Створити одноразовий таймер. Викликай коли юзер каже «постав таймер X хвилин/годин» "
            "або «нагадай через X». duration_s у секундах (1..86400). label — коротка причина."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "label": {"type": "string", "description": "Коротка назва таймера."},
                "duration_s": {"type": "integer", "description": "Тривалість у секундах (1..86400)."},
            },
            "required": ["duration_s"],
        },
    },
    {
        "name": "cancel_timer",
        "description": "Скасувати активний таймер за id.",
        "parameters": {
            "type": "object",
            "properties": {"timer_id": {"type": "string"}},
            "required": ["timer_id"],
        },
    },
    {
        "name": "list_timers",
        "description": "Отримати список активних таймерів користувача.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "create_alarm",
        "description": (
            "Створити будильник на конкретний час доби. time у форматі HH:MM (24h). "
            "repeat = 'once' | 'daily' | 'weekdays'. label — необов'язково."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "time": {"type": "string", "description": "HH:MM 24h."},
                "repeat": {
                    "type": "string",
                    "enum": ["once", "daily", "weekdays"],
                    "description": "Періодичність.",
                },
                "label": {"type": "string"},
            },
            "required": ["time"],
        },
    },
    {
        "name": "delete_alarm",
        "description": "Видалити будильник за id (повністю).",
        "parameters": {
            "type": "object",
            "properties": {"alarm_id": {"type": "string"}},
            "required": ["alarm_id"],
        },
    },
    {
        "name": "set_alarm_active",
        "description": "Увімкнути/вимкнути будильник без видалення.",
        "parameters": {
            "type": "object",
            "properties": {
                "alarm_id": {"type": "string"},
                "active": {"type": "boolean"},
            },
            "required": ["alarm_id", "active"],
        },
    },
    {
        "name": "list_alarms",
        "description": "Отримати список усіх будильників користувача (активних і неактивних).",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "update_calendar_event",
        "description": (
            "Оновити існуючу подію календаря. Усі поля окрім event_id опційні — "
            "передавай лише ті що змінюються."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "event_id": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "start_at": {"type": "string", "description": "ISO 8601 або природна мова."},
                "end_at": {"type": "string"},
                "all_day": {"type": "boolean"},
                "location": {"type": "string"},
            },
            "required": ["event_id"],
        },
    },
    {
        "name": "delete_calendar_event",
        "description": "Видалити подію календаря за id.",
        "parameters": {
            "type": "object",
            "properties": {"event_id": {"type": "string"}},
            "required": ["event_id"],
        },
    },
    {
        "name": "query_audit_log",
        "description": (
            "Прочитати останні N записів agent_audit. Фільтр action_name опційний "
            "(наприклад 'sandbox.session.started' або 'chat.respond'). "
            "Викликай коли юзер питає «що ти робив», «остання дія», «чому ти це зробив»."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "1..200, default 20."},
                "action_name": {"type": "string"},
            },
            "required": [],
        },
    },
    {
        "name": "query_wardriving",
        "description": (
            "Останні WiFi/BLE wardriving-записи. ssid_substr — пошук підрядком у SSID. "
            "Викликай коли юзер питає «які мережі поряд», «чи бачив SSID X»."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "1..500, default 50."},
                "ssid_substr": {"type": "string"},
            },
            "required": [],
        },
    },
    {
        "name": "list_files",
        "description": (
            "Перелік файлів у директорії всередині дозволеного дерева "
            "(домашня тека / /tmp / /opt/phantom). path = None → домівка."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Абсолютний або ~/ префікс."},
                "limit": {"type": "integer", "description": "1..200, default 50."},
            },
            "required": [],
        },
    },
    {
        "name": "read_file",
        "description": (
            "Прочитати файл усередині дозволеного дерева. Ліміт 1 МіБ — "
            "більше повертається з truncated=True. Повертає kind='text' "
            "з content або kind='binary' з content_base64."
        ),
        "parameters": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "search_files",
        "description": (
            "Пошук файлів за підрядком у назві всередині дозволеного "
            "дерева. Повертає top-N збігів за mtime."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "root": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "write_file",
        "description": (
            "Записати UTF-8 текстовий файл у дозволеному дереві. Ліміт 5 МіБ. "
            "За замовч. перезаписує існуючий — встанови overwrite=false щоб уникнути."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
                "overwrite": {"type": "boolean"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "make_directory",
        "description": "Створити нову директорію в дозволеному дереві. Ідемпотентна.",
        "parameters": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "create_checkpoint",
        "description": (
            "Створити чекпойнт стану системи. reason ∈ "
            "{manual, auto_reflect, pause, shutdown}. goal — короткий опис чому. "
            "Викликай коли юзер каже «збережи стан», «зроби бекап», «запам'ятай це»."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "enum": ["manual", "auto_reflect", "pause", "shutdown"],
                },
                "goal": {"type": "string"},
            },
            "required": ["goal"],
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
