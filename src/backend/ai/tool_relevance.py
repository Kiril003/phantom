"""B1 liveness — round-1 tool-catalog trim.

The merged round-1 catalog grew to ~60 function declarations; Gemini
reads them all before the first token, which is pure TTFT tax. This
module picks ~15 contextually likely tools per turn with cheap UA/EN
stem heuristics: matched families first, then a core always-useful set,
capped. The dispatcher still validates every pick, so a miss costs one
"unknown tool" retry, never a wrong dispatch.
"""
from __future__ import annotations

import re

MAX_ROUND1_TOOLS = 15

# Always-available fill — covers the questions people actually ask when
# no family keyword fires (facts, web, place, device, creations, photos).
CORE_TOOLS: tuple[str, ...] = (
    "search_web",
    "recall_memory_facts",
    "get_my_location",
    "get_system_metrics",
    "create_timer",
    "get_calendar_events",
    "create_workbench",
    "show_image",
    "run_terminal_command",
    "agent.delegate",
)

# (compiled stem regex, tool names) — first match order defines priority.
_FAMILIES: tuple[tuple[re.Pattern[str], tuple[str, ...]], ...] = tuple(
    (re.compile(pattern, re.IGNORECASE), tools)
    for pattern, tools in (
        (
            r"таймер|секундомір|відлік|timer|countdown",
            ("create_timer", "cancel_timer", "list_timers"),
        ),
        (
            r"будильник|розбуди|прокинутись|alarm|wake me",
            ("create_alarm", "delete_alarm", "set_alarm_active", "list_alarms"),
        ),
        (
            r"календар|поді[юяї]|зустріч|заплануй|нагада|розклад|"
            r"calendar|meeting|schedule|remind|event",
            (
                "get_calendar_events", "create_calendar_event",
                "update_calendar_event", "delete_calendar_event",
            ),
        ),
        (
            r"де я|карт[аіу]|маршрут|локаці|місц[еяь]|поруч|поблизу|дістатись|"
            r"навігац|був (вчора|сьогодні)|map|route|location|nearby|navigate|where",
            (
                "get_my_location", "search_nearby_places", "map.plan_route",
                "search_locationhistory", "query_temporal_anchors",
                "respond_map",
            ),
        ),
        (
            r"пам'ята|запам'ята|згада|забудь|факт|про мене|"
            r"remember|memory|recall|forget",
            ("recall_memory_facts",),
        ),
        (
            r"систем[аиу]|cpu|проц|ram|пам'ять|диск|метрик|навантаж|"
            r"сенсор|датчик|температур|стан (плати|пристрою)|"
            r"metrics|sensor|load|status",
            (
                "get_system_metrics", "get_sensor_status",
                "get_internal_state", "respond_metrics",
            ),
        ),
        (
            r"знайди|пошука|погугли|новин|курс|погод|скільки кошту|хто так|"
            r"search|google|news|weather|price|what is|who is",
            ("search_web",),
        ),
        (
            r"пароль|секрет|сейф|vault|карт(к|ок)|credential|password",
            (
                "vault_list", "vault_get", "vault_create", "vault_update",
                "vault_delete", "vault_restore", "vault_reveal",
            ),
        ),
        (
            r"агент[аіи]?|studio|делег|команд[аун] (агент|спеціаліст)|"
            r"agent|delegate|specialist",
            (
                "agent.delegate", "studio_list_agents", "studio_get_agent",
                "studio_create_agent", "studio_run_agent", "studio_update_agent",
                "studio_delete_agent", "studio_card_catalog",
            ),
        ),
        (
            r"терміна|команд[ауи]|запусти|викона|shell|bash|terminal|command|run ",
            ("run_terminal_command", "respond_terminal"),
        ),
        (
            r"створи|зроби|збудуй|згенеруй|намалюй|сторінк|сайт|додаток|гр[ау]|"
            r"дашборд|переро[бб]|доопрацюй|build|create|make|generate|page|app|"
            r"game|website|dashboard|refine",
            ("create_workbench", "refine_workbench", "list_workbenches"),
        ),
        (
            r"фото|картинк|зображенн|покажи|скріншот|photo|image|picture|screenshot",
            ("show_image",),
        ),
        (
            r"графік|діаграм|візуаліз|chart|plot|graph",
            ("respond_chart", "respond_stat"),
        ),
        (
            r"порівня|против|versus|\bvs\b|compare",
            ("respond_comparison",),
        ),
        (
            r"\bкод\b|скрипт|функці|програм|code|script|function",
            ("respond_code",),
        ),
        (
            r"схем[ауи]|архітектур|діаграм[ау] (потоків|звязків)|diagram|flowchart",
            ("respond_diagram",),
        ),
        (
            r"хронолог|таймлайн|етап|історі[яю] (розвитку|проекту)|timeline",
            ("respond_timeline",),
        ),
        (
            r"що таке|визначенн|поясни термін|define|definition|what does .* mean",
            ("respond_definition",),
        ),
    )
)


def select_relevant(
    user_message: str,
    available: list[str],
    cap: int = MAX_ROUND1_TOOLS,
) -> list[str]:
    """Pick ≤`cap` tool names for round-1: matched families first (in
    declaration order), then CORE fill. Only names present in
    `available` survive; order follows selection priority."""
    have = set(available)
    picked: list[str] = []
    seen: set[str] = set()

    def _take(names: tuple[str, ...] | list[str]) -> None:
        for name in names:
            if len(picked) >= cap:
                return
            if name in have and name not in seen:
                seen.add(name)
                picked.append(name)

    text = user_message or ""
    for pattern, tools in _FAMILIES:
        if len(picked) >= cap:
            break
        if pattern.search(text):
            _take(tools)

    _take(CORE_TOOLS)
    return picked


__all__ = ["select_relevant", "CORE_TOOLS", "MAX_ROUND1_TOOLS"]
