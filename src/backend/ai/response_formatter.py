"""
PHANTOM OS — Response Formatter.
Defines RESPONSE_FORM_TOOLS for function-calling and parses AI function call
results into (response_form, content, attachments).
"""
from __future__ import annotations

from typing import Any

from config import config

# ── Tool definitions (provider-agnostic schema) ───────────────────────────────

RESPONSE_FORM_TOOLS: list[dict[str, Any]] = [
    # Phase 9.5 — `respond_text` removed from tool catalog. Audit
    # docs/phase-09.5-scope-audit/README.md showed Gemini in mode="AUTO"
    # defaults to respond_text for any conversational Ukrainian turn,
    # producing 100% `response_form=text` in the DB (25/25). Without a
    # text tool, AUTO mode now either picks a structured form from the
    # remaining 7 or returns plain text via the no-tool-call path
    # (handled by parse_plain_text()).
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
    {
        "name": "respond_diagram",
        "description": "Діаграма зв'язків або ієрархія — D3 вузли + ребра",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Текстовий коментар до діаграми",
                },
                "kind": {
                    "type": "string",
                    "enum": ["force", "tree", "flow"],
                    "description": "Тип діаграми: force — сила, tree — ієрархія, flow — потік зі стрілками",
                },
                "title": {
                    "type": "string",
                    "description": "Заголовок діаграми",
                },
                "nodes": {
                    "type": "array",
                    "description": "Масив вузлів [{id, label?, group?, value?}]",
                    "items": {"type": "object"},
                },
                "links": {
                    "type": "array",
                    "description": "Масив ребер [{source, target, value?, label?}]",
                    "items": {"type": "object"},
                },
            },
            "required": ["content", "nodes", "links"],
        },
    },
    {
        "name": "respond_artifact",
        "description": (
            "Інтерактивна візуалізація: віджет, дашборд, калькулятор, симуляція, "
            "графік зі складною логікою або будь-який інтерактивний інтерфейс. "
            "Використовуй ЗАВЖДИ коли користувач просить щось інтерактивне чи візуальне, "
            "що виходить за межі простого чарту. НЕ пиши код сам — передай title і spec: "
            "детальний опис що збудувати (дані, layout, взаємодії, стиль). "
            "Спеціалізована студія збудує повний HTML-артефакт за твоїм описом."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Назва для шапки віджета"},
                "spec": {
                    "type": "string",
                    "description": (
                        "Детальний опис артефакту: які дані показати, структура, "
                        "інтерактивність, стиль. Конкретні числа/факти з розмови включай сюди."
                    ),
                },
                "code": {
                    "type": "string",
                    "description": "(опційно) Чернетка коду як підказка для студії.",
                },
            },
            "required": ["title", "spec"],
        },
    },
    {
        "name": "respond_mixed",
        "description": "Комбінована відповідь: кілька блоків різних форм в одному повідомленні",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Основний текстовий блок (markdown)",
                },
                "chart": {
                    "type": "object",
                    "description": "Опціонально: дані графіку {chart_type, data, title, x_key?, y_keys?}",
                },
                "code": {
                    "type": "object",
                    "description": "Опціонально: {language, code}",
                },
                "metrics": {
                    "type": "array",
                    "description": "Опціонально: [{label, value, trend}]",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "value": {"type": "number"},
                            "trend": {"type": "string", "enum": ["up", "down", "stable"]},
                        },
                        "required": ["label", "value", "trend"],
                    },
                },
                "map": {
                    "type": "object",
                    "description": "Опціонально: {markers, center, zoom}",
                },
            },
            "required": ["content"],
        },
    },
    {
        "name": "respond_comparison",
        "description": (
            "Порівняння двох-трьох варіантів за рядом критеріїв (X проти Y). "
            "Використовуй коли користувач просить порівняти, обрати між, "
            "зважити плюси/мінуси опцій. Кожен рядок — критерій зі значенням "
            "для кожного варіанта; познач переможця рядка якщо доречно."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Короткий висновок/контекст (markdown)"},
                "title": {"type": "string", "description": "Заголовок порівняння"},
                "options": {
                    "type": "array",
                    "description": "Назви варіантів, 2-3 шт.",
                    "items": {"type": "string"},
                },
                "rows": {
                    "type": "array",
                    "description": "[{criterion, values:[по одному на варіант], winner?:індекс}]",
                    "items": {"type": "object"},
                },
                "recommendation": {"type": "string", "description": "Опціонально: що радиш і чому"},
            },
            "required": ["content", "options", "rows"],
        },
    },
    {
        "name": "respond_timeline",
        "description": (
            "Послідовність подій або кроків у часі/порядку. Використовуй для "
            "історії, інструкцій 'крок за кроком', планів, хронології, roadmap. "
            "Кожен пункт має заголовок і опис; час/дата та статус — опціонально."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Вступ/контекст (markdown)"},
                "title": {"type": "string"},
                "events": {
                    "type": "array",
                    "description": "[{time?, title, detail?, status?:done|active|future}]",
                    "items": {"type": "object"},
                },
            },
            "required": ["content", "events"],
        },
    },
    {
        "name": "respond_definition",
        "description": (
            "Картка-визначення поняття/терміна. Використовуй коли користувач "
            "питає 'що таке X', просить пояснити термін, дати визначення. "
            "Містить термін, вимову/категорію, суть, приклади."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Розгорнене пояснення (markdown)"},
                "term": {"type": "string", "description": "Слово/поняття"},
                "category": {"type": "string", "description": "Категорія/частина мови/галузь"},
                "pronunciation": {"type": "string", "description": "Опціонально: вимова"},
                "definition": {"type": "string", "description": "Стисла суть одним-двома реченнями"},
                "examples": {
                    "type": "array",
                    "description": "Опціонально: приклади вживання",
                    "items": {"type": "string"},
                },
            },
            "required": ["term", "definition"],
        },
    },
    {
        "name": "respond_stat",
        "description": (
            "Виділене ключове число/факт із контекстом. Використовуй коли "
            "відповідь зводиться до однієї важливої цифри чи факту, який варто "
            "подати ефектно (геро-число, рекорд, показник)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Пояснення навколо числа (markdown)"},
                "value": {"type": "string", "description": "Саме число/факт, як показати (напр. '42 млн')"},
                "label": {"type": "string", "description": "Що це за показник"},
                "unit": {"type": "string", "description": "Опціонально: одиниця"},
                "delta": {"type": "string", "description": "Опціонально: зміна (напр. '+12% р/р')"},
                "trend": {"type": "string", "enum": ["up", "down", "stable"], "description": "Опціонально"},
                "source": {"type": "string", "description": "Опціонально: джерело"},
            },
            "required": ["value", "label"],
        },
    },
]

