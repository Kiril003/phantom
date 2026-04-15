"""
PHANTOM OS — Gemini 2.0 Flash provider via google-genai SDK.
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, Any

from config import config
from ai.provider import AIProvider, AIResponse
from ai.response_formatter import RESPONSE_FORM_TOOLS, parse_function_call, parse_plain_text

logger = logging.getLogger(__name__)

_SAFETY_OFF = [
    {"category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HATE_SPEECH",        "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",  "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT",  "threshold": "BLOCK_NONE"},
]


def _build_gemini_tools() -> list[Any]:
    """Convert RESPONSE_FORM_TOOLS to google-genai FunctionDeclaration objects."""
    from google.genai import types

    declarations: list[types.FunctionDeclaration] = []
    for tool in RESPONSE_FORM_TOOLS:
        params_schema = tool["parameters"]
        properties: dict[str, types.Schema] = {}
        required: list[str] = params_schema.get("required", [])

        for prop_name, prop_def in params_schema.get("properties", {}).items():
            prop_type_str = prop_def.get("type", "string")
            if prop_type_str == "string":
                prop_type = types.Type.STRING
            elif prop_type_str in ("number", "integer"):
                prop_type = types.Type.NUMBER
            elif prop_type_str == "boolean":
                prop_type = types.Type.BOOLEAN
            elif prop_type_str == "array":
                prop_type = types.Type.ARRAY
            else:
                prop_type = types.Type.OBJECT

            schema_kwargs: dict[str, Any] = {"type": prop_type}
            if "enum" in prop_def:
                schema_kwargs["enum"] = prop_def["enum"]
            if "description" in prop_def:
                schema_kwargs["description"] = prop_def["description"]
            if prop_type_str == "array":
                schema_kwargs["items"] = types.Schema(type=types.Type.OBJECT)

            properties[prop_name] = types.Schema(**schema_kwargs)

        declarations.append(
            types.FunctionDeclaration(
                name=tool["name"],
                description=tool["description"],
                parameters=types.Schema(
                    type=types.Type.OBJECT,
                    properties=properties,
                    required=required,
                ),
            )
        )
    return [types.Tool(function_declarations=declarations)]


def _get_client():
    """Lazily create google.genai.Client. Raises if API key is missing."""
    from google import genai

    api_key = config.ai_gemini_api_key
    if not api_key:
        raise RuntimeError(
            "Gemini API key not configured. Set AI_GEMINI_API_KEY in .env or settings."
        )
    return genai.Client(api_key=api_key)


def _build_contents(
    user_message: str,
    history: list[dict],
) -> list[dict[str, Any]]:
    """
    Build the contents list for Gemini from conversation history + new user message.
    Gemini expects: [{"role": "user"|"model", "parts": [{"text": "..."}]}, ...]
    """
    contents: list[dict[str, Any]] = []
    for msg in history:
        role = "model" if msg.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": msg.get("content", "")}]})
    contents.append({"role": "user", "parts": [{"text": user_message}]})
    return contents


class GeminiProvider(AIProvider):
    """Gemini 2.0 Flash via google-genai async SDK."""

    async def generate(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
    ) -> AIResponse:
        from google.genai import types

        client = _get_client()
        contents = _build_contents(user_message, history)
        tools = _build_gemini_tools()

        gen_config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=config.ai_temperature,
            top_p=config.ai_top_p,
            top_k=40,
            max_output_tokens=config.ai_max_tokens,
            tools=tools,
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(mode="AUTO"),
            ),
            safety_settings=[
                types.SafetySetting(**s) for s in _SAFETY_OFF
            ],
        )

        response = await client.aio.models.generate_content(
            model=config.ai_gemini_model,
            contents=contents,
            config=gen_config,
        )

        # Extract function call or plain text
        fn_name: str | None = None
        fn_args: dict[str, Any] = {}
        text_parts: list[str] = []

        candidate = response.candidates[0] if response.candidates else None
        if candidate and candidate.content and candidate.content.parts:
            for part in candidate.content.parts:
                if hasattr(part, "function_call") and part.function_call:
                    fn_name = part.function_call.name
                    fn_args = dict(part.function_call.args) if part.function_call.args else {}
                elif hasattr(part, "text") and part.text:
                    text_parts.append(part.text)

        tokens_used = 0
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            tokens_used = (
                getattr(response.usage_metadata, "total_token_count", 0) or 0
            )

        if fn_name:
            form, content, attachments = parse_function_call(fn_name, fn_args)
            # Merge any plain-text parts into content if content is empty
            if not content and text_parts:
                content = " ".join(text_parts)
        else:
            full_text = " ".join(text_parts).strip() or (response.text or "")
            form, content, attachments = parse_plain_text(full_text)

        return AIResponse(
            content=content,
            response_form=form,
            attachments=attachments,
            provider="gemini",
            tokens_used=tokens_used,
        )

    async def generate_stream(
        self,
        user_message: str,
        system_prompt: str,
        history: list[dict],
    ) -> AsyncIterator[str]:
        from google.genai import types

        client = _get_client()
        contents = _build_contents(user_message, history)

        gen_config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=config.ai_temperature,
            top_p=config.ai_top_p,
            top_k=40,
            max_output_tokens=config.ai_max_tokens,
            safety_settings=[
                types.SafetySetting(**s) for s in _SAFETY_OFF
            ],
        )

        async for chunk in await client.aio.models.generate_content_stream(
            model=config.ai_gemini_model,
            contents=contents,
            config=gen_config,
        ):
            if chunk.text:
                yield chunk.text

    async def health_check(self) -> bool:
        try:
            client = _get_client()
            from google.genai import types
            response = await client.aio.models.generate_content(
                model=config.ai_gemini_model,
                contents=[{"role": "user", "parts": [{"text": "ping"}]}],
                config=types.GenerateContentConfig(max_output_tokens=4),
            )
            return bool(response)
        except Exception as exc:
            logger.debug("Gemini health check failed: %s", exc)
            return False
