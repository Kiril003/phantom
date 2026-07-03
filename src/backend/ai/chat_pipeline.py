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
    model_override: str | None = None,
    on_delta: Any | None = None,
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

    # ── Inner Monologue Reflection (Non-blocking) ────────────────────────
    # Run reflection in the background so it doesn't block the chat turn latency.
    asyncio.create_task(
        phantom_monologue.reflect(user_message, bias),
        name="sentient_reflection",
    )

    # ── Fast Track Short-circuit ─────────────────────────────────────────
    # If the message is a simple greeting or very short, skip tool-selection
    # and go straight to generation. Saves 3-5 seconds of latency.
    clean_msg = user_message.strip().lower().strip("?!. ")
    is_greeting = clean_msg in {
        "привіт", "здоров", "хай", "ку", "вітаю", "добрий день", "добрий вечір",
        "hi", "hello", "hey", "yo", "greeting",
        "як справи", "як ти", "що робиш", "how are you", "what's up",
    }
    if is_greeting or len(user_message) < 4:
        logger.debug("chat_pipeline: fast-track active for %r", clean_msg)
        return await _plain_generate(
            user_message, sentient_prompt, history, user_id, db,
            provider_hint=provider_hint, model_override=model_override, on_delta=on_delta,
        )

    deadline = started + (
        max(1, int(config.chat_tool_max_total_ms)) / 1000.0
    )

    # ── Step 1: build merged tool catalog ───────────────────────────────────
    tool_catalog = _build_tool_catalog()

    # If no tools allowed, fall back to plain generate.
    if not tool_catalog:
        return await _plain_generate(user_message, sentient_prompt, history, user_id, db, provider_hint=provider_hint)

    current_history = list(history)
    max_turns = int(getattr(config, "chat_tool_max_calls_per_turn", 4) or 4)
    turn = 0
    accumulated_tokens = 0
    last_provider = provider_hint or "gemini"
    tool_scene = None
    dispatch_result = None

    called_tools = set()

    # Multi-Step Loop
    while turn < max_turns:
        turn += 1
        if time.monotonic() > deadline:
            logger.warning("chat_pipeline: loop turn %d reached deadline, finalizing", turn)
            break

        # Emit "thinking" signal on first tool turn so UI shows activity immediately
        if turn == 1:
            try:
                from api.websocket_hub import hub as _ws_hub
                await _ws_hub.broadcast(
                    "chat", "thinking",
                    {"session_id": "unknown"},
                    user_id=user_id,
                )
            except Exception:
                pass

        # Step 2: ask LLM to pick one tool. Turn 1 streams (B1 liveness):
        # text deltas reach the UI immediately; a functionCall part
        # switches us onto the tool path. Turns ≥2 stay non-streaming.
        try:
            raw_tools = [c.function for c in tool_catalog]
            if turn == 1 and on_delta is not None and config.ai_streaming:
                tool_choice = await ai_router.call_with_tools_stream(
                    user_message=user_message,
                    system_prompt=sentient_prompt,
                    history=current_history,
                    tools=raw_tools,
                    user_id=user_id,
                    provider_hint=provider_hint,
                    on_delta=on_delta,
                )
            else:
                tool_choice = await ai_router.call_with_tools(
                    user_message=user_message,
                    system_prompt=sentient_prompt,
                    history=current_history,
                    tools=raw_tools,
                    user_id=user_id,
                    provider_hint=provider_hint,
                )
        except Exception as exc:
            logger.warning("chat_pipeline Step 2 failed on turn %d: %s", turn, exc)
            break

        # If LLM didn't pick a tool, return the text answer it gave instead.
        if isinstance(tool_choice, ToolCallResult):
            accumulated_tokens += getattr(tool_choice, "tokens_used", 0) or 0
            if tool_choice.provider:
                last_provider = tool_choice.provider

            if not tool_choice.tool_name:
                raw_text = tool_choice.raw_reasoning or ""
                sanitized = await output_safety.sanitize(raw_text, user_id=user_id, db=db)
                return AIResponse(
                    content=sanitized.text,
                    provider=last_provider,
                    tokens_used=accumulated_tokens,
                )
        else:
            break

        # Repeat tool call protection
        tool_key = (tool_choice.tool_name, json.dumps(tool_choice.arguments or {}, sort_keys=True))
        if tool_key in called_tools:
            logger.warning("chat_pipeline: repeat tool call detected for %s, breaking loop", tool_choice.tool_name)
            break
        called_tools.add(tool_key)

        # Case: LLM picked a widget tool directly (short-circuit).
        if tool_choice.tool_name.startswith("respond_"):
            chat_tool_calls_total.inc(
                success="true",
                tool=tool_choice.tool_name,
            )
            widget_resp = await _widget_response(tool_choice, user_id, db)
            widget_resp.tokens_used = (widget_resp.tokens_used or 0) + accumulated_tokens
            return widget_resp

        # Emit thought step monologue to WS
        from agent.cognition.monologue_emitter import emit_monologue, MonologueEvent
        await emit_monologue(MonologueEvent(
            kind="plan",
            source="tactical",
            monologue={"what_i_plan": f"Запуск інструменту {tool_choice.tool_name}..."}
        ))

        # Step 3: dispatch via chat_tool_dispatcher (TM-17B-E2)
        from ai.chat_tool_dispatcher import dispatch as chat_dispatch
        
        try:
            dispatch_result = await chat_dispatch(
                tool_choice.tool_name,
                tool_choice.arguments,
                user_id=user_id,
                db=db,
            )
            ok = bool(dispatch_result.get("ok"))
        except Exception as exc:
            dispatch_result = {"ok": False, "error": str(exc)}
            ok = False
        
        chat_tool_calls_total.inc(
            success="true" if ok else "false",
            tool=tool_choice.tool_name,
        )

        # Step 4: wrap result in envelope (TM-17B-S1)
        envelope = _build_envelope(tool_choice.tool_name, dispatch_result)
        
        # Emit outcome monologue to WS for self-reflection and tracking
        if ok:
            await emit_monologue(MonologueEvent(
                kind="reflection",
                source="reflector",
                monologue={"note": f"Інструмент {tool_choice.tool_name} успішно виконано. Аналізую результат..."}
            ))
        else:
            err_msg = dispatch_result.get("error") or "невідома помилка"
            await emit_monologue(MonologueEvent(
                kind="reflection",
                source="reflector",
                monologue={"note": f"Помилка при виклику {tool_choice.tool_name}: {err_msg}. Виконую автокорекцію..."}
            ))

        # Step 4.5: Auto-rendering short-circuit
        tool_scene = (dispatch_result.get("result") or {}).get("scene")
        auto_response = _auto_render_envelope(
            tool_choice.tool_name, dispatch_result, tool_scene,
            provider=last_provider,
        )
        if auto_response is not None:
            auto_response.tokens_used = (auto_response.tokens_used or 0) + accumulated_tokens
            return auto_response

        # Append to running history for subsequent loop cycles
        current_history.append({
            "role": "assistant",
            "content": f"Використовую інструмент {tool_choice.tool_name}...",
        })
        current_history.append({
            "role": "tool",
            "name": tool_choice.tool_name,
            "content": json.dumps(envelope, ensure_ascii=False, default=str),
        })

    # Step 5: ask LLM for final answer
    if time.monotonic() > deadline:
        fallback_attachments: list[dict[str, Any]] = []
        if tool_scene:
            fallback_attachments.append({"type": "scene", "data": tool_scene})
        fb_text = _dispatch_fallback_text(dispatch_result, started) if dispatch_result else "Перевищено ліміт часу."
        return AIResponse(
            content=fb_text,
            provider=last_provider,
            response_form="text",
            attachments=fallback_attachments,
            tokens_used=accumulated_tokens,
        )

    try:
        # Final LLM call with complete tool trace in history.
        final_ans = await ai_router.generate(
            user_message=user_message,
            system_prompt=sentient_prompt,
            history=current_history,
            user_id=user_id,
            provider_hint=provider_hint,
            model_override=model_override,
        )

        if tool_scene and not any(a.get("type") == "scene" for a in final_ans.attachments):
            final_ans.attachments.append({"type": "scene", "data": tool_scene})

        sanitized = await output_safety.sanitize(final_ans.content, user_id=user_id, db=db)
        final_ans.content = sanitized.text
        final_ans.tokens_used = (final_ans.tokens_used or 0) + accumulated_tokens
        return final_ans

    except Exception as exc:
        logger.exception("chat_pipeline error in final generate: %s", exc)
        if dispatch_result:
            fb_resp = _dispatch_fallback_text_response(dispatch_result, started, tool_scene, provider=last_provider)
            fb_resp.tokens_used = (fb_resp.tokens_used or 0) + accumulated_tokens
            return fb_resp
        return await _plain_generate(
            user_message, sentient_prompt, history, user_id, db,
            provider_hint=provider_hint, model_override=model_override, on_delta=on_delta,
        )