# Map function name → ResponseForm string.
# `respond_text` is retained here (not in the tool catalog) because Gemini
# occasionally emits it as a stray function_call name even when the tool is
# absent; parse_function_call uses this mapping to coerce that back to "text".
_FORM_MAP: dict[str, str] = {
    "respond_text":     "text",
    "respond_chart":    "chart",
    "respond_map":      "map",
    "respond_terminal": "terminal",
    "respond_code":     "code",
    "respond_metrics":  "metric_cards",
    "respond_diagram":  "diagram",
    "respond_mixed":    "mixed",
    "respond_comparison": "comparison",
    "respond_timeline":   "timeline",
    "respond_definition": "definition",
    "respond_stat":       "stat_highlight",
    # Day-5 W-2c — hallucination safety aliases. Some versions of Gemini
    # tend to invent respond_alarm/calendar based on tool names; coerce
    # those back to text so the pipeline proceeds to the tool-scene promotion.
    "respond_alarm":    "text",
    "respond_timer":    "text",
    "respond_calendar": "text",
    "respond_artifact": "react_artifact",
}


# ── Day-4 W-2c — scene-kind picker (ADR-CS-002 §60-§90) ───────────────────────


# Map of `response_form` (frontend's existing closed enum) → SceneKind
# (`@shared/types/chat.ts` Day-4 W-1 closed enum). A form not in this
# map yields no scene envelope — message.scene stays absent and the
# frontend renders via the legacy ResponseRenderer (back-compat
# invariant ADR-CS-002 §60).
#
# Day-4 coverage:
#   text / markdown   → 'text'           single text panel
#   map               → 'map-pin'        leading text panel + map-pin panel
#   code / terminal   → 'code-preview'   leading text panel + code-preview panel
#   metric_cards      → 'list'           leading text panel + list panel
#
# Phase-28-A — `chart` and `diagram` now have first-class panel kinds
# (Recharts wrapper + d3 force/tree/flow wrapper). `mixed` still has
# no preset coverage (would need a multi-payload composer beyond the
# current single-attachment lookup) — left on the legacy renderer.
_FORM_TO_SCENE_KIND: dict[str, str] = {
    "text": "text",
    "markdown": "text",
    "map": "map-pin",
    "code": "code-preview",
    "terminal": "code-preview",
    "metric_cards": "list",
    "chart": "chart",
    "diagram": "diagram",
    "react_artifact": "react_artifact",
}

