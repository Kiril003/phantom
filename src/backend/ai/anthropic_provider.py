"""
PHANTOM OS — Anthropic Claude provider via raw HTTP (no SDK dependency).

Uses httpx (already in requirements) instead of the `anthropic` Python SDK
so we don't add another package to the Radxa venv. Implements the
[`AIProvider`][ai.provider.AIProvider] interface — generate, generate_stream,
health_check — against the Messages API.

Why bring this in alongside Gemini + Ollama:

  - Gemini Flash is fast but conservative; Claude Sonnet 4.6 is sharper at
    the conversational + tool-use loop the operator's screen-aware queries
    actually exercise. With a fallback chain Gemini → Anthropic → Ollama
    you get a soft cost ceiling and frontier IQ where it matters.
  - Anthropic's tool_use shape is closer to what `chat_tool_dispatcher.py`
    already reasons about (typed JSON args). Hooking it in keeps tool
    calls deterministic instead of relying on Gemini's
    `function_call`/`text` ambiguity.

Tool-use isn't wired yet — the first cut serves bare `generate` and
`generate_stream`. The router treats tool-call requests routed through
this provider as falling through to the next provider in `AIRouter`'s
sequence (cf. `_RESPONSE_FORM_TOOLS_REQUIRED` in chat_pipeline.py — that
path uses Gemini today; Anthropic tool-use lands in a follow-up).
"""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator

import httpx

from config import config
from ai.provider import AIProvider, AIResponse
from ai.tool_use import (
    ToolCallResult,
    ToolErrorKind,
    ToolSchema,
    ToolUseError,
)

logger = logging.getLogger(__name__)


_API_BASE = "https://api.anthropic.com/v1"
_API_VERSION = "2023-06-01"
_DEFAULT_TIMEOUT_S = 60.0


def _classify_anthropic_error(exc: Exception) -> tuple[ToolErrorKind, bool, float | None]:
    """Map an httpx/Anthropic exception → (kind, retriable, retry_after_s).

    Mirrors the Gemini provider's classification so the router's cooling /
    retry loop reasons identically across providers.
    """
    msg = str(exc)
    lower = msg.lower()
    retry_after: float | None = None

    if isinstance(exc, httpx.TimeoutException):
        return ToolErrorKind.TIMEOUT, True, retry_after
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 429:
            ra = exc.response.headers.get("retry-after")
            if ra:
                try:
                    retry_after = float(ra)
                except ValueError:
                    retry_after = None
            # Anthropic distinguishes daily vs minute rate limits via the
            # error.type field. Treat both as retriable; cooling is the
            # router's job.
            return ToolErrorKind.RATE_LIMIT, True, retry_after
        if code in (500, 502, 503, 504):
            return ToolErrorKind.PROVIDER_UNAVAILABLE, True, retry_after
        if code in (401, 403):
            # Bad / missing key — non-retriable; surface so the router
            # can mark this provider quota-exhausted and fall through.
            return ToolErrorKind.QUOTA_EXHAUSTED, False, retry_after
        return ToolErrorKind.NETWORK, True, retry_after
    if "timeout" in lower or "timed out" in lower:
        return ToolErrorKind.TIMEOUT, True, retry_after
    return ToolErrorKind.NETWORK, True, retry_after


def _build_messages(
    user_message: str,
    history: list[dict],
) -> list[dict]:
    """Convert the existing history shape (`role`/`content`) into Anthropic's
    `messages` array. Anthropic requires the first message be `user` and
    that roles alternate user/assistant; collapse consecutive same-role
    messages to keep the API happy."""
    out: list[dict] = []
    for m in history or []:
        role = m.get("role")
        content = m.get("content", "")
        if role not in ("user", "assistant") or not content:
            continue
        if out and out[-1]["role"] == role:
            # Merge consecutive same-role messages with a blank line.
            out[-1]["content"] += "\n\n" + content
            continue
        out.append({"role": role, "content": content})
    # Append the current user message as the final turn.
    if out and out[-1]["role"] == "user":
        out[-1]["content"] += "\n\n" + user_message
    else:
        out.append({"role": "user", "content": user_message})
    # Anthropic mandates first-message-is-user.
    if not out or out[0]["role"] != "user":
        out.insert(0, {"role": "user", "content": "(continue)"})
    return out


