"""
PHANTOM OS — Gemini 2.0 Flash provider via google-genai SDK.
"""
from __future__ import annotations

import logging
import re
from typing import AsyncIterator, Any

from config import config
from ai.provider import AIProvider, AIResponse
from ai.chat_tools import CHAT_DATA_TOOLS, DATA_TOOL_NAMES
from ai.response_formatter import RESPONSE_FORM_TOOLS, parse_function_call, parse_plain_text
from ai.tool_executor import MAX_TOOL_CALLS_PER_TURN, execute_tool
from ai.tool_use import (
    ToolCallResult,
    ToolErrorKind,
    ToolSchema,
    ToolUseError,
)

logger = logging.getLogger(__name__)


# ── Phase 9.2.1 — error classification ─────────────────────────────────────────
#
# We never trust just the exception class — google-genai funnels different
# upstream conditions through ClientError/ServerError. Match on the message
# substring set Google actually emits.

_QUOTA_DAILY_HINTS = (
    "per day",
    "per_day",
    "perday",
    "daily",
    "free_tier",
    "free tier",
    "generate_content_free_tier_requests",
    "PerDay",
)

_RETRY_AFTER_RE = re.compile(r"retry_delay[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*s?", re.IGNORECASE)


def _classify_gemini_error(exc: Exception) -> tuple[ToolErrorKind, bool, float | None]:
    """Map a Gemini SDK exception → (kind, retriable, retry_after_s).

    Order matters: check daily-quota text BEFORE generic 429 so quota gets
    its own non-retriable kind.
    """
    msg = str(exc)
    lower = msg.lower()

    retry_after: float | None = None
    m = _RETRY_AFTER_RE.search(msg)
    if m:
        try:
            retry_after = float(m.group(1))
        except ValueError:  # pragma: no cover — regex guarantees a number
            retry_after = None

    if "timeout" in lower or "timed out" in lower:
        return ToolErrorKind.TIMEOUT, True, retry_after

    is_429 = "429" in msg or "RESOURCE_EXHAUSTED" in msg or "rate" in lower and "limit" in lower
    if is_429:
        # Daily quota → retriable=False (no point retrying within the same UTC day).
        if "RESOURCE_EXHAUSTED" in msg and any(h in msg for h in _QUOTA_DAILY_HINTS):
            return ToolErrorKind.QUOTA_EXHAUSTED, False, retry_after
        return ToolErrorKind.RATE_LIMIT, True, retry_after

    # 5xx — provider-side hiccup, retriable.
    if any(code in msg for code in (" 500", " 502", " 503", " 504", "INTERNAL", "UNAVAILABLE")):
        return ToolErrorKind.PROVIDER_UNAVAILABLE, True, retry_after

    return ToolErrorKind.NETWORK, True, retry_after

_SAFETY_OFF = [
    {"category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HATE_SPEECH",        "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",  "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT",  "threshold": "BLOCK_NONE"},
]