async def _plain_generate(
    user_message: str,
    system_prompt: str,
    history: list[dict],
    user_id: str,
    db: AsyncSession,
    provider_hint: str | None = None,
    model_override: str | None = None,
    on_delta: Any | None = None,
) -> AIResponse:
    """Plain text generation without tools. Streams via on_delta when available."""
    if on_delta is not None and config.ai_streaming:
        chunks: list[str] = []
        last_provider = provider_hint or "gemini"
        try:
            async for chunk in ai_router.generate_stream(
                user_message=user_message,
                system_prompt=system_prompt,
                history=history,
                provider_hint=provider_hint,
            ):
                if chunk:
                    chunks.append(chunk)
                    try:
                        await on_delta(chunk)
                    except Exception:
                        pass
            content = "".join(chunks)
        except Exception as exc:
            logger.warning("_plain_generate stream failed, falling back: %s", exc)
            content = ""

        if content:
            sanitized = await output_safety.sanitize(content, user_id=user_id, db=db)
            return AIResponse(
                content=sanitized.text,
                provider=last_provider,
                tokens_used=0,
            )

    ans = await ai_router.generate(
        user_message=user_message,
        system_prompt=system_prompt,
        history=history,
        user_id=user_id,
        provider_hint=provider_hint,
        model_override=model_override,
    )
    sanitized = await output_safety.sanitize(ans.content, user_id=user_id, db=db)
    ans.content = sanitized.text
    return ans


