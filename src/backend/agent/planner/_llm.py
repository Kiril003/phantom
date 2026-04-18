"""
LLM glue for planners — strict JSON, one retry on parse failure.

Wraps ai_router so all planners share consistent JSON-discipline behaviour.
Tests can monkey-patch `_call` directly to inject scripted responses.
"""
from __future__ import annotations

import json
import logging
import re

from ai.provider import ai_router

logger = logging.getLogger(__name__)

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


class PlannerLLMError(Exception):
    """Raised when an LLM call cannot be coerced into valid JSON."""


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    m = _FENCE_RE.search(text)
    if m:
        return m.group(1).strip()
    return text


def parse_json(text: str) -> dict:
    """Best-effort JSON parse. Strips ```json fences first."""
    candidate = _strip_json_fences(text)
    return json.loads(candidate)


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
    text = await _call(prompt)
    try:
        return parse_json(text)
    except json.JSONDecodeError as exc:
        logger.warning("planner JSON parse failed: %s — retrying once", exc)
        retry_prompt = (
            (retry_message or "Your previous output was not valid JSON. Return ONLY the JSON object.")
            + f"\n\nPrior output:\n{text}\n\nOriginal prompt:\n{prompt}"
        )
        retry_text = await _call(retry_prompt)
        try:
            return parse_json(retry_text)
        except json.JSONDecodeError as exc2:
            raise PlannerLLMError(
                f"LLM produced invalid JSON twice: {exc2}; last_text={retry_text[:200]!r}"
            ) from exc2
