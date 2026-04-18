"""
LLM glue for planners — strict JSON, one retry on parse failure.

Strategic + reflector planners still produce free-form JSON (they're not
calling tools). Tactical now uses ai.tool_use.ToolUseProvider directly.

This module is a thin wrapper over ai.json_response so tests can monkey-patch
`_call` to inject scripted responses.
"""
from __future__ import annotations

import logging

from ai.json_response import JsonResponseError, llm_json_with_retry, parse_json
from ai.provider import ai_router

logger = logging.getLogger(__name__)


# Back-compat alias — existing callers raise PlannerLLMError.
class PlannerLLMError(JsonResponseError):
    """Raised when an LLM call cannot be coerced into valid JSON."""


async def _call(prompt: str) -> str:
    """Single LLM call. Wraps ai_router so tests can patch this one symbol."""
    response = await ai_router.generate(
        user_message=prompt,
        system_prompt=(
            "You are PHANTOM's internal planner. "
            "Respond with strict JSON only. No markdown, no prose, no fences."
        ),
        history=[],
    )
    return response.content or ""


async def llm_json(prompt: str, retry_message: str | None = None) -> dict:
    """
    Call the LLM with strict-JSON discipline. One retry on JSON parse failure.

    Raises PlannerLLMError if both attempts fail.
    """
    try:
        return await llm_json_with_retry(call=_call, prompt=prompt, retry_message=retry_message)
    except JsonResponseError as exc:
        # Re-wrap so legacy except-clauses keep matching PlannerLLMError.
        raise PlannerLLMError(str(exc)) from exc


__all__ = ["PlannerLLMError", "llm_json", "parse_json"]