async def _widget_response(choice: ToolCallResult, user_id: str, db: AsyncSession) -> AIResponse:
    """Round-1 `respond_*` widget pick. All `respond_*` forms
    go through `parse_function_call` unchanged."""

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
    provider: str = "unknown",
) -> AIResponse | None:
    """Map a tool's dispatch envelope directly to a widget AIResponse."""
    if not dispatch_result.get("ok"):
        return None
    result = dispatch_result.get("result") or {}

    # Atelier: the workbench card IS the answer. Returning it directly
    # (a) shows the card within seconds, while the build's workbench.phase
    # events still have a listener to land on, and (b) skips the Step-5
    # summary call — one less LLM request per build on a 20/day free tier.
    # Images: the photo IS the answer — ship the attachment directly so it
    # can't be dropped by the Step-5 prose call (which keeps only scenes).
    if tool_name == "show_image":
        att = result.get("attachment")
        if isinstance(att, dict) and att.get("type") == "image":
            data = att.get("data") or {}
            caption = data.get("caption") or data.get("name") or "зображення"
            return AIResponse(
                content=str(caption),
                response_form="text",
                attachments=[att],
                provider=provider,
            )
        return None

    if tool_name in ("create_workbench", "refine_workbench") and tool_scene:
        title = (tool_scene.get("data") or {}).get("title") or "творіння"
        verb = "Відкрив майстерню" if tool_name == "create_workbench" \
            else "Заходжу на нове коло правок"
        return AIResponse(
            content=f"{verb}: «{title}». Будую, дивлюсь на результат і правлю "
                    "— фази йдуть у картці нижче.",
            response_form="text",
            attachments=[{"type": "scene", "data": tool_scene}],
            provider=provider,
        )

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
            provider=provider,
        )

    if tool_name == "get_my_location":
        lat = result.get("lat")
        lon = result.get("lon")
        place = result.get("place_name") or "Невідома локація"
        if lat is None or lon is None:
            return AIResponse(
                content=f"GPS недоступний. Останнє відоме місце: {place}",
                response_form="text",
                provider=provider,
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
            provider=provider,
        )

    if tool_name == "recall_memory_facts":
        facts = result.get("results") if isinstance(result, dict) else None
        if not facts:
            return AIResponse(
                content="Поки що немає збережених фактів про тебе.",
                response_form="text",
                provider=provider,
            )
        bullets = "\n".join(
            f"• {f.get('content', '')}".rstrip()
            for f in facts[:10]
            if isinstance(f, dict) and f.get("content")
        )
        return AIResponse(
            content=f"Що я пам'ятаю:\n{bullets}",
            response_form="markdown",
            provider=provider,
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
            provider=provider,
        )

    return None


def _dispatch_fallback_text(dispatch_result: dict, started_at: float) -> str:
    """Create a short summary of a tool result when Step 5 is bypassed."""
    name = dispatch_result.get("name", "unknown_tool")
    if dispatch_result.get("ok"):
        return f"Я успішно виконав запит {name}."
    
    error = dispatch_result.get("error", "unknown error")
    return f"[{name} error] \"{error}\""


def _dispatch_fallback_text_response(
    dispatch_result: dict,
    started_at: float,
    tool_scene: dict | None,
    provider: str = "chat_pipeline",
) -> AIResponse:
    """Create a full AIResponse fallback."""
    attachments = []
    if tool_scene:
        attachments.append({"type": "scene", "data": tool_scene})
    return AIResponse(
        content=_dispatch_fallback_text(dispatch_result, started_at),
        provider=provider,
        response_form="text",
        attachments=attachments,
    )
