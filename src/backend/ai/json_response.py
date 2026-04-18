"""
Strict-JSON-response helper, lifted from agent/planner/_llm.py for reuse.

Strategic + reflector planners still need free-form text → JSON parsing
(they're not picking tools, they're producing structured plans). This module
keeps that one helper in shared shape so the reliability story is uniform:
parse → on JSONDecodeError retry once with the prior output as context.

Tactical now uses tool_use.ToolUseProvider instead — see tool_use.py.
"""
from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger(__name__)

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


class JsonResponseError(Exception):
    """Raised when an LLM call cannot be coerced into valid JSON."""


def strip_json_fences(text: str) -> str:
    text = (text or "").strip()
    m = _FENCE_RE.search(text)
    if m:
        return m.group(1).strip()
    return text


def parse_json(text: str) -> dict:
    """Best-effort JSON parse. Strips ```json fences first."""
    candidate = strip_json_fences(text)
    return json.loads(candidate)


async def llm_json_with_retry(
    *,
    call,
    prompt: str,
    retry_message: str | None = None,
) -> dict:
    """
    `call` is an async callable: prompt -> str. One retry on JSONDecodeError.

    Tests can pass a stub `call`. Production passes a wrapper around ai_router.
    Raises JsonResponseError if both attempts fail.
    """
    text = await call(prompt)
    try:
        return parse_json(text)
    except json.JSONDecodeError as exc:
        logger.warning("planner JSON parse failed: %s — retrying once", exc)
        retry_prompt = (
            (retry_message or "Your previous output was not valid JSON. Return ONLY the JSON object.")
            + f"\n\nPrior output:\n{text}\n\nOriginal prompt:\n{prompt}"
        )
        retry_text = await call(retry_prompt)
        try:
            return parse_json(retry_text)
        except json.JSONDecodeError as exc2:
            raise JsonResponseError(
                f"LLM produced invalid JSON twice: {exc2}; last_text={retry_text[:200]!r}"
            ) from exc2


__all__ = ["JsonResponseError", "strip_json_fences", "parse_json", "llm_json_with_retry"]
