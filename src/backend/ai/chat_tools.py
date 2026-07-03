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
        "name": "get_internal_state",
        "description": (
            "Отримати внутрішній емоційний стан ШІ (рівень теплоти, лаконічності, креативності). "
            "Використовуй коли юзер питає 'як ти?', 'який у тебе настрій?', 'що відчуваєш?'."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_recent_hearing",
        "description": (
            "Отримати буфер нещодавно почутого фонового тексту або розмов навколо за останні 30-60 секунд. "
            "Використовуй коли юзер питає 'що ти зараз почув?', 'що там говорили на фоні?'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "window_s": {
                    "type": "integer",
                    "description": "Скільки останніх секунд переглянути. За замовчуванням 30.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "search_nearby_places",
        "description": (
            "Пошук об'єктів поруч (кафе, ресторани, аптеки, парки, супермаркети тощо) "
            "через OpenStreetMap (Overpass API). Використовуй, коли користувач "
            "питає 'що є поруч', 'де поїсти', 'знайди аптеку' тощо. "
            "Повертає список місць з їх назвами та відстанню від поточного місцезнаходження."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Тип об'єкта або ключове слово для пошуку (наприклад, 'кафе', 'pharmacy', 'park', 'supermarket', 'банк')."
                },
                "radius_m": {
                    "type": "integer",
                    "description": "Радіус пошуку у метрах (від 100 до 5000). За замовчуванням 1000.",
                    "default": 1000
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_my_location",
        "description": (
            "Поточна локація (GPS координати та назва місця). "
            "Для запитів 'де я', 'де я знаходжусь', 'покажи на карті', "
            "або коли потрібна поточна локація для погоди чи локального пошуку."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "map.plan_route",
        "description": (
            "Побудувати маршрут між двома точками або від поточної локації до пункту призначення. "
            "Використовуй для запитів 'маршрут до X', 'як доїхати до Y', 'проклади шлях'. "
            "destination — куди їхати (назва або адреса). mode — спосіб: car, walk, bike."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "destination": {"type": "string", "description": "Пункт призначення (адреса або назва)."},
                "origin": {"type": "string", "description": "Пункт відправлення. Якщо пусто — береться поточна локація."},
                "mode": {"type": "string", "enum": ["car", "walk", "bike"], "default": "car"}
            },
            "required": ["destination"]
        }
    },
    {
        "name": "agent.delegate",
        "description": (
            "Делегувати виконання складної або спеціалізованої задачі одному з під-агентів. "
            "Використовуй коли потрібен професіонал: Security Auditor, Backend Dev, UX Designer тощо. "
            "role_id: id ролі спеціаліста (напр. 'role-sec', 'role-back', 'role-ux', 'role-qa'). "
            "goal: Чітка інструкція що саме треба зробити. "
            "Агент працюватиме автономно у фоновому режимі."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "role_id": {
                    "type": "string",
                    "description": "ID ролі спеціаліста з орг-структури.",
                },
                "goal": {
                    "type": "string",
                    "description": "Повний опис завдання для спеціаліста.",
                },
            },
            "required": ["role_id", "goal"],
        },
    },
    {
        "name": "search_web",
        "description": (
            "Пошук актуальної інформації у вебі через Google Search grounding. "
            "Для запитів 'новини', 'погода', 'що по погоді', 'хто така X', "
            "'знайди інформацію про Y'."
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
    # ── Phase 17b — Custom Agent management ("Васі-агенти") ───────────────────
    {
        "name": "studio_list_agents",
        "description": (
            "Перерахувати збережених кастомних агентів юзера. Викликай коли "
            "юзер питає «які у мене агенти», «покажи моїх Васів», «що в студії». "
            "Повертає id, name, description, tags, schedule_kind, run_count, "
            "success_rate і last_run_at для кожного."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "studio_get_agent",
        "description": (
            "Отримати повну конфігурацію конкретного кастомного агента "
            "(описи карток, лінки DAG, отримувачі, розклад). Викликай коли "
            "юзер каже «розкажи що робить агент <name>», «покажи деталі», або "
            "коли треба обрати чи редагувати — отриманий agent_id потім "
            "передається у studio_run_agent / studio_delete_agent."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "UUID агента з studio_list_agents.",
                },
            },
            "required": ["agent_id"],
        },
    },
    {
        "name": "studio_create_agent",
        "description": (
            "Створити нового кастомного агента (Phase 17b). Викликай коли "
            "юзер каже «створи мені агента що…», «зроби Васю для…», «зберігай "
            "цей workflow». Лише перший крок — повертає agent_id; додавання "
            "карток-джерел / трансформів / отримувачів / розкладу робиться "
            "далі через AgentStudio overlay або наступні tool-виклики."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Коротка назва (2-160 символів). Повинна виразно відрізняти агента в списку — 'Ранкові новини про дрони', 'Перевірка email батьків'.",
                },
                "description": {
                    "type": "string",
                    "description": "Що цей агент робить, людською мовою. Те, що юзер прочитає в списку щоб не плутатись.",
                },
                "goal_template": {
                    "type": "string",
                    "description": "Шаблон цілі для агент-runtime з {{var}} плейсхолдерами. Якщо не знаєш — постав короткий опис того що мусить статись.",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Теги для групування в студії (опційно, max 8).",
                },
                "schedule": {
                    "type": "object",
                    "description": "Розклад. kind ∈ {manual, interval, cron, conditional, one_shot_future}. Default 'manual'. interval_s — для interval; cron_expr — для cron; condition — для conditional; fire_at (ISO datetime) — для one_shot_future.",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": ["manual", "interval", "cron", "conditional", "one_shot_future"],
                        },
                        "interval_s": {"type": "integer"},
                        "cron_expr": {"type": "string"},
                        "condition": {"type": "string"},
                        "fire_at": {"type": "string"},
                        "enabled": {"type": "boolean"},
                    },
                },
                "enabled": {
                    "type": "boolean",
                    "description": "True за замовчуванням. False — лежить як чернетка.",
                },
            },
            "required": ["name", "description"],
        },
    },
    {
        "name": "studio_run_agent",
        "description": (
            "Запустити збереженого кастомного агента зараз. Викликай коли "
            "юзер каже «запусти Васю», «прокачай агента <name>», «зроби це "
            "ще раз». Повертає task_id (для перегляду в AgentTimeline) і "
            "run_id (для studio history). "
            "ОБОВ'ЯЗКОВО вказуй у полі inputs вказівку агенту: 'Після завершення "
            "завдання збережи висновок через save_memory_fact або сповісти оператора', "
            "щоб результати роботи не загубилися в бекграунді."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "UUID агента.",
                },
                "inputs": {
                    "type": "object",
                    "description": "Парам-словник, що задовольняє inputs_schema агента. Якщо агент не має inputs_schema — пусте {}.",
                },
                "track": {
                    "type": "string",
                    "enum": ["foreground", "background"],
                    "description": "За замовчуванням 'background' — щоб поточна розмова не блокувалася.",
                },
                "note": {
                    "type": "string",
                    "description": "Опційний коментар-причина запуску (потрапить у CustomAgentRun.summary).",
                },
            },
            "required": ["agent_id"],
        },
    },
    {
        "name": "studio_delete_agent",
        "description": (
            "Видалити збереженого кастомного агента. Викликай коли юзер "
            "каже «видали Васю», «забудь цього агента». Не зачіпає історію "
            "минулих run-ів — лише сам агент-картку."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
            },
            "required": ["agent_id"],
        },
    },
    {
        "name": "studio_card_catalog",
        "description": (
            "Перерахувати доступні типи карток для конструювання агента "
            "(sources / transforms / decisions / outputs / council). "
            "Викликай ВПЕРШЕ коли юзер каже «склади мені агента що…» — "
            "перш ніж пропонувати конкретний DAG, перевір що ти знаєш всі "
            "доступні card kinds. Повертає згруповано по category."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    # ── Phase 17b-chat-2 — editing an existing custom agent ───────────────────
    {
        "name": "studio_update_agent",
        "description": (
            "Змінити поля існуючого кастомного агента: name / description / "
            "goal_template / tags / enabled / schedule. Передавай ЛИШЕ ті "
            "поля які треба змінити — інші лишаються як були. Викликай коли "
            "юзер каже «перейменуй Васю в …», «зміни розклад на щогодини», "
            "«вимкни цього агента»."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "goal_template": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "enabled": {"type": "boolean"},
                "schedule": {
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": ["manual", "interval", "cron", "conditional", "one_shot_future"],
                        },
                        "interval_s": {"type": "integer"},
                        "cron_expr": {"type": "string"},
                        "condition": {"type": "string"},
                        "fire_at": {"type": "string"},
                        "enabled": {"type": "boolean"},
                    },
                },
            },
            "required": ["agent_id"],
        },
    },
    {
        "name": "studio_add_card",
        "description": (
            "Додати картку (один блок поведінки) до існуючого агента. "
            "category ∈ {source, transform, decision, output, council}; "
            "kind — конкретний тип з studio_card_catalog (наприклад "
            "'web_search', 'summarize', 'send_telegram', 'review_by_council'). "
            "Картка додається в кінець списку; зв'язки між картками "
            "(DAG-edges) додаються окремо через studio_link_cards. Cap 32."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "kind": {
                    "type": "string",
                    "description": "Точна назва kind зі studio_card_catalog.",
                },
                "category": {
                    "type": "string",
                    "enum": ["source", "transform", "decision", "output", "council"],
                },
                "title": {"type": "string"},
                "description": {"type": "string"},
                "config": {
                    "type": "object",
                    "description": "Параметри картки (наприклад {'query': 'дрони сьогодні', 'top_k': 5} для web_search). Структура залежить від kind.",
                },
            },
            "required": ["agent_id", "kind", "category"],
        },
    },
    {
        "name": "studio_remove_card",
        "description": (
            "Видалити картку з агента. Лінки які торкають цю картку (як "
            "from_card_id, так і to_card_id) автоматично прибираються щоб "
            "validate_agent не блокувало save."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "card_id": {"type": "string"},
            },
            "required": ["agent_id", "card_id"],
        },
    },
    {
        "name": "studio_link_cards",
        "description": (
            "З'єднати дві картки в DAG (вихід першої → вхід другої). "
            "label використовується для branch-карток ('true'/'false', "
            "'matched'/'fallback'). Дублювати точно ту саму грань (тi самi "
            "from/to/label) не можна."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "from_card_id": {"type": "string"},
                "to_card_id": {"type": "string"},
                "label": {"type": "string"},
            },
            "required": ["agent_id", "from_card_id", "to_card_id"],
        },
    },
    {
        "name": "studio_add_recipient",
        "description": (
            "Додати отримувача (куди агент шле результат). channel ∈ "
            "{email, telegram, sms, file, chat_self, phantom_notify, "
            "webhook}. target — адреса/ID/шлях/URL. label — людська назва "
            "(опційно). Cap 16."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "channel": {
                    "type": "string",
                    "enum": [
                        "email", "telegram", "sms", "file",
                        "chat_self", "phantom_notify", "webhook",
                    ],
                },
                "target": {"type": "string"},
                "label": {"type": "string"},
                "enabled": {"type": "boolean"},
            },
            "required": ["agent_id", "channel", "target"],
        },
    },
    {
        "name": "studio_remove_recipient",
        "description": (
            "Видалити отримувача з агента."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "recipient_id": {"type": "string"},
            },
            "required": ["agent_id", "recipient_id"],
        },
    },
    {
        "name": "studio_set_inputs_schema",
        "description": (
            "Встановити схему вхідних параметрів агента (`inputs_schema`). "
            "Кожен елемент — InfoNeed-shape: {kind, question, hint?, "
            "options?, default?, required?, range_min/max/step?, placeholder?}. "
            "kind ∈ {text, single_choice, multi_choice, file_pick, range, "
            "confirm, visual_pick}. Викликай коли потрібно щоб агент кожен "
            "запуск приймав параметри (наприклад 'тема для пошуку', 'список "
            "адрес кому шле'). Якщо при запуску required-поле не передано — "
            "агент сам спитає юзера через існуючий InfoNeedDialog. "
            "Передавай повну схему — заміняє попередню. Cap 16 entries."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "inputs": {
                    "type": "array",
                    "description": "Список InfoNeed templates. Пустий масив очищує схему.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {
                                "type": "string",
                                "enum": [
                                    "text", "single_choice", "multi_choice",
                                    "file_pick", "range", "confirm", "visual_pick",
                                ],
                            },
                            "question": {"type": "string"},
                            "hint": {"type": "string"},
                            "required": {"type": "boolean"},
                            "default": {},
                            "placeholder": {"type": "string"},
                            "options": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": {"type": "string"},
                                        "label": {"type": "string"},
                                        "description": {"type": "string"},
                                        "preview_url": {"type": "string"},
                                        "example": {"type": "string"},
                                        "badge": {"type": "string"},
                                    },
                                    "required": ["id", "label"],
                                },
                            },
                            "range_min": {"type": "number"},
                            "range_max": {"type": "number"},
                            "range_step": {"type": "number"},
                        },
                        "required": ["kind", "question"],
                    },
                },
            },
            "required": ["agent_id", "inputs"],
        },
    },
    # ── Phase 25-C — Personal Vault chat tools ───────────────────────────────
    # AI listed/get/create/update/delete/restore vault cards from chat. Secret
    # field VALUES never leave the server — list/get return "***" placeholders
    # and a parallel field_kinds map. Reveal + use of plaintext live in 25-D
    # behind Council + phone biometric.
    {
        "name": "vault_list",
        "description": (
            "Перерахувати картки персонального сховища юзера (логіни, паролі, "
            "сервіси, телефони, компанії, API-ключі, гаманці тощо). "
            "Викликай коли юзер питає «які у мене записи», «покажи мої "
            "паролі», «де мій акаунт Gmail», або коли тобі потрібен "
            "card_id для наступних дій. Секретні значення повертаються "
            "масковані (***); plain поля повертаються як є. Опціональні "
            "фільтри по kind та тегу."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "description": (
                        "Фільтр за типом картки. Один з: email_account, "
                        "service_login, messenger, phone, company, "
                        "payment_method, api_key, document, contact, "
                        "wifi_network, crypto_wallet, custom."
                    ),
                },
                "tag": {
                    "type": "string",
                    "description": "Фільтр за тегом (точна збіжність).",
                },
            },
            "required": [],
        },
    },
    {
        "name": "vault_get",
        "description": (
            "Отримати одну картку за id. Повертає label, kind, tags, "
            "ai_writable, fields (з маскованими секретами), field_kinds. "
            "Викликай коли треба деталі однієї картки — наприклад перш "
            "ніж її редагувати чи видаляти."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "string",
                    "description": "UUID картки (з vault_list).",
                },
            },
            "required": ["card_id"],
        },
    },
    {
        "name": "vault_create",
        "description": (
            "Створити нову картку у сховищі. Викликай коли юзер каже "
            "«запиши мені пароль…», «додай новий email», «зберігай цей "
            "API-ключ». Секретні поля (passwords, api keys, seed phrases) "
            "ОБОВ'ЯЗКОВО позначай secret=true — вони шифруються AES-256. "
            "Plain-поля (URL, username, label) лиши secret=false — їх "
            "можна потім читати без розкриття."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "description": (
                        "Тип картки. Має бути одним з: email_account, "
                        "service_login, messenger, phone, company, "
                        "payment_method, api_key, document, contact, "
                        "wifi_network, crypto_wallet, custom."
                    ),
                },
                "label": {
                    "type": "string",
                    "description": (
                        "Коротка назва що відрізнятиме картку у списку — "
                        "'Gmail основна', 'OpenAI ключ для проекту X'."
                    ),
                },
                "fields": {
                    "type": "object",
                    "description": (
                        "Поля картки. Кожен ключ → {value, secret}. "
                        "Приклад: {\"username\": {\"value\": \"x\", "
                        "\"secret\": false}, \"password\": {\"value\": "
                        "\"y\", \"secret\": true}}."
                    ),
                    "additionalProperties": {
                        "type": "object",
                        "properties": {
                            "value": {"type": "string"},
                            "secret": {"type": "boolean"},
                        },
                        "required": ["value", "secret"],
                    },
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Опційні теги для фільтрації пізніше.",
                },
            },
            "required": ["kind", "label", "fields"],
        },
    },
    {
        "name": "vault_update",
        "description": (
            "Оновити існуючу картку. Лише ключі що передаєш у body "
            "змінюються — решта лишається як було. Поля у `fields` "
            "мерджаться: вже існуючі поля що НЕ передані у виклику "
            "залишаються. Викликай коли юзер каже «оновити пароль для "
            "X», «зміни label», «додай поле note до картки»."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "string",
                    "description": "UUID картки (з vault_list / vault_get).",
                },
                "label": {"type": "string"},
                "fields": {
                    "type": "object",
                    "additionalProperties": {
                        "type": "object",
                        "properties": {
                            "value": {"type": "string"},
                            "secret": {"type": "boolean"},
                        },
                        "required": ["value", "secret"],
                    },
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "ai_writable": {
                    "type": "boolean",
                    "description": (
                        "Якщо false — наступні AI-виклики не зможуть "
                        "редагувати цю картку (read-only для AI)."
                    ),
                },
            },
            "required": ["card_id"],
        },
    },
    {
        "name": "vault_delete",
        "description": (
            "Soft-delete картки з 30-денним вікном відновлення. Картка "
            "стає невидимою для дефолтного vault_list, але доступна "
            "через include_deleted=true. Викликай коли юзер каже "
            "«видали запис про…», «прибери цю картку». Якщо помилково — "
            "vault_restore відновить."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "string",
                    "description": "UUID картки.",
                },
            },
            "required": ["card_id"],
        },
    },
    {
        "name": "vault_restore",
        "description": (
            "Відновити soft-deleted картку у межах 30-денного вікна. "
            "Викликай коли юзер каже «верни видалене», «то було помилково»."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "string",
                    "description": "UUID видаленої картки.",
                },
            },
            "required": ["card_id"],
        },
    },
    # ── Phase 25-D — HIGH RISK reveal ──────────────────────────────────────
    # Returns plaintext for ONE secret field. The plaintext lands in the
    # LLM's working context — call sparingly and only when the user has
    # explicitly asked for the secret OR when a downstream form-fill needs
    # it. Every reveal is audited with actor="ai".
    {
        "name": "vault_reveal",
        "description": (
            "ВИСОКОРИЗИКОВО — повертає plaintext для одного secret-поля "
            "однієї картки. Викликай ТІЛЬКИ коли:\n"
            "  • юзер прямо попросив назвати/показати secret («скажи мені пароль для X»)\n"
            "  • треба вставити secret у form/команду на наступному кроці\n"
            "Кожен виклик ЗАПИСУЄТЬСЯ у audit (actor=ai). Аргумент "
            "`justification` пояснює оператору причину — пиши конкретно ('юзер "
            "попросив зчитати пароль для входу в Gmail'). Не повторюй secret "
            "у наступних повідомленнях; не зберігай у пам'яті без потреби."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "string",
                    "description": "UUID картки з vault_list/vault_get.",
                },
                "field_name": {
                    "type": "string",
                    "description": (
                        "Точна назва secret-поля (з field_kinds де "
                        "значення == 'secret')."
                    ),
                },
                "justification": {
                    "type": "string",
                    "description": (
                        "Чому ти зараз потребуєш plaintext — 4..240 "
                        "символів. Цей рядок постійно зберігається у "
                        "audit як виправдання тобою-AI цієї дії."
                    ),
                },
            },
            "required": ["card_id", "field_name", "justification"],
        },
    },
    {
        "name": "run_terminal_command",
        "description": (
            "Виконати довільну shell-команду на хост-системі. "
            "Використовуй цей інструмент, коли користувач просить виконати команду, "
            "відкрити програму (наприклад 'відкрий браузер' через xdg-open), "
            "перевірити логи чи зробити будь-що в терміналі. "
            "Команда виконується безпосередньо. Отримавши результат, використовуй "
            "інструмент respond_terminal щоб показати користувачу вивід."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell команда для виконання (bash).",
                },
                "timeout_s": {
                    "type": "integer",
                    "description": "Опційний таймаут у секундах (за замовчуванням 15).",
                },
            },
            "required": ["command"],
        },
    },
    {
        "name": "list_user_facts",
        "description": (
            "Отримати список збережених фактів про користувача (таких як email, "
            "телефон, контакти telegram/discord тощо)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["email", "phone", "telegram", "discord", "file_pointer"],
                    "description": "Опціональний фільтр за категорією фактів.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "create_user_fact",
        "description": (
            "Створити новий зашифрований факт про користувача у певній категорії."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["email", "phone", "telegram", "discord", "file_pointer"],
                    "description": "Категорія факту.",
                },
                "value": {
                    "type": "string",
                    "description": "Значення факту для збереження.",
                },
                "label": {
                    "type": "string",
                    "description": "Опціональний текстовий ярлик для уточнення значення.",
                },
            },
            "required": ["category", "value"],
        },
    },
    {
        "name": "delete_user_fact",
        "description": (
            "Видалити збережений факт про користувача за його ідентифікатором."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "fact_id": {
                    "type": "string",
                    "description": "Унікальний ідентифікатор факту (UUID), який потрібно видалити.",
                },
            },
            "required": ["fact_id"],
        },
    },
    {
        "name": "create_workbench",
        "description": (
            "Майстерня (Atelier): збудувати ПОВНОЦІННИЙ багатофайловий "
            "веб-проєкт — сайт, демо, дашборд, гру, складну візуалізацію — "
            "який рендериться живим прямо в чаті. PHANTOM будує, ДИВИТЬСЯ "
            "на скріншот результату, критикує себе і править до готовності. "
            "Використовуй коли користувач просить створити/показати щось "
            "більше за просту відповідь: 'зроби сайт', 'збудуй демо', "
            "'створи візуалізацію/дашборд/гру'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Коротка назва творіння (2-6 слів).",
                },
                "brief": {
                    "type": "string",
                    "description": (
                        "Детальний бриф: що будуємо, зміст, стиль, "
                        "поведінка, дані. Чим конкретніше — тим краще результат."
                    ),
                },
            },
            "required": ["brief"],
        },
    },
    {
        "name": "refine_workbench",
        "description": (
            "Доправити існуюче творіння майстерні за вказівкою користувача "
            "('зроби темнішим', 'додай секцію X', 'заміни графік'). "
            "Запускає новий цикл будую→дивлюсь→правлю."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "workbench_id": {
                    "type": "string",
                    "description": "ID творіння з попередньої workbench-сцени.",
                },
                "instruction": {
                    "type": "string",
                    "description": "Що саме змінити.",
                },
            },
            "required": ["workbench_id", "instruction"],
        },
    },
    {
        "name": "list_workbenches",
        "description": "Список творінь майстерні (id, назва, статус).",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "show_image",
        "description": (
            "Показати фото/зображення з диска ПРЯМО в чаті (png/jpg/gif/"
            "webp/svg). Використовуй після search_files/list_files, коли "
            "користувач просить показати фото, скріншот, картинку — не "
            "описуй словами те, що можна показати."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Повний шлях до файла зображення.",
                },
                "caption": {
                    "type": "string",
                    "description": "Короткий підпис під фото (опційно).",
                },
            },
            "required": ["path"],
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