def _build_gemini_tools(tool_dicts: list[dict[str, Any]] | None = None) -> list[Any]:
    """Convert tool dicts to google-genai FunctionDeclaration objects.

    Default catalog is ``RESPONSE_FORM_TOOLS``. Pass a merged list (e.g.
    ``RESPONSE_FORM_TOOLS + CHAT_DATA_TOOLS``) to include chat data tools.
    """
    from google.genai import types

    catalog = RESPONSE_FORM_TOOLS if tool_dicts is None else tool_dicts
    declarations: list[types.FunctionDeclaration] = []
    for tool in catalog:
        params_schema = tool["parameters"]
        properties: dict[str, types.Schema] = {}
        required: list[str] = params_schema.get("required", [])

        for prop_name, prop_def in params_schema.get("properties", {}).items():
            prop_type_str = prop_def.get("type", "string")
            if prop_type_str == "string":
                prop_type = types.Type.STRING
            elif prop_type_str == "integer":
                prop_type = types.Type.INTEGER
            elif prop_type_str == "number":
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
                items = prop_def.get("items") or {"type": "object"}
                item_type_str = items.get("type", "object")
                item_type = {
                    "string": types.Type.STRING,
                    "integer": types.Type.INTEGER,
                    "number": types.Type.NUMBER,
                    "boolean": types.Type.BOOLEAN,
                    "object": types.Type.OBJECT,
                }.get(item_type_str, types.Type.OBJECT)
                schema_kwargs["items"] = types.Schema(type=item_type)

            properties[prop_name] = types.Schema(**schema_kwargs)

        # Only pass `required` when it's non-empty — Gemini rejects an empty
        # required list paired with an empty properties map.
        schema_kwargs_outer: dict[str, Any] = {
            "type": types.Type.OBJECT,
            "properties": properties,
        }
        if required:
            schema_kwargs_outer["required"] = required

        declarations.append(
            types.FunctionDeclaration(
                name=tool["name"],
                description=tool["description"],
                parameters=types.Schema(**schema_kwargs_outer),
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
        *,
        user_id: str | None = None,
    ) -> AIResponse:
        """
        Chat response with optional data-tool roundtrip (Phase 10).

        When ``user_id`` is provided, ``CHAT_DATA_TOOLS`` are merged into the
        function catalog. If Gemini picks a data tool, we execute it, attach
        the result as a tool_response Part, and call the model again (up to
        ``MAX_TOOL_CALLS_PER_TURN`` data calls). After the cap is reached we
        force a final call WITHOUT data tools so the model must pick a
        response form or reply with text.
        """
        from google.genai import types

        client = _get_client()
        contents = _build_contents(user_message, history)

        with_data_tools = user_id is not None
        
        # Only use chat tools if user_id is provided. Planners (like strategic planner)
        # do not pass user_id and expect strict text/JSON output, so passing tools
        # would confuse the model into calling a response formatter tool.
        if user_id is not None:
            catalog = [*RESPONSE_FORM_TOOLS, *CHAT_DATA_TOOLS]
            tools = _build_gemini_tools(catalog)
            tools_no_data = _build_gemini_tools(list(RESPONSE_FORM_TOOLS))
        else:
            tools = None
            tools_no_data = None

        base_gen_kwargs = dict(
            system_instruction=system_prompt,
            temperature=config.ai_temperature,
            top_p=config.ai_top_p,
            top_k=40,
            max_output_tokens=config.ai_max_tokens,
            safety_settings=[types.SafetySetting(**s) for s in _SAFETY_OFF],
        )
        
        if tools is not None:
            base_gen_kwargs["tool_config"] = types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(mode="AUTO"),
            )

        data_calls_made = 0
        tool_trace: list[dict[str, Any]] = []
        tokens_total = 0

        while True:
            current_tools = (
                tools if (with_data_tools and data_calls_made < MAX_TOOL_CALLS_PER_TURN)
                else tools_no_data
            )
            gen_kwargs = {**base_gen_kwargs}
            if current_tools is not None:
                gen_kwargs["tools"] = current_tools
                
            gen_config = types.GenerateContentConfig(**gen_kwargs)
            response = await client.aio.models.generate_content(
                model=config.ai_gemini_model,
                contents=contents,
                config=gen_config,
            )

            if hasattr(response, "usage_metadata") and response.usage_metadata:
                tokens_total += (
                    getattr(response.usage_metadata, "total_token_count", 0) or 0
                )

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

            # Data tool? Execute, push tool_response, loop.
            if (
                with_data_tools
                and fn_name in DATA_TOOL_NAMES
                and data_calls_made < MAX_TOOL_CALLS_PER_TURN
            ):
                data_calls_made += 1
                tool_result = await execute_tool(fn_name, fn_args, user_id)
                tool_trace.append({
                    "tool": fn_name,
                    "ok": bool(tool_result.get("ok")),
                    "error_kind": tool_result.get("error_kind"),
                    "elapsed_ms": tool_result.get("_elapsed_ms"),
                })
                logger.info(
                    "chat tool-use: %s (%d/%d) -> %s",
                    fn_name, data_calls_made, MAX_TOOL_CALLS_PER_TURN,
                    "ok" if tool_result.get("ok") else tool_result.get("error_kind", "err"),
                )
                # Append the model turn (with function_call) and the user turn
                # (with function_response) so the follow-up call has full context.
                contents.append({
                    "role": "model",
                    "parts": [{"function_call": {"name": fn_name, "args": fn_args}}],
                })
                contents.append({
                    "role": "user",
                    "parts": [
                        {
                            "function_response": {
                                "name": fn_name,
                                "response": tool_result,
                            }
                        }
                    ],
                })
                continue

            # Response form OR plain text — finalize.
            finish_reason = (
                getattr(candidate, "finish_reason", None) if candidate else None
            )
            if fn_name:
                form, content, attachments = parse_function_call(fn_name, fn_args)
                # Text-like forms (text/markdown) need content even when
                # attachments are present, otherwise the bubble renders blank.
                expects_content = form in ("text", "markdown")
                if not content and (not attachments or expects_content):
                    content = " ".join(text_parts).strip() or (response.text or "").strip()
                    if not content:
                        logger.warning(
                            "Gemini returned empty %s function_call with no fallback text; "
                            "model=%s tokens=%d finish_reason=%s",
                            fn_name, config.ai_gemini_model, tokens_total, finish_reason,
                        )
                        content = (
                            "Не встиг сформулювати — перепитай?"
                            if expects_content
                            else "…"
                        )
            else:
                full_text = " ".join(text_parts).strip() or (response.text or "")
                form, content, attachments = parse_plain_text(full_text)
                # Plain-text branch had NO empty-content guard pre-10.4 —
                # empty Gemini turns (e.g. MAX_TOKENS with system prompt
                # eating budget) leaked content="" straight into the DB.
                if not content and not attachments:
                    logger.warning(
                        "Gemini returned empty plain-text response; "
                        "model=%s tokens=%d finish_reason=%s",
                        config.ai_gemini_model, tokens_total, finish_reason,
                    )
                    content = "Не встиг сформулювати — перепитай?"

            return AIResponse(
                content=content,
                response_form=form,
                attachments=attachments,
                provider="gemini",
                tokens_used=tokens_total,
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
        """
        Single minimal Gemini API request — verifies key + model are reachable.
        "ping" ≈ 1 input token, 5 max output tokens, no tools/safety/system
        instruction. No retries, no fallbacks.
        """
        try:
            client = _get_client()
            from google.genai import types
            response = await client.aio.models.generate_content(
                model=config.ai_gemini_model,
                contents=[{"role": "user", "parts": [{"text": "ping"}]}],
                config=types.GenerateContentConfig(max_output_tokens=5),
            )
            return bool(response)
        except Exception as exc:
            logger.debug("Gemini health check failed: %s", exc)
            return False

    # ── Native tool-use (Phase 9.2) ───────────────────────────────────────────

    async def call_with_tools(
        self,
        *,
        system_prompt: str,
        user_message: str,
        tools: list[ToolSchema],
        max_retries: int = 3,
    ) -> ToolCallResult | ToolUseError:
        """
        Native Gemini function calling. Returns ToolCallResult if Gemini picked
        a tool from `tools`, or ToolUseError otherwise.

        Retries up to `max_retries-1` times on UNKNOWN_TOOL / INVALID_ARGS by
        appending the validation error to the prompt.
        """
        if not tools:
            return ToolUseError(
                kind=ToolErrorKind.INVALID_ARGS,
                message="no tools provided",
                retriable=False,
                provider="gemini",
                model=config.ai_gemini_model,
            )

        from google.genai import types

        valid_names = {t.name for t in tools}
        attempts = 0
        last_error: ToolUseError | None = None
        prompt = user_message

        while attempts < max_retries:
            attempts += 1
            try:
                client = _get_client()
                gen_config = types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=config.ai_temperature,
                    max_output_tokens=config.ai_max_tokens,
                    tools=[_tools_for_call_with_tools(tools)],
                    tool_config=types.ToolConfig(
                        function_calling_config=types.FunctionCallingConfig(mode="ANY"),
                    ),
                    safety_settings=[types.SafetySetting(**s) for s in _SAFETY_OFF],
                )
                response = await client.aio.models.generate_content(
                    model=config.ai_gemini_model,
                    contents=[{"role": "user", "parts": [{"text": prompt}]}],
                    config=gen_config,
                )
            except Exception as exc:
                kind, retriable, retry_after_s = _classify_gemini_error(exc)
                return ToolUseError(
                    kind=kind,
                    message=f"gemini network/api error: {exc}",
                    retriable=retriable,
                    provider="gemini",
                    model=config.ai_gemini_model,
                    parse_attempts=attempts,
                    retry_after_s=retry_after_s,
                )

            fn_name, fn_args, text = _extract_function_call(response)
            if fn_name is None:
                last_error = ToolUseError(
                    kind=ToolErrorKind.MODEL_REFUSED,
                    message=f"gemini returned text without a function_call: {text[:200]!r}",
                    retriable=True,
                    provider="gemini",
                    model=config.ai_gemini_model,
                    parse_attempts=attempts,
                )
                prompt = (
                    user_message
                    + f"\n\nYour previous reply was prose, not a function_call. "
                    f"Pick exactly one tool from: {sorted(valid_names)}."
                )
                continue

            if fn_name not in valid_names:
                last_error = ToolUseError(
                    kind=ToolErrorKind.UNKNOWN_TOOL,
                    message=(
                        f"gemini chose unknown tool '{fn_name}'. "
                        f"Valid: {sorted(valid_names)}"
                    ),
                    retriable=True,
                    provider="gemini",
                    model=config.ai_gemini_model,
                    parse_attempts=attempts,
                )
                prompt = (
                    user_message
                    + f"\n\nYour previous reply named '{fn_name}', which is NOT a valid "
                    f"tool. Pick exactly one of: {sorted(valid_names)}."
                )
                continue

            return ToolCallResult(
                tool_name=fn_name,
                arguments=fn_args,
                raw_reasoning=text,
                confidence=1.0,
                parse_attempts=attempts,
                provider="gemini",
                model=config.ai_gemini_model,
            )

        return last_error or ToolUseError(
            kind=ToolErrorKind.UNKNOWN,
            message=f"gemini call_with_tools exhausted retries (attempts={attempts})",
            retriable=False,
            provider="gemini",
            model=config.ai_gemini_model,
            parse_attempts=attempts,
        )


