"""
Phase 17b — Card catalog.

Static descriptor of every supported AgentCard kind with:
  • category, display title, description, icon hint
  • default_config skeleton when the user drops the card on the canvas
  • config_schema — declarative spec the FE inspector uses to render inputs

Backend execution of cards happens through the existing ActionRegistry —
the compiler maps card.kind → planner hint → action(s). This catalog is
the single source of truth for both FE rendering AND validation hints.
"""
from __future__ import annotations

from typing import Any, TypedDict

from .models import AgentCardKind, CardCategory


class FieldSpec(TypedDict, total=False):
    key: str
    label: str
    kind: str  # 'text' | 'textarea' | 'number' | 'bool' | 'select' | 'multi_select' | 'json'
    required: bool
    placeholder: str
    options: list[dict[str, str]]


class CatalogEntry(TypedDict):
    kind: AgentCardKind
    category: CardCategory
    title: str
    description: str
    icon: str | None
    default_config: dict[str, Any]
    config_schema: list[FieldSpec]


def _txt(key: str, label: str, *, placeholder: str | None = None, required: bool = False) -> FieldSpec:
    spec: FieldSpec = {"key": key, "label": label, "kind": "text"}
    if required:
        spec["required"] = True
    if placeholder:
        spec["placeholder"] = placeholder
    return spec


def _ta(key: str, label: str, *, placeholder: str | None = None) -> FieldSpec:
    spec: FieldSpec = {"key": key, "label": label, "kind": "textarea"}
    if placeholder:
        spec["placeholder"] = placeholder
    return spec


def _num(key: str, label: str, *, default: int | None = None) -> FieldSpec:
    spec: FieldSpec = {"key": key, "label": label, "kind": "number"}
    if default is not None:
        spec["placeholder"] = str(default)
    return spec


def _bool(key: str, label: str) -> FieldSpec:
    return {"key": key, "label": label, "kind": "bool"}


def _sel(key: str, label: str, options: list[tuple[str, str]]) -> FieldSpec:
    return {
        "key": key,
        "label": label,
        "kind": "select",
        "options": [{"id": v, "label": l} for v, l in options],
    }


