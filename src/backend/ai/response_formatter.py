"""
PHANTOM OS — Response Formatter.
Defines RESPONSE_FORM_TOOLS for function-calling and parses AI function call
results into (response_form, content, attachments).
"""
from __future__ import annotations

from typing import Any

# ── Tool definitions (provider-agnostic schema) ───────────────────────────────

RESPONSE_FORM_TOOLS: list[dict[str, Any]] = [
    {
        "name": "respond_text",
        "description": "Коротка текстова відповідь або markdown",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Текст відповіді (підтримує markdown)",
                },
                "use_markdown": {
                    "type": "boolean",
                    "description": "True якщо відповідь містить markdown форматування",
                },
            },
            "required": ["content"],
        },
    },
    {
        "name": "respond_chart",
        "description": "Дані з динамікою або порівнянням — Recharts графік",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Текстовий коментар до графіку",
                },
                "chart_type": {
                    "type": "string",
                    "enum": ["line", "bar", "area", "pie"],
                    "description": "Тип графіку",
                },
                "data": {
                    "type": "array",
                    "description": "Масив точок даних [{name, value}] або [{name, ...values}]",
                    "items": {"type": "object"},
                },
                "title": {
                    "type": "string",
                    "description": "Заголовок графіку",
                },
                "x_key": {
                    "type": "string",
                    "description": "Ключ поля для осі X, default 'name'",
                },
                "y_keys": {
                    "type": "array",
                    "description": "Масив ключів для серій на осі Y",
                    "items": {"type": "string"},
                },
            },
            "required": ["content", "chart_type", "data", "title"],
        },
    },
    {
        "name": "respond_map",
        "description": "Географічний контекст — міні-карта з маркерами",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Текстовий коментар до карти",
                },
                "markers": {
                    "type": "array",
                    "description": "Масив маркерів [{lat, lon, label, color?}]",
                    "items": {"type": "object"},
                },
                "center": {
                    "type": "array",
                    "description": "[lat, lon] центр карти",
                    "items": {"type": "number"},
                },
                "zoom": {
                    "type": "number",
                    "description": "Рівень масштабу (1-18), default 13",
                },
            },
            "required": ["content", "markers", "center"],
        },
    },
    {
        "name": "respond_terminal",
        "description": "Виконати Linux команду з live output",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Пояснення що робить команда",
                },
                "command": {
                    "type": "string",
                    "description": "Linux команда для виконання",
                },
                "explanation": {
                    "type": "string",
                    "description": "Детальне пояснення для юзера",
                },
            },
            "required": ["content", "command"],
        },
    },
    {
        "name": "respond_code",
        "description": "Код з підсвічуванням синтаксису",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Текстовий коментар до коду",
                },
                "language": {
                    "type": "string",
                    "description": "Мова програмування (python, js, bash, etc.)",
                },
                "code": {
                    "type": "string",
                    "description": "Код для відображення",
                },
            },
            "required": ["content", "language", "code"],
        },
    },
    {
        "name": "respond_metrics",
        "description": "Числові показники з трендом — картки метрик",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Текстовий коментар до метрик",
                },
                "metrics": {
                    "type": "array",
                    "description": "Масив метрик [{label, value, unit?, trend: up|down|stable}]",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "value": {"type": "number"},
                            "unit": {"type": "string"},
                            "trend": {
                                "type": "string",
                                "enum": ["up", "down", "stable"],
                            },
                        },
                        "required": ["label", "value", "trend"],
                    },
                },
            },
            "required": ["content", "metrics"],
        },
    },
]

# Map function name → ResponseForm string
_FORM_MAP: dict[str, str] = {
    "respond_text":     "text",
    "respond_chart":    "chart",
    "respond_map":      "map",
    "respond_terminal": "terminal",
    "respond_code":     "code",
    "respond_metrics":  "metric_cards",
}


# ── Parsing ───────────────────────────────────────────────────────────────────

def parse_function_call(
    fn_name: str,
    fn_args: dict[str, Any],
) -> tuple[str, str, list[dict[str, Any]]]:
    """
    Convert a function call from the AI into (response_form, content, attachments).

    Returns:
        response_form:  One of the ResponseForm values.
        content:        Primary text to display.
        attachments:    List of structured attachment dicts.
    """
    response_form = _FORM_MAP.get(fn_name, "text")
    content = str(fn_args.get("content", ""))

    attachments: list[dict[str, Any]] = []

    if fn_name == "respond_chart":
        attachments.append({
            "type": "chart_data",
            "data": {
                "chart_type": fn_args.get("chart_type", "bar"),
                "data": fn_args.get("data", []),
                "title": fn_args.get("title", ""),
                "x_key": fn_args.get("x_key", "name"),
                "y_keys": fn_args.get("y_keys", []),
            },
        })

    elif fn_name == "respond_map":
        attachments.append({
            "type": "map_markers",
            "data": {
                "markers": fn_args.get("markers", []),
                "center": fn_args.get("center", [0.0, 0.0]),
                "zoom": fn_args.get("zoom", 13),
            },
        })

    elif fn_name == "respond_terminal":
        attachments.append({
            "type": "terminal_output",
            "data": {
                "command": fn_args.get("command", ""),
                "explanation": fn_args.get("explanation", content),
            },
        })

    elif fn_name == "respond_code":
        attachments.append({
            "type": "code_block",
            "data": {
                "language": fn_args.get("language", "text"),
                "code": fn_args.get("code", ""),
            },
        })

    elif fn_name == "respond_metrics":
        attachments.append({
            "type": "metric_card",
            "data": {
                "metrics": fn_args.get("metrics", []),
            },
        })

    return response_form, content, attachments


def parse_plain_text(text: str) -> tuple[str, str, list[dict[str, Any]]]:
    """
    Fallback when AI returns plain text (no function call).
    Detects markdown, code blocks, etc. heuristically.
    """
    stripped = text.strip()

    # Detect fenced code block
    if stripped.startswith("```"):
        lines = stripped.split("\n")
        lang = lines[0].lstrip("`").strip() or "text"
        code = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
        return "code", "", [{"type": "code_block", "data": {"language": lang, "code": code}}]

    # Detect markdown (headers, lists, bold)
    if any(marker in stripped for marker in ("#", "**", "- ", "1. ", "| ")):
        return "markdown", stripped, []

    return "text", stripped, []