# ── Helpers for call_with_tools ────────────────────────────────────────────────


def _json_schema_to_genai_schema(prop: dict[str, Any]) -> Any:
    """Translate one JSON-Schema property dict → google.genai.types.Schema."""
    from google.genai import types

    js_type = (prop.get("type") or "string").lower()
    type_map = {
        "string": types.Type.STRING,
        "integer": types.Type.INTEGER,
        "number": types.Type.NUMBER,
        "boolean": types.Type.BOOLEAN,
        "array": types.Type.ARRAY,
        "object": types.Type.OBJECT,
    }
    kwargs: dict[str, Any] = {"type": type_map.get(js_type, types.Type.STRING)}
    if "description" in prop:
        kwargs["description"] = prop["description"]
    if "enum" in prop:
        kwargs["enum"] = list(prop["enum"])
    if js_type == "array":
        items = prop.get("items") or {"type": "string"}
        kwargs["items"] = _json_schema_to_genai_schema(items)
    if js_type == "object":
        sub_props: dict[str, Any] = {}
        for sk, sv in (prop.get("properties") or {}).items():
            sub_props[sk] = _json_schema_to_genai_schema(sv)
        if sub_props:
            kwargs["properties"] = sub_props
        if "required" in prop:
            kwargs["required"] = list(prop["required"])
    return types.Schema(**kwargs)


