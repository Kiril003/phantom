"""PHANTOM OS — Phase 17b chat tool-use pipeline.

This module is the single entry point that the chat path uses when
``config.chat_tools_enabled`` is True. It orchestrates one bounded
tool-use turn:

1. Filter the chat tool catalog through `chat_tool_dispatcher`'s
   safe-tool list (TM-17B-E2 invariant: chat tool-use NEVER reaches
   `tool_executor.execute_tool` directly; the dispatcher is the only
   path).
2. Ask the LLM to pick one tool (`ai_router.call_with_tools(...)`).
3. Dispatch the chosen tool through `chat_tool_dispatcher.dispatch`.
4. Wrap the result in a nonce-keyed envelope (TM-17B-S1 mitigation:
   per-process nonce + 4000-char content cap so a malicious LLM
   cannot fake a tool-result marker in plain text).
5. Ask the LLM for a final answer with the envelope appended to
   history (no tools advertised this round).
6. Sanitize the final answer through `output_safety.sanitize` before
   broadcast (TM-17B-I1 mitigation).

Caps:

* `config.chat_tool_max_calls_per_turn` — total tool dispatch budget
  (defaults to 4; this scaffold uses 1 because `call_with_tools`
  is single-tool today).
* `config.chat_tool_max_total_ms` — wall-clock cap for the whole
  pipeline (default 12 s). The deadline is checked between LLM call
  and dispatch and again before the final answer call.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any

from ai import output_safety
from ai import prompt_builder
from ai import response_formatter
from ai.provider import ai_router, AIResponse
from ai.sentience.monologue import phantom_monologue
from ai.sentience.endocrine import endocrine_system
from ai.tool_use import ToolCallResult
from config import config
from db.models import ChatMessage
from observability import chat_tool_calls_total
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# TM-17B-S1: Per-process nonce to prevent LLM from hallucinating tool results.
_ENVELOPE_NONCE = secrets.token_hex(8)
_CONTENT_CAP_CHARS = 4000


def envelope_key() -> str:
    """The nonce-keyed field name for the tool envelope in Round 2."""
    return f"_phantom_tool_{_ENVELOPE_NONCE}"


def _to_capped_text(val: Any) -> str:
    """TM-17B-S1: ensure tool output is a string and capped at 4000 chars."""
    if val is None:
        return ""
    if not isinstance(val, str):
        try:
            val = json.dumps(val, ensure_ascii=False, default=str)
        except Exception:
            val = str(val)
    if len(val) > _CONTENT_CAP_CHARS:
        marker = "...[truncated]"
        return val[:_CONTENT_CAP_CHARS - len(marker)] + marker
    return val


def _build_envelope(name: str, dispatch_result: dict) -> dict[str, Any]:
    """TM-17B-S1: wrap tool result in a nonced envelope."""
    return {
        envelope_key(): name,
        "ok": bool(dispatch_result.get("ok")),
        "name": name,
        "content": _to_capped_text(
            dispatch_result.get("result") if dispatch_result.get("ok") else dispatch_result.get("error")
        ),
    }


def _filter_safe_tools() -> list[dict]:
    """TM-17B-S2: filter the full tool catalog to the chat-safe allowlist."""
    from ai.chat_tool_dispatcher import supported_tools
    from ai.chat_tools import CHAT_DATA_TOOLS

    safe_names = supported_tools()
    return [
        {"name": t["name"], "function": t}
        for t in CHAT_DATA_TOOLS
        if t["name"] in safe_names
    ]


@dataclass(frozen=True)
class _CatalogTool:
    """One entry in the merged round-1 tool catalog.

    `function` is the provider-agnostic function-declaration dict
    (name/description/parameters) that `ai_router.call_with_tools`
    forwards to Gemini/Ollama.
    """

    name: str
    function: dict


_FENCE_RE = re.compile(r"```([a-zA-Z0-9_+-]*)\n(.*?)\n?```", re.DOTALL)
_HTML_DOC_RE = re.compile(r"<!doctype html|<html[\s>]|<body[\s>]", re.IGNORECASE)


def _extract_artifact_html(text: str) -> tuple[str, str] | None:
    """Salvage a self-contained HTML document the model pasted as a
    fenced code block instead of calling `respond_artifact`.

    Returns ``(html, prose)`` — the document plus the surrounding chat
    text with the fence stripped — or ``None`` when no block qualifies.
    A block qualifies only if its info-string is ``html``/``htm`` or it
    is untagged and the body is an HTML document; a ``python``/``bash``/
    ``…`` block is never hijacked (it has its own code-preview path).
    """
    if not text:
        return None
    for m in _FENCE_RE.finditer(text):
        lang = m.group(1).strip().lower()
        body = m.group(2).strip()
        is_html = lang in ("html", "htm") or (
            lang == "" and _HTML_DOC_RE.search(body) is not None
        )
        if not is_html or not body:
            continue
        prose = (text[: m.start()] + text[m.end():]).strip()
        return body, prose
    return None


def _artifact_title(prose: str) -> str:
    for line in prose.splitlines():
        line = line.strip().lstrip("#").strip()
        if line:
            return line[:60]
    return "Артефакт"


def _build_tool_catalog() -> list[_CatalogTool]:
    """Phase 27-a — merge the chat-safe side-effect tools with the
    `respond_*` widget tools into ONE deduplicated function-call catalog.

    Pre-27a the round-1 LLM only ever saw side-effect tools, so it could
    never pick a widget (`respond_chart` / `respond_metrics` / ...) and
    defaulted to plain text — the operator-reported "AI завжди відповідає
    plain text" bug. Advertising widget tools here lets the LLM short-
    circuit straight to a widget AIResponse (see `_widget_response`).

    Side-effect tools win on a name clash (they carry real arguments
    schemas); widget tools are appended only if not already present.
    """
    catalog: list[_CatalogTool] = []
    seen: set[str] = set()
    for entry in _filter_safe_tools():
        name = entry["name"]
        if name in seen:
            continue
        seen.add(name)
        catalog.append(_CatalogTool(name=name, function=entry["function"]))
    if config.chat_response_widgets_enabled is True:
        for tool in response_formatter.RESPONSE_FORM_TOOLS:
            name = tool["name"]
            if name in seen:
                continue
            seen.add(name)
            catalog.append(_CatalogTool(name=name, function=tool))
    return catalog


def _make_artifact_phase_cb(user_id: str):
    """Return an on_phase callback that broadcasts scene.artifact.progress
    over the chat WS channel for the given user.

    The event is additive — it never alters the final scene envelope.
    The broadcast is best-effort: any WS error is logged at DEBUG and
    silently swallowed so a missing WS connection never aborts artifact
    generation.
    """
    async def _cb(phase: str, html_preview: str | None) -> None:
        try:
            from api.websocket_hub import hub
            payload: dict = {"phase": phase}
            if html_preview is not None:
                payload["htmlPreview"] = html_preview
            await hub.broadcast(
                "chat", "scene.artifact.progress",
                payload,
                user_id=user_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("artifact progress broadcast failed (%s): %s", phase, exc)

    return _cb


async def run(
    user_message: str,
    system_prompt: str,
    history: list[dict],
    *,
    user_id: str,
    db: AsyncSession,
    provider_hint: str | None = None,
) -> AIResponse:
    """Entry point for the Chat Tool Pipeline."""
    started = time.monotonic()
    
    # Apply endocrine personality bias to the prompt.
    bias = endocrine_system.get_personality_bias()
    
    sentient_prompt = (
        f"{system_prompt}\n\n"
        f"[SENTIENT STATE: warmth={bias['tone_warmth']:.2f}, "
        f"brevity={bias['verbosity']:.2f}, creativity={bias['creativity']:.2f}]\n"
        "Adjust your tone to match this internal state."
    )
    
    # ── Inner Monologue Reflection ───────────────────────────────────────
    await phantom_monologue.reflect(user_message, bias)

    deadline = started + (
        max(1, int(config.chat_tool_max_total_ms)) / 1000.0
    )

    # ── Step 1: build merged tool catalog ───────────────────────────────────
    tool_catalog = _build_tool_catalog()

    # If no tools allowed, fall back to plain generate.
    if not tool_catalog:
        return await _plain_generate(user_message, sentient_prompt, history, user_id, db, provider_hint=provider_hint)

    # ── Step 2: ask LLM to pick one tool ────────────────────────────────────
    if time.monotonic() > deadline:
        return await _plain_generate(user_message, sentient_prompt, history, user_id, db, provider_hint=provider_hint)

    try:
        raw_tools = [c.function for c in tool_catalog]

        # Round 1: Call LLM with tool choice.
        tool_choice = await ai_router.call_with_tools(
            user_message=user_message,
            system_prompt=sentient_prompt,
            history=history,
            tools=raw_tools,
            user_id=user_id,
            provider_hint=provider_hint,
        )
    except Exception as exc:
        logger.warning("chat_pipeline Step 2 failed: %s", exc)
        return await _plain_generate(user_message, sentient_prompt, history, user_id, db, provider_hint=provider_hint)

    # If LLM didn't pick a tool, return the text answer it gave instead.
    if isinstance(tool_choice, ToolCallResult):
        if not tool_choice.tool_name:
            raw_text = tool_choice.raw_reasoning or ""
            salvage = (
                _extract_artifact_html(raw_text)
                if config.chat_artifacts_enabled
                else None
            )
            if salvage is not None:
                fast_html, prose = salvage
                from ai.artifact_studio import (
                    Brief, build_artifact, ArtifactStudioError,
                )

                title = _artifact_title(prose)
                try:
                    title, html = await build_artifact(
                        Brief(title=title, request=prose or "інтерактивний віджет",
                              hint=fast_html),
                        user_id=user_id,
                        on_phase=_make_artifact_phase_cb(user_id),
                    )
                    tool = "respond_artifact_salvage_studio"
                except ArtifactStudioError as exc:
                    logger.warning(
                        "artifact_studio salvage failed, using fast html: %s", exc
                    )
                    html = fast_html
                    tool = "respond_artifact_salvage"
                form, _c, attachments = response_formatter.parse_function_call(
                    "respond_artifact",
                    {"html": html, "title": title, "capabilities": []},
                )
                if form == "artifact":
                    chat_tool_calls_total.inc(success="true", tool=tool)
                    sanitized = await output_safety.sanitize(
                        prose or "Ось віджет.", user_id=user_id, db=db
                    )
                    return AIResponse(
                        content=sanitized.text,
                        response_form=form,
                        attachments=attachments,
                        provider=tool_choice.provider,
                    )
            sanitized = await output_safety.sanitize(raw_text, user_id=user_id, db=db)
            return AIResponse(
                content=sanitized.text,
                provider=tool_choice.provider,
            )
    else:
        return await _plain_generate(user_message, sentient_prompt, history, user_id, db, provider_hint=provider_hint)

    # Case: LLM picked a widget tool directly (short-circuit).
    if tool_choice.tool_name.startswith("respond_"):
        chat_tool_calls_total.inc(
            success="true",
            tool=tool_choice.tool_name,
        )
        return await _widget_response(tool_choice, user_id, db)

    # ── Step 3: dispatch via chat_tool_dispatcher (TM-17B-E2) ───────────────
    if time.monotonic() > deadline:
        return await _plain_generate(user_message, sentient_prompt, history, user_id, db, provider_hint=provider_hint)

    from ai.chat_tool_dispatcher import dispatch as chat_dispatch
    
    dispatch_result = await chat_dispatch(
        tool_choice.tool_name,
        tool_choice.arguments,
        user_id=user_id,
        db=db,
    )
    
    chat_tool_calls_total.inc(
        success="true" if dispatch_result.get("ok") else "false",
        tool=tool_choice.tool_name,
    )

    # ── Step 4: wrap result in envelope (TM-17B-S1) ─────────────────────────
    envelope = _build_envelope(tool_choice.tool_name, dispatch_result)
    
    # ── Step 4.5: Auto-rendering short-circuit ──────────────────────────────
    tool_scene = (dispatch_result.get("result") or {}).get("scene")
    
    auto_response = _auto_render_envelope(
        tool_choice.tool_name, dispatch_result, tool_scene
    )
    if auto_response is not None:
        return auto_response

    # ── Step 5: ask LLM for final answer with envelope in history ───────────
    if time.monotonic() > deadline:
        fallback_attachments: list[dict[str, Any]] = []
        if tool_scene:
            fallback_attachments.append({"type": "scene", "data": tool_scene})
        return AIResponse(
            content=_dispatch_fallback_text(dispatch_result, started),
            provider="chat_pipeline",
            response_form="text",
            attachments=fallback_attachments,
        )

    appended_history = list(history) + [
        {
            "role": "tool",
            "name": tool_choice.tool_name,
            "content": json.dumps(envelope, ensure_ascii=False, default=str),
        }
    ]

    try:
        # Round 2: Final LLM call with tool results.
        final_ans = await ai_router.generate(
            user_message=user_message,
            system_prompt=sentient_prompt,
            history=appended_history,
            user_id=user_id,
            provider_hint=provider_hint,
        )
        
        if tool_scene and not any(a.get("type") == "scene" for a in final_ans.attachments):
            final_ans.attachments.append({"type": "scene", "data": tool_scene})
            
        sanitized = await output_safety.sanitize(final_ans.content, user_id=user_id, db=db)
        final_ans.content = sanitized.text
        return final_ans
        
    except Exception as exc:
        logger.exception("chat_pipeline error in Step 5: %s", exc)
        return _dispatch_fallback_text_response(dispatch_result, started, tool_scene)


async def _plain_generate(
    user_message: str,
    system_prompt: str,
    history: list[dict],
    user_id: str,
    db: AsyncSession,
    provider_hint: str | None = None,
) -> AIResponse:
    """Fall back to plain text generation without tools."""
    ans = await ai_router.generate(
        user_message=user_message,
        system_prompt=system_prompt,
        history=history,
        user_id=user_id,
        provider_hint=provider_hint,
    )
    sanitized = await output_safety.sanitize(ans.content, user_id=user_id, db=db)
    ans.content = sanitized.text
    return ans


async def _widget_response(choice: ToolCallResult, user_id: str, db: AsyncSession) -> AIResponse:
    """Round-1 `respond_*` widget pick. For `respond_artifact` the fast
    model's `html` arg is a weak draft — discard it and regenerate via
    ArtifactStudio (Gemini 2.5 Pro, multi-pass). On studio failure
    degrade to text (never a dead bubble). All other `respond_*` forms
    go through `parse_function_call` unchanged."""
    if choice.tool_name == "respond_artifact" and config.chat_artifacts_enabled:
        from ai.artifact_studio import Brief, build_artifact, ArtifactStudioError

        args = choice.arguments or {}
        brief = Brief(
            title=str(args.get("title", "") or "Артефакт"),
            request=str(args.get("content") or args.get("title") or ""),
            hint=str(args.get("html", "") or ""),
        )
        caps = args.get("capabilities") or []
        try:
            title, html = await build_artifact(
                brief, user_id=user_id,
                on_phase=_make_artifact_phase_cb(user_id),
            )
        except ArtifactStudioError as exc:
            logger.warning("artifact_studio failed, degrading to text: %s", exc)
            sanitized = await output_safety.sanitize(
                "Не зміг зібрати віджет потрібної якості — переформулюй, "
                "будь ласка, або спробуй ще раз.",
                user_id=user_id, db=db,
            )
            return AIResponse(
                content=sanitized.text, response_form="text",
                provider=choice.provider,
            )
        form, content, attachments = response_formatter.parse_function_call(
            "respond_artifact",
            {"title": title, "html": html, "capabilities": caps},
        )
        chat_tool_calls_total.inc(success="true", tool="respond_artifact_studio")
        sanitized = await output_safety.sanitize(content, user_id=user_id, db=db)
        return AIResponse(
            content=sanitized.text, response_form=form,
            attachments=attachments, provider=choice.provider,
        )

    form, content, attachments = response_formatter.parse_function_call(
        choice.tool_name, choice.arguments or {}
    )
    sanitized = await output_safety.sanitize(content, user_id=user_id, db=db)
    return AIResponse(
        content=sanitized.text,
        response_form=form,
        attachments=attachments,
        provider=choice.provider,
    )


def _auto_render_envelope(
    tool_name: str,
    dispatch_result: dict,
    tool_scene: dict[str, Any] | None,
) -> AIResponse | None:
    """Map a tool's dispatch envelope directly to a widget AIResponse."""
    if not dispatch_result.get("ok"):
        return None
    result = dispatch_result.get("result") or {}

    if tool_name == "get_system_metrics":
        items: list[dict[str, Any]] = []
        for key, label, unit in (
            ("cpu_pct", "CPU", "%"),
            ("ram_pct", "RAM", "%"),
            ("disk_pct", "Диск", "%"),
            ("load_1min", "Load", ""),
        ):
            val = result.get(key)
            if isinstance(val, (int, float)):
                items.append({
                    "label": label,
                    # Load average is a small float (e.g. 0.84) — int()
                    # would collapse it to 0. Percentages stay integers.
                    "value": round(float(val), 2) if key == "load_1min" else int(val),
                    "unit": unit,
                })
        if not items:
            return None
        return AIResponse(
            content="Поточні показники системи.",
            response_form="metric_cards",
            attachments=[{"type": "metric_card", "data": {"metrics": items}}],
        )

    if tool_name == "get_my_location":
        lat = result.get("lat")
        lon = result.get("lon")
        place = result.get("place_name") or "Невідома локація"
        if lat is None or lon is None:
            return AIResponse(
                content=f"GPS недоступний. Останнє відоме місце: {place}",
                response_form="text",
            )
        return AIResponse(
            content=f"Твоя локація: {place}",
            response_form="map",
            attachments=[{
                "type": "map_markers",
                "data": {
                    "markers": [{"lat": lat, "lon": lon, "label": "Ти тут", "color": "blue"}],
                    "center": [lat, lon],
                    "zoom": 15,
                }
            }],
        )

    if tool_name == "recall_memory_facts":
        facts = result.get("results") if isinstance(result, dict) else None
        if not facts:
            return AIResponse(
                content="Поки що немає збережених фактів про тебе.",
                response_form="text",
            )
        bullets = "\n".join(
            f"• {f.get('content', '')}".rstrip()
            for f in facts[:10]
            if isinstance(f, dict) and f.get("content")
        )
        return AIResponse(
            content=f"Що я пам'ятаю:\n{bullets}",
            response_form="markdown",
        )

    if tool_name == "search_web":
        summary = ""
        sources: list[Any] = []
        if isinstance(result, dict):
            summary = (result.get("summary") or "").strip()
            raw_sources = result.get("sources")
            if isinstance(raw_sources, list):
                sources = raw_sources
        # Nothing grounded → fall through (let Step 5 phrase a reply).
        if not summary and not sources:
            return None
        lines: list[str] = []
        if summary:
            lines.append(summary)
        cited = [s for s in sources if isinstance(s, dict)]
        if cited:
            if lines:
                lines.append("")
            lines.append("**Джерела:**")
            for src in cited:
                title = src.get("title") or src.get("url") or "джерело"
                url = src.get("url") or ""
                lines.append(f"- [{title}]({url})" if url else f"- {title}")
        return AIResponse(
            content="\n".join(lines).strip(),
            response_form="markdown",
        )

    return None


def _dispatch_fallback_text(dispatch_result: dict, started_at: float) -> str:
    """Create a short summary of a tool result when Step 5 is bypassed."""
    name = dispatch_result.get("name", "unknown_tool")
    if dispatch_result.get("ok"):
        return f"Я успішно виконав запит {name}."
    
    error = dispatch_result.get("error", "unknown error")
    return f"[{name} error] \"{error}\""


def _dispatch_fallback_text_response(dispatch_result: dict, started_at: float, tool_scene: dict | None) -> AIResponse:
    """Create a full AIResponse fallback."""
    attachments = []
    if tool_scene:
        attachments.append({"type": "scene", "data": tool_scene})
    return AIResponse(
        content=_dispatch_fallback_text(dispatch_result, started_at),
        provider="chat_pipeline",
        response_form="text",
        attachments=attachments,
    )
