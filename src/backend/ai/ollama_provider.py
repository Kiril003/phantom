"""
PHANTOM OS — Ollama provider (Gemma 4 e4b local).
"""
from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from config import config
from ai.provider import AIProvider, AIResponse
from ai.response_formatter import RESPONSE_FORM_TOOLS, parse_function_call, parse_plain_text
from ai.tool_use import (
    ToolCallResult,
    ToolErrorKind,
    ToolSchema,
    ToolUseError,
)

logger = logging.getLogger(__name__)


def _build_ollama_tools() -> list[dict[str, Any]]:
    """Convert RESPONSE_FORM_TOOLS to OpenAI-compatible tool format for Ollama."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            },
        }
        for t in RESPONSE_FORM_TOOLS
    ]


def _build_messages(
    user_message: str,
    system_prompt: str,
    history: list[dict],
) -> list[dict[str, str]]:
    """Assemble Ollama message list with system, history, and new user message."""
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for msg in history:
        role = msg.get("role", "user")
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": msg.get("content", "")})
    messages.append({"role": "user", "content": user_message})
    return messages


class OllamaProvider(AIProvider):
    """Ollama local provider — Gemma 4 e4b (26B MoE, 4B active)."""

    def _client(self):
        import ollama
        return ollama.AsyncClient(host=config.ai_ollama_host)

    def _options(self) -> dict[str, Any]:
        return {
            "temperature": config.ai_temperature,
            "top_p": config.ai_top_p,
            "num_ctx": config.ai_ollama_num_ctx,
            "num_predict": config.ai_max_tokens,
        }

    async def generate(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
    ) -> AIResponse:
        client = self._client()
        messages = _build_messages(user_message, system_prompt, history)
        tools = _build_ollama_tools()

        response = await client.chat(
            model=config.ai_ollama_model,
            messages=messages,
            tools=tools,
            options=self._options(),
        )

        msg = response.message
        fn_name: str | None = None
        fn_args: dict[str, Any] = {}

        if msg.tool_calls:
            first_call = msg.tool_calls[0]
            fn_name = first_call.function.name
            raw_args = first_call.function.arguments
            fn_args = dict(raw_args) if isinstance(raw_args, dict) else {}

        tokens_used = 0
        if hasattr(response, "eval_count"):
            tokens_used = (response.eval_count or 0) + (
                getattr(response, "prompt_eval_count", 0) or 0
            )

        if fn_name:
            form, content, attachments = parse_function_call(fn_name, fn_args)
            if not content and msg.content:
                content = msg.content or ""
        else:
            form, content, attachments = parse_plain_text(msg.content or "")

        return AIResponse(
            content=content,
            response_form=form,
            attachments=attachments,
            provider="ollama",
            tokens_used=tokens_used,
        )

    async def generate_stream(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
    ) -> AsyncIterator[str]:
        client = self._client()
        messages = _build_messages(user_message, system_prompt, history)

        async for part in await client.chat(
            model=config.ai_ollama_model,
            messages=messages,
            options=self._options(),
            stream=True,
        ):
            delta = part.message.content if part.message else ""
            if delta:
                yield delta

    # ── Prompt-based tool use (Phase 9.2) ────────────────────────────────────

    async def call_with_tools(
        self,
        *,
        system_prompt: str,
        user_message: str,
        tools: list[ToolSchema],
        max_retries: int = 3,
    ) -> ToolCallResult | ToolUseError:
        """
        Strict-JSON mode tool use. Local models don't speak native function
        calling reliably so we coerce the prompt + format='json' into a
        {tool, arguments, reasoning} envelope and validate it against the
        provided tools list.
        """
        if not tools:
            return ToolUseError(
                kind=ToolErrorKind.INVALID_ARGS,
                message="no tools provided",
                retriable=False,
                provider="ollama",
                model=config.ai_ollama_model,
            )

        valid_names = {t.name for t in tools}
        catalog_block = _format_tools_catalog(tools)
        client = self._client()
        last_error: ToolUseError | None = None
        feedback = ""

        for attempt in range(1, max_retries + 1):
            tool_prompt = _build_tool_prompt(
                system_prompt=system_prompt,
                user_message=user_message,
                catalog_block=catalog_block,
                feedback=feedback,
            )
            try:
                response = await client.chat(
                    model=config.ai_ollama_model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": tool_prompt},
                    ],
                    options=self._options(),
                    format="json",
                )
            except Exception as exc:
                kind = (
                    ToolErrorKind.TIMEOUT
                    if "timeout" in str(exc).lower()
                    else ToolErrorKind.NETWORK
                )
                return ToolUseError(
                    kind=kind,
                    message=f"ollama network error: {exc}",
                    retriable=True,
                    provider="ollama",
                    model=config.ai_ollama_model,
                    parse_attempts=attempt,
                )

            raw = (response.message.content or "").strip()
            try:
                envelope = json.loads(raw)
            except json.JSONDecodeError as exc:
                last_error = ToolUseError(
                    kind=ToolErrorKind.PARSE_FAILED,
                    message=f"ollama returned invalid JSON: {exc}; raw={raw[:200]!r}",
                    retriable=True,
                    provider="ollama",
                    model=config.ai_ollama_model,
                    parse_attempts=attempt,
                )
                feedback = (
                    f"Your previous response was not valid JSON ({exc}). "
                    f"Return ONE object: "
                    f'{{"tool": "<name>", "arguments": {{...}}, "reasoning": "..."}}.'
                )
                continue

            tool_name = str(envelope.get("tool") or envelope.get("name") or "").strip()
            arguments = envelope.get("arguments") or envelope.get("args") or {}
            if not isinstance(arguments, dict):
                arguments = {}
            reasoning = str(envelope.get("reasoning") or envelope.get("thought") or "")

            if not tool_name:
                last_error = ToolUseError(
                    kind=ToolErrorKind.MODEL_REFUSED,
                    message="ollama envelope missing 'tool' field",
                    retriable=True,
                    provider="ollama",
                    model=config.ai_ollama_model,
                    parse_attempts=attempt,
                )
                feedback = (
                    "Your previous response had no 'tool' field. "
                    f"Pick one from: {sorted(valid_names)}."
                )
                continue

            if tool_name not in valid_names:
                last_error = ToolUseError(
                    kind=ToolErrorKind.UNKNOWN_TOOL,
                    message=(
                        f"ollama chose unknown tool '{tool_name}'. "
                        f"Valid: {sorted(valid_names)}"
                    ),
                    retriable=True,
                    provider="ollama",
                    model=config.ai_ollama_model,
                    parse_attempts=attempt,
                )
                feedback = (
                    f"Your previous response used '{tool_name}' which doesn't exist. "
                    f"Use only: {sorted(valid_names)}."
                )
                continue

            return ToolCallResult(
                tool_name=tool_name,
                arguments=arguments,
                raw_reasoning=reasoning,
                confidence=float(envelope.get("confidence") or 0.7),
                parse_attempts=attempt,
                provider="ollama",
                model=config.ai_ollama_model,
            )

        return last_error or ToolUseError(
            kind=ToolErrorKind.UNKNOWN,
            message=f"ollama call_with_tools exhausted retries (attempts={max_retries})",
            retriable=False,
            provider="ollama",
            model=config.ai_ollama_model,
            parse_attempts=max_retries,
        )

    async def health_check(self) -> bool:
        """
        Cheap reachability probe: hit Ollama's /api/tags and confirm that the
        configured model is in the installed list. Calling chat() for a ping
        would cold-start the model (~30s on Radxa 3B) and that's unreasonably
        expensive for a keep-alive — this is what we surface to the Settings
        "Test connection" button.
        """
        try:
            import httpx
            host = config.ai_ollama_host.rstrip("/")
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{host}/api/tags")
                res.raise_for_status()
                names = [m.get("name") for m in (res.json().get("models") or [])]
            return config.ai_ollama_model in names
        except Exception as exc:
            logger.debug("Ollama health check failed: %s", exc)
            return False


# ── Helpers for call_with_tools ────────────────────────────────────────────────


def _format_tools_catalog(tools: list[ToolSchema]) -> str:
    """Pretty-format a tools list for inclusion in the prompt."""
    lines: list[str] = []
    for t in tools:
        params = t.parameters or {"type": "object", "properties": {}}
        prop_lines: list[str] = []
        for pname, pdef in (params.get("properties") or {}).items():
            ptype = pdef.get("type", "string")
            req = " (required)" if pname in (params.get("required") or []) else ""
            desc = pdef.get("description", "")
            prop_lines.append(f"      - {pname}: {ptype}{req}{(' — ' + desc) if desc else ''}")
        params_block = "\n".join(prop_lines) if prop_lines else "      (no arguments)"
        lines.append(
            f"  - name: {t.name}\n"
            f"    description: {t.description.strip().splitlines()[0][:200] if t.description else ''}\n"
            f"    risk_level: {t.risk_level}\n"
            f"    parameters:\n{params_block}"
        )
    return "\n".join(lines)


def _build_tool_prompt(
    *,
    system_prompt: str,
    user_message: str,
    catalog_block: str,
    feedback: str,
) -> str:
    """Build the strict-JSON prompt for prompt-based tool selection."""
    feedback_block = f"\n\nIMPORTANT FEEDBACK FROM PREVIOUS ATTEMPT:\n{feedback}" if feedback else ""
    return (
        f"You must respond with ONE valid JSON object — no markdown, no prose, "
        f"no fences. The object schema is:\n\n"
        f'{{"tool": "<exact tool name>", "arguments": {{<args object>}}, '
        f'"reasoning": "<one sentence on why>"}}\n\n'
        f"Available tools:\n{catalog_block}\n\n"
        f"Request:\n{user_message}{feedback_block}\n\n"
        f"Respond with JSON only."
    )