_ARTIFACT_CAPS = frozenset(
    {"read:context", "read:sensors", "read:memory", "read:state", "action:tools"}
)


def _should_auto_attach_scene(
    response_form: str,
    content: str,
    attachments: list[dict[str, Any]],
) -> bool:
    """Phase-5 R1 — gate the W-2c scene envelope auto-promotion.

    The legacy passthrough forms (`text`, `markdown`, `terminal`) already
    carry their payload through `result.content` or a primary attachment;
    a scene envelope on top of them is dead weight that breaks the
    classic empty-bubble guards (audit-2026-04-30 P1 CHATFIX-DEFAULT-
    SCENE-ATTACHMENT). For all other covered forms (`map`, `code`,
    `metric_cards`) the scene IS the only structured render path, so
    promotion stays automatic.
    """
    # Empty content + no payload-bearing attachments = nothing useful to
    # promote. The W-2c scene envelope would just carry an empty markdown
    # panel that the FE renders as a vacuous bubble — the legacy
    # `result.content` fillers (Ukrainian "Не встиг сформулювати —
    # перепитай?" guard, etc.) need to land on bubble.content first.
    if not (content or "").strip():
        payload_types = {
            att.get("type") for att in attachments
            if isinstance(att, dict)
        }
        # Forms that ship their own primary attachment as the rendering
        # surface should not be re-wrapped as a scene when content is
        # empty — the FE renderer reads the attachment directly.
        # Only `terminal_output` ships its own renderer surface that
        # makes the scene wrapper redundant. Other carriers (code_block,
        # chart_data, metric_card, map_markers) are explicitly promoted
        # by build_scene_envelope into typed scenes — keep auto-attach.
        legacy_payload_carriers = {"terminal_output"}
        if payload_types & legacy_payload_carriers:
            return False
        # No content + no payload — every promoted scene would carry an
        # empty markdown panel. Skip so the empty-bubble guard upstream
        # can substitute the operator-friendly Ukrainian filler text.
        if not attachments:
            return False
    return True


def scene_kind_for_form(response_form: str) -> str | None:
    """Return the SceneKind matching the given ResponseForm, or None
    when no preset coverage applies on Day-4 (chart/diagram/mixed)."""
    return _FORM_TO_SCENE_KIND.get(response_form)


def _scene_text_panel(idx: int, markdown: str) -> dict[str, Any]:
    """Build a `text` ScenePanel matching the W-1 type contract."""
    return {
        "id": f"p{idx}",
        "kind": "text",
        "data": {"markdown": markdown or ""},
    }


