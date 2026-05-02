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

The pipeline never crashes a chat turn: any error path returns the
LLM's plain-`generate` answer, the same shape `routes_chat` expects
when `chat_tools_enabled` is off.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from ai.provider import AIResponse, ai_router
from ai.tool_use import ToolCallResult, ToolUseError

logger = logging.getLogger(__name__)


# ── Envelope nonce + content cap (TM-17B-S1) ─────────────────────────────────


# Per-process random nonce — prefixed onto every tool-result envelope
# key so an LLM cannot guess the marker and inject a fake tool-result
# token into plain assistant text. The nonce is stable for the
# process lifetime (re-deriving per turn would defeat history-based
# verification of past tool results).
_PROCESS_NONCE: str = secrets.token_hex(8)
_ENVELOPE_KEY: str = f"_phantom_tool_{_PROCESS_NONCE}"


# Hard cap on the LLM-visible tool-result content size. A 4000-char
# ceiling matches the upper bound of useful Cyrillic chat replies and
# prevents a tool that legitimately returned a 100 KB blob (e.g. a
# regex misfire on chroma_data) from being shoved into the next LLM
# turn — that would bury the system prompt and trip provider
# context-window limits.
_CONTENT_CAP_CHARS: int = 4000


def envelope_key() -> str:
    """Test seam — surfaces the nonced envelope key without forcing
    callers to import the underscore-prefixed module global."""
    return _ENVELOPE_KEY


# ── Pipeline ─────────────────────────────────────────────────────────────────


