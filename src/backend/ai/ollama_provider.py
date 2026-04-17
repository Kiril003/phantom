"""
PHANTOM OS — Ollama provider (Gemma 4 e4b local).
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from config import config
from ai.provider import AIProvider, AIResponse
from ai.response_formatter import RESPONSE_FORM_TOOLS, parse_function_call, parse_plain_text

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