def _scene_map_pin_panel(idx: int, raw: dict[str, Any]) -> dict[str, Any]:
    """Build a `map-pin` ScenePanel from a `map_markers` attachment."""
    markers_in = raw.get("markers") or []
    markers_out: list[dict[str, Any]] = []
    for m in markers_in:
        if not isinstance(m, dict):
            continue
        try:
            lat = float(m.get("lat"))
            lon = float(m.get("lon"))
        except (TypeError, ValueError):
            continue
        marker: dict[str, Any] = {
            "lat": lat,
            "lon": lon,
            "label": str(m.get("label", "")),
        }
        if "color" in m:
            marker["color"] = str(m["color"])
        markers_out.append(marker)
    center_raw = raw.get("center") or [0.0, 0.0]
    try:
        center = [float(center_raw[0]), float(center_raw[1])]
    except (TypeError, ValueError, IndexError):
        center = [0.0, 0.0]
    panel: dict[str, Any] = {
        "id": f"p{idx}",
        "kind": "map-pin",
        "data": {"markers": markers_out, "center": center},
    }
    if "zoom" in raw:
        try:
            panel["data"]["zoom"] = int(raw["zoom"])
        except (TypeError, ValueError):
            pass
    return panel


def _scene_code_preview_panel(
    idx: int, raw: dict[str, Any], *, runnable: bool = False
) -> dict[str, Any]:
    """Build a `code-preview` ScenePanel from a code_block / terminal
    attachment payload."""
    code = raw.get("code")
    if code is None:
        # Terminal form stores its body under `command` + `explanation`.
        cmd = raw.get("command") or ""
        explanation = raw.get("explanation") or ""
        code = f"$ {cmd}" if cmd else explanation
    return {
        "id": f"p{idx}",
        "kind": "code-preview",
        "data": {
            "language": str(raw.get("language") or "text"),
            "code": str(code or ""),
            "runnable": bool(runnable),
        },
    }


def _scene_list_panel(idx: int, raw: dict[str, Any]) -> dict[str, Any]:
    """Build a `list` ScenePanel from a metric_card attachment payload."""
    items_raw = raw.get("metrics") or raw.get("items") or []
    items: list[dict[str, Any]] = []
    for m in items_raw:
        if not isinstance(m, dict):
            continue
        item: dict[str, Any] = {"label": str(m.get("label", ""))}
        if "value" in m and m["value"] is not None:
            v = m["value"]
            item["value"] = v if isinstance(v, (int, float)) else str(v)
        trend = m.get("trend")
        if trend in ("up", "down", "stable"):
            item["trend"] = trend
        items.append(item)
    return {
        "id": f"p{idx}",
        "kind": "list",
        "data": {"items": items},
    }


def _scene_chart_panel(idx: int, raw: dict[str, Any]) -> dict[str, Any]:
    """Phase-28-A — build a `chart` ScenePanel from a chart_data
    attachment payload. The frontend SceneChartPanel wraps Recharts
    (line/bar/area/pie); we forward the AI-emitted shape with one
    rename: `data` (Recharts row array) → `rows` (panel field) so
    the panel-data union doesn't collide with the outer ChatScene
    `data` discriminator key."""
    chart_type_raw = raw.get("chart_type")
    chart_type = (
        chart_type_raw
        if chart_type_raw in ("line", "bar", "area", "pie")
        else "bar"
    )
    rows_raw = raw.get("data")
    rows = [r for r in rows_raw if isinstance(r, dict)] if isinstance(rows_raw, list) else []
    panel_data: dict[str, Any] = {
        "chart_type": chart_type,
        "rows": rows,
    }
    if "title" in raw and raw["title"]:
        panel_data["title"] = str(raw["title"])
    if "x_key" in raw and raw["x_key"]:
        panel_data["x_key"] = str(raw["x_key"])
    if "y_keys" in raw and isinstance(raw["y_keys"], list):
        panel_data["y_keys"] = [str(k) for k in raw["y_keys"]]
    if "colors" in raw and isinstance(raw["colors"], list):
        panel_data["colors"] = [str(c) for c in raw["colors"]]
    return {
        "id": f"p{idx}",
        "kind": "chart",
        "data": panel_data,
    }