async def run(
    *,
    user_message: str,
    system_prompt: str,
    history: list[dict[str, Any]],
    user_id: str,
    db: AsyncSession,
) -> AIResponse:
    """Run one bounded tool-use turn. Returns an `AIResponse` ready
    for the chat broadcast."""

    deadline = time.monotonic() + (
        max(1, int(config.chat_tool_max_total_ms)) / 1000.0
    )
    max_calls = max(1, int(config.chat_tool_max_calls_per_turn))

    # ── Step 1: filter tool catalog ──────────────────────────────────────────
    tools = _filter_safe_tools()
    if not tools:
        # Catalog filter wiped everything (operator misconfiguration).
        # Fall through to plain generate — chat must not break.
        logger.warning("chat_pipeline: empty safe-tool catalog; falling through")
        return await _plain_generate(user_message, system_prompt, history, user_id)

    # ── Step 2: ask LLM to pick one tool ────────────────────────────────────
    if time.monotonic() >= deadline:
        return await _plain_generate(user_message, system_prompt, history, user_id)

    try:
        tool_choice = await ai_router.call_with_tools(
            system_prompt=system_prompt,
            user_message=user_message,
            tools=tools,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat_pipeline: call_with_tools raised: %s", exc)
        return await _plain_generate(user_message, system_prompt, history, user_id)

    if isinstance(tool_choice, ToolUseError):
        # LLM declined / model error — don't punish the user; plain
        # generate so the conversation continues.
        return await _plain_generate(user_message, system_prompt, history, user_id)

    if not isinstance(tool_choice, ToolCallResult):
        return await _plain_generate(user_message, system_prompt, history, user_id)

    # ── Step 3: dispatch via chat_tool_dispatcher (TM-17B-E2) ───────────────
    if time.monotonic() >= deadline:
        return await _plain_generate(user_message, system_prompt, history, user_id)

    from ai.chat_tool_dispatcher import dispatch as chat_dispatch
    from observability import chat_tool_calls_total

    dispatch_result = await chat_dispatch(
        tool_choice.tool_name,
        tool_choice.arguments,
        user_id=user_id,
        db=db,
    )
    chat_tool_calls_total.inc(
        tool=tool_choice.tool_name,
        ok=str(bool(dispatch_result.get("ok"))).lower(),
    )

    # Day-5 W-2c — capture the scene from the tool result if present. Some
    # tools (Alarm/Timer) return a rich UI card in the 'scene' field; we
    # want to ensure this reaches the FE even if the LLM's final response
    # turn doesn't explicitly mention it.
    tool_scene = (dispatch_result.get("result") or {}).get("scene") if dispatch_result.get("ok") else None

    # Hard cap on total dispatches in case future call_with_tools
    # returns plural tool_calls.
    if max_calls < 1:
        return await _plain_generate(user_message, system_prompt, history, user_id)

    # ── Step 4: nonce-keyed envelope + content cap (TM-17B-S1) ──────────────
    envelope = _build_envelope(tool_choice.tool_name, dispatch_result)

    # ── Step 5: ask LLM for final answer with envelope in history ───────────
    if time.monotonic() >= deadline:
        # We have the dispatch result but no time for a second LLM
        # call. Surface the dispatch summary as a raw fallback so the
        # operator at least sees the tool fired.
        return AIResponse(
            content=_dispatch_fallback_text(envelope),
            provider="chat_pipeline",
            response_form="text",
        )

    appended_history = list(history) + [
        {
            "role": "tool",
            "name": tool_choice.tool_name,
            # The envelope key is nonced; the content carries the
            # canonical {ok, result|error} shape.
            "content": envelope,
        }
    ]

    try:
        final = await ai_router.generate(
            user_message=user_message,
            system_prompt=system_prompt,
            history=appended_history,
            user_id=user_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat_pipeline: final generate failed: %s", exc)
        return AIResponse(
            content=_dispatch_fallback_text(envelope),
            provider="chat_pipeline",
            response_form="text",
        )

    # ── Step 6: sanitize before return (TM-17B-I1) ──────────────────────────
    sanitized = _safe_sanitize(final.content, user_id)

    # Day-5 W-2c — auto-attach tool scene. If the tool result carried a
    # rich UI card AND the LLM's final answer didn't already pick its
    # own scene (e.g. respond_terminal), promote the tool's scene into
    # the attachments list so the FE renders it inline.
    final_attachments = list(final.attachments or [])
    
    if tool_scene:
        # Inject the final LLM text into the tool scene's ai_note
        if "data" in tool_scene and isinstance(tool_scene["data"], dict):
            if sanitized and sanitized.strip():
                tool_scene["data"]["ai_note"] = sanitized.strip()
        
        # Remove any auto-generated composer scene (which has 'panels')
        # so the tool_scene takes precedence.
        filtered_attachments = []
        for a in final_attachments:
            if isinstance(a, dict) and a.get("type") == "scene":
                # If the generated scene is a composer scene (has 'panels' instead of 'data'), drop it
                scene_data = a.get("data", {})
                if "panels" in scene_data:
                    continue
            filtered_attachments.append(a)
        
        has_scene = any(
            isinstance(a, dict) and a.get("type") == "scene"
            for a in filtered_attachments
        )
        if not has_scene:
            filtered_attachments.append({"type": "scene", "data": tool_scene})
        final_attachments = filtered_attachments

    return AIResponse(
        content=sanitized,
        provider=final.provider,
        response_form=final.response_form,
        attachments=final_attachments,
        tokens_used=final.tokens_used,
        latency_ms=final.latency_ms,
    )


# ── Helpers ──────────────────────────────────────────────────────────────────


def _filter_safe_tools() -> list[dict[str, Any]]:
    """Return the chat tool catalog filtered through the dispatcher's
    safe-tool allowlist. Day-2 D2-E2 forbids `bash`/`shell` etc — the
    dispatcher's `_CHAT_SAFE_TOOL_NAMES` is the source of truth."""
    from ai.chat_tools import CHAT_DATA_TOOLS
    from ai.chat_tool_dispatcher import _CHAT_SAFE_TOOL_NAMES

    allowlist = frozenset(_CHAT_SAFE_TOOL_NAMES)
    return [t for t in CHAT_DATA_TOOLS if t.get("name") in allowlist]


def _build_envelope(name: str, dispatch_result: dict[str, Any]) -> dict[str, Any]:
    """Wrap the dispatcher result in a nonce-keyed envelope with a
    4000-char content cap (TM-17B-S1)."""
    raw_content = dispatch_result.get("result") or dispatch_result.get("error")
    text_form = _to_capped_text(raw_content)
    return {
        _ENVELOPE_KEY: name,  # nonce-prefixed marker
        "ok": bool(dispatch_result.get("ok")),
        "name": name,
        "content": text_form,
    }


def _to_capped_text(value: Any) -> str:
    """Render an arbitrary tool result as a string truncated to
    `_CONTENT_CAP_CHARS`. JSON for dicts/lists, str() otherwise."""
    if value is None:
        return ""
    try:
        import json as _json
        s = _json.dumps(value, ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        s = str(value)
    if len(s) > _CONTENT_CAP_CHARS:
        return s[: _CONTENT_CAP_CHARS - 16] + "...[truncated]"
    return s


def _dispatch_fallback_text(envelope: dict[str, Any]) -> str:
    """Last-resort summary used when the second LLM call would exceed
    the wall-clock budget. Surfaces the dispatch outcome so the
    operator at least sees the tool fired."""
    name = envelope.get("name", "tool")
    if envelope.get("ok"):
        return f"[{name}] {envelope.get('content', '')[:512]}"
    return f"[{name} error] {envelope.get('content', '')[:512]}"


def _safe_sanitize(text: str, user_id: str) -> str:
    """Run `output_safety.sanitize` on `text`, swallowing errors. The
    sanitizer reads recent memory facts to compute redactions; a
    sanitizer crash MUST NOT block the chat reply (the original text
    surfaces unchanged in that case)."""
    try:
        from ai.output_safety import sanitize
        result = sanitize(text=text, user_id=user_id)
        return result.text
    except Exception as exc:  # noqa: BLE001
        logger.debug("chat_pipeline: sanitize fallthrough: %s", exc)
        return text


async def _plain_generate(
    user_message: str,
    system_prompt: str,
    history: list[dict[str, Any]],
    user_id: str,
) -> AIResponse:
    """Bypass the tool loop entirely — the same path `routes_chat`
    takes when `chat_tools_enabled` is off. Used as the fallback for
    every error condition above so a degraded pipeline never breaks
    chat."""
    return await ai_router.generate(
        user_message=user_message,
        system_prompt=system_prompt,
        history=history,
        user_id=user_id,
    )


__all__ = [
    "run",
    "envelope_key",
]