CATALOG: list[CatalogEntry] = [
    # ── Source ─────────────────────────────────────────────────────────────
    {
        "kind": "web_search",
        "category": "source",
        "title": "Веб-пошук",
        "description": "Шукає в інтернеті за запитом і повертає список посилань.",
        "icon": "search",
        "default_config": {"query": "", "max_results": 5},
        "config_schema": [
            _txt("query", "Запит", placeholder="наприклад: погода Київ", required=True),
            _num("max_results", "Скільки результатів", default=5),
        ],
    },
    {
        "kind": "rss",
        "category": "source",
        "title": "RSS-стрічка",
        "description": "Підтягує найсвіжіші пости з RSS/Atom URL.",
        "icon": "rss",
        "default_config": {"feed_url": "", "limit": 10},
        "config_schema": [
            _txt("feed_url", "URL стрічки", required=True, placeholder="https://example.com/feed"),
            _num("limit", "Скільки записів", default=10),
        ],
    },
    {
        "kind": "email_inbox",
        "category": "source",
        "title": "Поштова скринька",
        "description": "Читає нові листи через IMAP / Gmail API.",
        "icon": "mail",
        "default_config": {"account": "", "label": "INBOX", "limit": 20},
        "config_schema": [
            _txt("account", "Акаунт", required=True),
            _txt("label", "Папка/Label", placeholder="INBOX"),
            _num("limit", "Скільки листів", default=20),
        ],
    },
    {
        "kind": "file_watch",
        "category": "source",
        "title": "Спостерігати теку",
        "description": "Дивиться на теку і повертає нові/змінені файли з останнього прогону.",
        "icon": "folder",
        "default_config": {"path": "", "patterns": ["*"]},
        "config_schema": [
            _txt("path", "Шлях", required=True, placeholder="/home/user/Documents"),
            _txt("patterns", "Маски (через кому)", placeholder="*.pdf, *.docx"),
        ],
    },
    {
        "kind": "api_poll",
        "category": "source",
        "title": "API-опитування",
        "description": "GET-запит до зовнішнього API.",
        "icon": "globe",
        "default_config": {"url": "", "headers": {}, "params": {}},
        "config_schema": [
            _txt("url", "URL", required=True),
            _ta("headers", "Заголовки (JSON)", placeholder='{"Authorization": "Bearer ..."}'),
            _ta("params", "Параметри (JSON)"),
        ],
    },
    {
        "kind": "db_query",
        "category": "source",
        "title": "Запит до БД",
        "description": "SELECT-запит до власної SQLite.",
        "icon": "database",
        "default_config": {"sql": "SELECT 1"},
        "config_schema": [_ta("sql", "SQL", placeholder="SELECT * FROM ...")],
    },
    {
        "kind": "mobile_sensor",
        "category": "source",
        "title": "Мобільні датчики",
        "description": "Читає GPS / IMU / контекст із мобільного-компаньйона.",
        "icon": "smartphone",
        "default_config": {"sensors": ["gps"]},
        "config_schema": [
            _sel("sensors", "Датчик", [
                ("gps", "GPS"),
                ("imu", "IMU"),
                ("battery", "Батарея"),
                ("ble", "Bluetooth"),
            ]),
        ],
    },
    # ── Transform ─────────────────────────────────────────────────────────
    {
        "kind": "summarize",
        "category": "transform",
        "title": "Стисле резюме",
        "description": "Стискає вхідний текст до 1-3 речень.",
        "icon": "sparkles",
        "default_config": {"max_sentences": 3, "tone": "neutral"},
        "config_schema": [
            _num("max_sentences", "Скільки речень", default=3),
            _sel("tone", "Тон", [
                ("neutral", "Нейтральний"),
                ("formal", "Офіційний"),
                ("warm", "Теплий"),
                ("dry", "Сухий"),
            ]),
        ],
    },
    {
        "kind": "compare",
        "category": "transform",
        "title": "Порівняти",
        "description": "Порівнює два набори даних і виявляє відмінності.",
        "icon": "git-compare",
        "default_config": {"left_key": "a", "right_key": "b"},
        "config_schema": [
            _txt("left_key", "Лівий вхід"),
            _txt("right_key", "Правий вхід"),
        ],
    },
    {
        "kind": "filter",
        "category": "transform",
        "title": "Фільтр",
        "description": "Залишає лише елементи що відповідають умові.",
        "icon": "filter",
        "default_config": {"expression": ""},
        "config_schema": [
            _ta("expression", "Умова", placeholder="item.score > 0.5"),
        ],
    },
    {
        "kind": "sort",
        "category": "transform",
        "title": "Сортування",
        "description": "Сортує колекцію за полем.",
        "icon": "arrow-down-up",
        "default_config": {"key": "ts", "order": "desc"},
        "config_schema": [
            _txt("key", "Поле"),
            _sel("order", "Порядок", [("asc", "за зростанням"), ("desc", "за спаданням")]),
        ],
    },
    {
        "kind": "extract",
        "category": "transform",
        "title": "Витягти поля",
        "description": "Дістає лише обрані поля з кожного елементу.",
        "icon": "scissors",
        "default_config": {"fields": []},
        "config_schema": [_txt("fields", "Поля (через кому)")],
    },
    {
        "kind": "diff",
        "category": "transform",
        "title": "Різниця з минулим",
        "description": "Що нового / змінилося порівняно з минулим прогоном.",
        "icon": "diff",
        "default_config": {"key": "id"},
        "config_schema": [_txt("key", "Ключ")],
    },
    {
        "kind": "score",
        "category": "transform",
        "title": "Оцінка",
        "description": "Призначає елементам числові оцінки за правилами.",
        "icon": "gauge",
        "default_config": {"weights_json": "{}"},
        "config_schema": [_ta("weights_json", "Ваги (JSON)")],
    },
    # ── Decision ──────────────────────────────────────────────────────────
    {
        "kind": "if",
        "category": "decision",
        "title": "Якщо ...",
        "description": "Розгалуження за умовою.",
        "icon": "git-branch",
        "default_config": {"condition": ""},
        "config_schema": [_ta("condition", "Умова")],
    },
    {
        "kind": "branch",
        "category": "decision",
        "title": "Багатогілкове",
        "description": "Кілька гілок-результатів.",
        "icon": "git-branch",
        "default_config": {"branches": []},
        "config_schema": [_ta("branches", "JSON-масив гілок")],
    },
    {
        "kind": "loop",
        "category": "decision",
        "title": "Цикл",
        "description": "Прокручує наступні картки за списком.",
        "icon": "rotate-cw",
        "default_config": {"items_key": "items"},
        "config_schema": [_txt("items_key", "Ключ списку")],
    },
    {
        "kind": "retry",
        "category": "decision",
        "title": "Перепробувати",
        "description": "При невдачі попередньої картки — повторити з backoff.",
        "icon": "rotate-ccw",
        "default_config": {"max_attempts": 3, "backoff_s": 5},
        "config_schema": [
            _num("max_attempts", "Скільки спроб", default=3),
            _num("backoff_s", "Backoff (с)", default=5),
        ],
    },
    {
        "kind": "ask_user",
        "category": "decision",
        "title": "Запитати у користувача",
        "description": "Робить паузу й піднімає InfoNeed.",
        "icon": "help-circle",
        "default_config": {"question": "", "kind": "text"},
        "config_schema": [
            _txt("question", "Питання", required=True),
            _sel("kind", "Тип", [
                ("text", "Текст"),
                ("single_choice", "Вибір одного"),
                ("multi_choice", "Кілька варіантів"),
                ("confirm", "Так / Ні"),
                ("range", "Слайдер"),
                ("file_pick", "Файл"),
                ("visual_pick", "Візуальний вибір"),
            ]),
        ],
    },
    # ── Output ────────────────────────────────────────────────────────────
    {
        "kind": "write_file",
        "category": "output",
        "title": "Записати у файл",
        "description": "Зберігає результат у файл на диску.",
        "icon": "save",
        "default_config": {"path": "", "format": "txt"},
        "config_schema": [
            _txt("path", "Шлях", required=True),
            _sel("format", "Формат", [
                ("txt", "Текст"),
                ("md", "Markdown"),
                ("json", "JSON"),
                ("csv", "CSV"),
            ]),
        ],
    },
    {
        "kind": "send_email",
        "category": "output",
        "title": "Надіслати email",
        "description": "Відправляє результат на email.",
        "icon": "mail",
        "default_config": {"to": "", "subject": ""},
        "config_schema": [
            _txt("to", "Кому"),
            _txt("subject", "Тема"),
        ],
    },
    {
        "kind": "send_telegram",
        "category": "output",
        "title": "Надіслати у Telegram",
        "description": "Постить у Telegram-чат / канал.",
        "icon": "send",
        "default_config": {"chat_id": ""},
        "config_schema": [_txt("chat_id", "Chat ID")],
    },
    {
        "kind": "post_to_api",
        "category": "output",
        "title": "POST у API",
        "description": "Шле POST-запит на URL.",
        "icon": "upload",
        "default_config": {"url": ""},
        "config_schema": [_txt("url", "URL")],
    },
    {
        "kind": "create_report",
        "category": "output",
        "title": "Створити звіт",
        "description": "Збирає бекапну версію Phase 16 TaskReport з результатів.",
        "icon": "file-text",
        "default_config": {"title": ""},
        "config_schema": [_txt("title", "Заголовок звіту")],
    },
    {
        "kind": "notify",
        "category": "output",
        "title": "Сповіщення",
        "description": "Показує OS-сповіщення на PHANTOM.",
        "icon": "bell",
        "default_config": {"message": ""},
        "config_schema": [_txt("message", "Повідомлення")],
    },
    # ── Council ───────────────────────────────────────────────────────────
    {
        "kind": "review_by_council",
        "category": "council",
        "title": "Перегляд радою",
        "description": "Прогоняє output через раду перед випуском.",
        "icon": "scale",
        "default_config": {"include_aesthete": False},
        "config_schema": [_bool("include_aesthete", "Підключити Aesthete")],
    },
]


def list_catalog() -> list[CatalogEntry]:
    return list(CATALOG)


def get_entry(kind: AgentCardKind) -> CatalogEntry | None:
    for entry in CATALOG:
        if entry["kind"] == kind:
            return entry
    return None


__all__ = ["CATALOG", "list_catalog", "get_entry", "CatalogEntry", "FieldSpec"]