def _scene_diagram_panel(idx: int, raw: dict[str, Any]) -> dict[str, Any]:
    """Phase-28-A — build a `diagram` ScenePanel from a chart_data
    attachment with a `diagram` payload (force / tree / flow). The
    parser stores the diagram body under `chart_data.data.diagram`
    (see `respond_diagram` arm in `parse_function_call`); we lift
    that shape directly with light validation on the discriminator."""
    body = raw.get("diagram") if isinstance(raw.get("diagram"), dict) else raw
    kind_raw = body.get("kind")
    kind_val = kind_raw if kind_raw in ("force", "tree", "flow") else "force"
    nodes_raw = body.get("nodes")
    nodes = [n for n in nodes_raw if isinstance(n, dict) and n.get("id")] if isinstance(nodes_raw, list) else []
    links_raw = body.get("links")
    links = [
        l for l in links_raw
        if isinstance(l, dict) and l.get("source") and l.get("target")
    ] if isinstance(links_raw, list) else []
    panel_data: dict[str, Any] = {
        "kind": kind_val,
        "nodes": nodes,
        "links": links,
    }
    if body.get("title"):
        panel_data["title"] = str(body["title"])
    return {
        "id": f"p{idx}",
        "kind": "diagram",
        "data": panel_data,
    }


def _scene_artifact_panel(idx: int, raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"p{idx}",
        "kind": "react_artifact",
        "data": {
            "code": str(raw.get("code", "")),
            "title": str(raw.get("title", "")),
            "dependencies": raw.get("dependencies", {}),
        },
    }


def build_artifact_scene_attachment(
    title: str,
    html: str,
    *,
    prose: str = "",
    capabilities: list[str] | None = None,
) -> dict[str, Any]:
    """Wrap an ArtifactStudio HTML document as a `{type:'scene'}`
    attachment with scene kind `artifact` — the full-bleed breakout
    surface (MessageBubble) + offline iframe renderer
    (SceneArtifactPanel). Producers: chat respond_artifact reroute and
    the proactive `_emit_scene` loop.
    """
    panels: list[dict[str, Any]] = []
    idx = 1
    if prose.strip():
        panels.append(_scene_text_panel(idx, prose.strip()))
        idx += 1
    panels.append({
        "id": f"p{idx}",
        "kind": "artifact",
        "data": {
            "html": html,
            "title": title,
            "capabilities": list(capabilities or []),
        },
    })
    return {
        "type": "scene",
        "data": {
            "kind": "artifact",
            "panels": panels,
            "reveal": {"policy": "instant", "staggerMs": 0},
        },
    }