class AnthropicProvider(AIProvider):
    """Anthropic Claude via the Messages API."""

    @property
    def _api_key(self) -> str:
        return getattr(config, "ai_anthropic_api_key", "") or ""

    @property
    def _model(self) -> str:
        return getattr(config, "ai_anthropic_model", "claude-sonnet-4-6") or "claude-sonnet-4-6"

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self._api_key,
            "anthropic-version": _API_VERSION,
            "content-type": "application/json",
        }

    async def generate(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
        *,
        user_id: str | None = None,
    ) -> AIResponse:
        if not self._api_key:
            raise RuntimeError("ai_anthropic_api_key not configured")

        body: dict = {
            "model": self._model,
            "max_tokens": config.ai_max_tokens,
            "messages": _build_messages(user_message, history),
            "temperature": config.ai_temperature,
            "top_p": config.ai_top_p,
        }
        if system_prompt:
            body["system"] = system_prompt

        timeout = httpx.Timeout(_DEFAULT_TIMEOUT_S)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                resp = await client.post(
                    f"{_API_BASE}/messages",
                    headers=self._headers(),
                    json=body,
                )
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                logger.warning(
                    "anthropic %s: %s",
                    exc.response.status_code,
                    exc.response.text[:200],
                )
                raise

            data = resp.json()
            text_parts = [
                block.get("text", "")
                for block in data.get("content", [])
                if block.get("type") == "text"
            ]
            text = "".join(text_parts).strip()
            usage = data.get("usage", {})
            return AIResponse(
                content=text,
                response_form="text",
                provider="anthropic",
                tokens_used=int(usage.get("input_tokens", 0)) + int(usage.get("output_tokens", 0)),
            )

    async def generate_stream(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
    ) -> AsyncIterator[str]:
        if not self._api_key:
            raise RuntimeError("ai_anthropic_api_key not configured")

        body: dict = {
            "model": self._model,
            "max_tokens": config.ai_max_tokens,
            "messages": _build_messages(user_message, history),
            "temperature": config.ai_temperature,
            "top_p": config.ai_top_p,
            "stream": True,
        }
        if system_prompt:
            body["system"] = system_prompt

        timeout = httpx.Timeout(_DEFAULT_TIMEOUT_S, read=None)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{_API_BASE}/messages",
                headers=self._headers(),
                json=body,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    payload = line[len("data: "):]
                    if payload == "[DONE]":
                        break
                    try:
                        evt = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    if evt.get("type") == "content_block_delta":
                        delta = evt.get("delta", {})
                        if delta.get("type") == "text_delta":
                            chunk = delta.get("text", "")
                            if chunk:
                                yield chunk

    async def health_check(self) -> bool:
        """Cheapest possible probe — issue an empty 1-token request and
        accept any 200. Anthropic doesn't expose a public ping endpoint."""
        if not self._api_key:
            return False
        try:
            timeout = httpx.Timeout(10.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    f"{_API_BASE}/messages",
                    headers=self._headers(),
                    json={
                        "model": self._model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}],
                    },
                )
                return resp.status_code == 200
        except Exception:  # pragma: no cover — network paths
            return False

    # ── Native tool-use (Phase 18-COMPLETE) ───────────────────────────────────

    async def call_with_tools(
        self,
        *,
        system_prompt: str,
        user_message: str,
        tools: list[ToolSchema],
        history: list[dict] | None = None,
        user_id: str | None = None,
    ) -> ToolCallResult | ToolUseError:
        """Claude native function calling via Messages API."""
        if not self._api_key:
            return ToolUseError(
                kind=ToolErrorKind.QUOTA_EXHAUSTED,
                message="ai_anthropic_api_key not configured",
                retriable=False,
                provider="anthropic",
                model=self._model,
            )

        anthropic_tools = []
        for t in tools:
            # Anthropic tool names also prefer underscores over dots
            name = t.name.replace(".", "__")
            anthropic_tools.append({
                "name": name,
                "description": (t.description or "")[:1024],
                "input_schema": t.parameters or {"type": "object", "properties": {}},
            })

        body: dict = {
            "model": self._model,
            "max_tokens": config.ai_max_tokens,
            "system": system_prompt,
            "messages": _build_messages(user_message, history or []),
            "tools": anthropic_tools,
            "temperature": config.ai_temperature,
        }

        timeout = httpx.Timeout(_DEFAULT_TIMEOUT_S)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                resp = await client.post(
                    f"{_API_BASE}/messages",
                    headers=self._headers(),
                    json=body,
                )
                resp.raise_for_status()
            except Exception as exc:
                kind, retriable, ra = _classify_anthropic_error(exc)
                return ToolUseError(
                    kind=kind,
                    message=f"anthropic api error: {exc}",
                    retriable=retriable,
                    provider="anthropic",
                    model=self._model,
                    retry_after_s=ra,
                )

            data = resp.json()
            content = data.get("content", [])
            
            text_parts = []
            tool_call = None
            
            for block in content:
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    tool_call = block
                    break
            
            if not tool_call:
                return ToolUseError(
                    kind=ToolErrorKind.MODEL_REFUSED,
                    message="Claude declined to use a tool and returned text instead",
                    retriable=True,
                    provider="anthropic",
                    model=self._model,
                )

            sanitized_name = tool_call["name"]
            # Restore dots
            original_name = sanitized_name.replace("__", ".")
            
            return ToolCallResult(
                tool_name=original_name,
                arguments=tool_call.get("input", {}),
                raw_reasoning=" ".join(text_parts).strip(),
                confidence=1.0,
                provider="anthropic",
                model=self._model,
            )
