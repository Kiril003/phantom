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
from ai.provider import BlockedQuotaError, ai_router
from config import config

logger = logging.getLogger(__name__)


# Back-compat alias — existing callers raise PlannerLLMError.
class PlannerLLMError(JsonResponseError):
    """Raised when an LLM call cannot be coerced into valid JSON."""


# BlockedQuotaError is re-exported from ai.provider so call sites that catch
# `BlockedQuotaError` keep working AND llm_json's JsonResponseError clause does
# not silently swallow it. (Phase 9.2.2 — F-02.)


async def _call(prompt: str, *, task_id: str | None = None, model: str | None = None) -> str:
    """Single LLM call. Wraps ai_router so tests can patch this one symbol.

    Phase 9.2.2: forwards task_id so the per-task LLM-call budget actually
    counts strategic / reflector / seeds calls.
    """
    effective_model = model or config.ai_planner_model
    if effective_model == "auto":
        effective_model = config.ai_gemini_model
    return await ai_router.generate_raw(
        system_prompt=(
            "You are PHANTOM's internal planner. "
            "Respond with strict JSON only. No markdown, no prose, no fences."
        ),
        user_message=prompt,
        model=effective_model,
        max_output_tokens=config.ai_planner_max_tokens,
        temperature=0.3,
    )


async def llm_json(
    prompt: str,
    retry_message: str | None = None,
    *,
    task_id: str | None = None,
    model: str | None = None,
) -> dict:
    """
    Call the LLM with strict-JSON discipline. One retry on JSON parse failure.

    Raises PlannerLLMError on parse failure; BlockedQuotaError propagates
    untouched so the loop can park the task.
    """
    async def _bound_call(p: str) -> str:
        # 9.1-era tests monkeypatch `_call` with a single-arg fake. Detect
        # that and skip the task_id kwarg so they keep working without
        # touching the budget bridge.
        import inspect as _inspect
        try:
            sig = _inspect.signature(_call)
            params = sig.parameters
            kwargs = {}
            if "task_id" in params: kwargs["task_id"] = task_id
            if "model" in params: kwargs["model"] = model
            return await _call(p, **kwargs)
        except (TypeError, ValueError):
            pass
        return await _call(p)
    try:
        return await llm_json_with_retry(call=_bound_call, prompt=prompt, retry_message=retry_message)
    except BlockedQuotaError:
        raise
    except JsonResponseError as exc:
        # Re-wrap so legacy except-clauses keep matching PlannerLLMError.
        raise PlannerLLMError(str(exc)) from exc


__all__ = ["PlannerLLMError", "BlockedQuotaError", "llm_json", "parse_json"]