def _tools_for_call_with_tools(tools: list[ToolSchema]) -> Any:
    """Convert ToolSchema list → google.genai.types.Tool with FunctionDeclarations."""
    from google.genai import types

    declarations: list[Any] = []
    for tool in tools:
        params = tool.parameters or {"type": "object", "properties": {}}
        properties: dict[str, Any] = {}
        for pname, pdef in (params.get("properties") or {}).items():
            properties[pname] = _json_schema_to_genai_schema(pdef)
        schema_kwargs: dict[str, Any] = {
            "type": types.Type.OBJECT,
            "properties": properties,
        }
        if tool.required:
            schema_kwargs["required"] = list(tool.required)
        declarations.append(
            types.FunctionDeclaration(
                name=tool.name,
                description=(tool.description or "")[:1024],
                parameters=types.Schema(**schema_kwargs),
            )
        )
    return types.Tool(function_declarations=declarations)


def _extract_function_call(response: Any) -> tuple[str | None, dict[str, Any], str]:
    """Pull (function_name, args, text) out of a Gemini response."""
    fn_name: str | None = None
    fn_args: dict[str, Any] = {}
    text_parts: list[str] = []

    candidate = response.candidates[0] if getattr(response, "candidates", None) else None
    if candidate and getattr(candidate, "content", None) and candidate.content.parts:
        for part in candidate.content.parts:
            if hasattr(part, "function_call") and part.function_call:
                fn_name = part.function_call.name
                args = part.function_call.args
                fn_args = dict(args) if args else {}
            elif hasattr(part, "text") and part.text:
                text_parts.append(part.text)
    return fn_name, fn_args, " ".join(text_parts).strip()
