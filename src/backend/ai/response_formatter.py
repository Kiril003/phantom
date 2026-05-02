"""
PHANTOM OS — Response Formatter.
Defines RESPONSE_FORM_TOOLS for function-calling and parses AI function call
results into (response_form, content, attachments).
"""
from __future__ import annotations

from typing import Any

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
                    "items": {"type": "object"},
                },
                "map": {
                    "type": "object",
                    "description": "Опціонально: {markers, center, zoom}",
                },
            },
            "required": ["content"],
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
    # Day-5 W-2c — hallucination safety aliases. Some versions of Gemini
    # tend to invent respond_alarm/calendar based on tool names; coerce
    # those back to text so the pipeline proceeds to the tool-scene promotion.
    "respond_alarm":    "text",
    "respond_timer":    "text",
    "respond_calendar": "text",
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
# `chart`, `diagram`, `mixed` deliberately NOT mapped on Day-4 — those
# require richer panel kinds the W-1 closed enum does not yet expose
# (e.g., `chart`-shaped data points). When the operator wants those
# rendered as scenes we extend `ScenePanelKind` first, ADR-amend the
# closed enum, then add their entries here.
_FORM_TO_SCENE_KIND: dict[str, str] = {
    "text": "text",
    "markdown": "text",
    "map": "map-pin",
    "code": "code-preview",
    "terminal": "code-preview",
    "metric_cards": "list",
}


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
            attachments.append({
                "type": "metric_card",
                "data": {"metrics": metrics},
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