def build_scene_envelope(
    response_form: str,
    content: str,
    attachments: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Day-4 W-2c (ADR-CS-002): given a parsed AI reply, build a
    ChatScene envelope wrapped as a `{type: 'scene', data: {...}}`
    attachment ready for the W-1 promotion path
    (`routes_chat._serialize_message`) to lift onto
    `ChatMessage.scene`.

    Returns None when `response_form` has no preset coverage on Day-4.
    The caller appends the returned dict (if not None) to the
    `attachments` list. The W-1 serialiser strips it from the published
    attachments and promotes its `data` field to the top-level
    `scene` field, so legacy clients that don't yet handle scenes
    silently see one fewer attachment without breaking.
    """
    kind = scene_kind_for_form(response_form)
    if kind is None:
        return None

    panels: list[dict[str, Any]] = []
    idx = 1

    # Most kinds open with a leading text panel summarising the body.
    # `text` form just IS the text panel — no leading panel.
    if kind == "text":
        panels.append(_scene_text_panel(idx, content))
        idx += 1
    else:
        if content:
            panels.append(_scene_text_panel(idx, content))
            idx += 1

    if kind == "map-pin":
        for att in attachments:
            if isinstance(att, dict) and att.get("type") == "map_markers":
                data = att.get("data") if isinstance(att.get("data"), dict) else {}
                panels.append(_scene_map_pin_panel(idx, data))
                idx += 1
                break  # first map_markers wins; multiples are rare and ambiguous
    elif kind == "code-preview":
        for att in attachments:
            if not isinstance(att, dict):
                continue
            t = att.get("type")
            data = att.get("data") if isinstance(att.get("data"), dict) else {}
            if t == "code_block":
                panels.append(_scene_code_preview_panel(idx, data))
                idx += 1
                break
            if t == "terminal_output":
                panels.append(
                    _scene_code_preview_panel(idx, data, runnable=False)
                )
                idx += 1
                break
    elif kind == "list":
        for att in attachments:
            if isinstance(att, dict) and att.get("type") == "metric_card":
                data = att.get("data") if isinstance(att.get("data"), dict) else {}
                panels.append(_scene_list_panel(idx, data))
                idx += 1
                break
    elif kind == "chart":
        # Phase-28-A — chart_data attachments without a `diagram` body
        # are bar/line/area/pie charts. Skip ones nested under a
        # `diagram` key (those are diagram payloads, not charts).
        for att in attachments:
            if not isinstance(att, dict) or att.get("type") != "chart_data":
                continue
            data = att.get("data") if isinstance(att.get("data"), dict) else {}
            if isinstance(data.get("diagram"), dict):
                continue
            panels.append(_scene_chart_panel(idx, data))
            idx += 1
            break
    elif kind == "diagram":
        # Phase-28-A — diagram bodies are nested under chart_data.diagram.
        for att in attachments:
            if not isinstance(att, dict) or att.get("type") != "chart_data":
                continue
            data = att.get("data") if isinstance(att.get("data"), dict) else {}
            if not isinstance(data.get("diagram"), dict):
                continue
            panels.append(_scene_diagram_panel(idx, data))
            idx += 1
            break
    elif kind == "react_artifact":
        for att in attachments:
            if isinstance(att, dict) and att.get("type") == "artifact_data":
                data = att.get("data") if isinstance(att.get("data"), dict) else {}
                panels.append(_scene_artifact_panel(idx, data))
                idx += 1
                break

    # No content + no payload-derived panels → nothing useful to render
    # as a scene. Skip promotion; legacy renderer keeps working.
    if not panels:
        return None

    return {
        "type": "scene",
        "data": {
            "kind": kind,
            "panels": panels,
            # Reveal default — sequential with 80 ms stagger matches the
            # frontend default in ChatScene.tsx so envelopes that omit
            # `reveal` still render with the canonical cadence.
            "reveal": {"policy": "sequential", "staggerMs": 80},
        },
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

    elif fn_name == "respond_diagram":
        attachments.append({
            "type": "chart_data",
            "data": {
                "diagram": {
                    "kind": fn_args.get("kind", "force"),
                    "title": fn_args.get("title", ""),
                    "nodes": fn_args.get("nodes", []),
                    "links": fn_args.get("links", []),
                },
            },
        })

    elif fn_name == "respond_artifact":
        # Legacy/fallback arm — the primary chat path intercepts
        # respond_artifact in chat_pipeline._widget_response and routes
        # it through ArtifactStudio (cloud HTML). This arm only fires
        # when the studio is unavailable AND the model shipped raw code.
        code = str(fn_args.get("code", ""))
        title = str(fn_args.get("title", ""))
        dependencies = fn_args.get("dependencies", {})

        if not config.chat_artifacts_enabled or not code:
            response_form = "text"
            if not content:
                content = (
                    f"Не зміг збудувати «{title or 'артефакт'}» — "
                    "студія артефактів недоступна. Спробуй ще раз пізніше."
                )
        else:
            attachments.append({
                "type": "artifact_data",
                "data": {
                    "title": title,
                    "code": code,
                    "dependencies": dependencies,
                },
            })

    elif fn_name == "respond_mixed":
        chart = fn_args.get("chart")
        if isinstance(chart, dict) and chart.get("data"):
            attachments.append({
                "type": "chart_data",
                "data": {
                    "chart_type": chart.get("chart_type", "bar"),
                    "data": chart.get("data", []),
                    "title": chart.get("title", ""),
                    "x_key": chart.get("x_key", "name"),
                    "y_keys": chart.get("y_keys", []),
                },
            })
        code = fn_args.get("code")
        if isinstance(code, dict) and code.get("code"):
            attachments.append({
                "type": "code_block",
                "data": {
                    "language": code.get("language", "text"),
                    "code": code.get("code", ""),
                },
            })
        metrics = fn_args.get("metrics")
        if isinstance(metrics, list) and metrics:
            valid_metrics = [m for m in metrics if isinstance(m, dict) and "label" in m and "value" in m]
            if valid_metrics:
                attachments.append({
                    "type": "metric_card",
                    "data": {"metrics": valid_metrics},
                })
        map_data = fn_args.get("map")
        if isinstance(map_data, dict) and map_data.get("markers"):
            attachments.append({
                "type": "map_markers",
                "data": {
                    "markers": map_data.get("markers", []),
                    "center": map_data.get("center", [0.0, 0.0]),
                    "zoom": map_data.get("zoom", 13),
                },
            })

    elif fn_name == "respond_comparison":
        attachments.append({
            "type": "comparison_data",
            "data": {
                "title": fn_args.get("title", ""),
                "options": fn_args.get("options", []),
                "rows": fn_args.get("rows", []),
                "recommendation": fn_args.get("recommendation", ""),
            },
        })

    elif fn_name == "respond_timeline":
        attachments.append({
            "type": "timeline_data",
            "data": {
                "title": fn_args.get("title", ""),
                "events": fn_args.get("events", []),
            },
        })

    elif fn_name == "respond_definition":
        attachments.append({
            "type": "definition_data",
            "data": {
                "term": fn_args.get("term", ""),
                "category": fn_args.get("category", ""),
                "pronunciation": fn_args.get("pronunciation", ""),
                "definition": fn_args.get("definition", ""),
                "examples": fn_args.get("examples", []),
            },
        })

    elif fn_name == "respond_stat":
        attachments.append({
            "type": "stat_data",
            "data": {
                "value": fn_args.get("value", ""),
                "label": fn_args.get("label", ""),
                "unit": fn_args.get("unit", ""),
                "delta": fn_args.get("delta", ""),
                "trend": fn_args.get("trend", "stable"),
                "source": fn_args.get("source", ""),
            },
        })

    # Day-4 W-2c — promote to a typed scene envelope when the form has
    # preset coverage. The W-1 _serialize_message in routes_chat lifts
    # this attachment to top-level message.scene; legacy clients see
    # one fewer attachment without breaking.
    #
    # Phase-5 R1 fix (audit-2026-04-30 P1 CHATFIX-DEFAULT-SCENE-ATTACHMENT)
    # — skip auto-promotion for the legacy passthrough forms. `text` and
    # `markdown` are already carried by `result.content`; `terminal` ships
    # its own `terminal_output` attachment that the FE renders directly.
    # Wrapping any of these in a scene envelope just doubles the payload.
    if not _should_auto_attach_scene(response_form, content, attachments):
        return response_form, content, attachments

    scene_att = build_scene_envelope(response_form, content, attachments)
    if scene_att is not None:
        attachments.append(scene_att)

    return response_form, content, attachments


def parse_plain_text(text: str) -> tuple[str, str, list[dict[str, Any]]]:
    """
    Fallback when AI returns plain text (no function call).
    Detects markdown, code blocks, etc. heuristically.

    Day-4 W-2c: every return path passes through the scene-promotion
    helper so plain text replies also gain a typed `text` panel and
    code-fenced replies render through `code-preview`.
    """
    stripped = text.strip()
    form: str
    content: str
    attachments: list[dict[str, Any]]

    if stripped.startswith("```"):
        # Fenced code block — extract language + body.
        lines = stripped.split("\n")
        lang = lines[0].lstrip("`").strip() or "text"
        code = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
        form, content, attachments = (
            "code",
            "",
            [{"type": "code_block", "data": {"language": lang, "code": code}}],
        )
    elif any(marker in stripped for marker in ("#", "**", "- ", "1. ", "| ")):
        form, content, attachments = "markdown", stripped, []
    else:
        form, content, attachments = "text", stripped, []

    if _should_auto_attach_scene(form, content, attachments):
        scene_att = build_scene_envelope(form, content, attachments)
        if scene_att is not None:
            attachments.append(scene_att)

    return form, content, attachments
