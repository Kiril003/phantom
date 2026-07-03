"""Day-4 Wave-2 X-1 — chat orchestrator entry (ADR-ORC-001).

`run_orchestrator()` is the single entry routes_chat invokes for every
chat turn. The orchestrator decides per-call between:

  - `single`     — call `chat_pipeline.run()` unchanged (back-compat
                   invariant; Day-3 single-turn path).
  - `parallel-K` — fan-out across K sub-agents (X-3/X-4 work).
"""
from __future__ import annotations

import asyncio
import logging
import re
import secrets
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Awaitable, Callable

from config import config

from ai.agents.budget import split, gather_with_deadline, LeafTimeout
from ai.agents.nonce import fresh_sub_nonce
from ai.agents.mars import get_triad_prompts
from ai.agents.sub_agent import run_leaf, LeafResult
from ai.agents.merge import fold

logger = logging.getLogger(__name__)

_VOWELS = set("aeiouаеєиіїоуюяАЕЄИІЇОУЮЯ")
_GREETINGS = {
    "привіт", "здоров", "хай", "ку", "вітаю", "добрий день", "добрий вечір",
    "доброго ранку", "hi", "hello", "hey", "yo", "morning", "evening",
    "як справи", "як ти", "що робиш", "how are you", "what's up", "як воно",
    "ok", "ок", "окей", "добре", "ясно", "зрозумів", "зрозуміла",
    # Emotional / social
    "дякую", "дякую велике", "спасибі", "спасибо", "thanks", "thank you",
    "чудово", "відмінно", "супер", "круто", "клас", "класно", "чудесно",
    "ти молодець", "молодець", "добре зробив", "добре зроблено",
    # Simple confirmations
    "так", "ні", "ага", "угу", "неа", "nope", "nah", "yeah", "yep", "sure",
    # Opinion prompts too short to need tools
    "що думаєш", "як думаєш", "твоя думка",
}

# Zero-latency regex patterns for factual time/date queries
_TIME_QUERY_RE = re.compile(
    r"(котра|яка)\s+(година|час|пора)|скільки\s+(час|години|зараз)"
    r"|(котра|яка)\s+зараз|(which|what)\s+time",
    re.I,
)
_DATE_QUERY_RE = re.compile(
    r"(який|яке|яка)\s+(день|дата|число|тиждень|місяць|рік)"
    r"|сьогодні\s+(що|яке|яка)|яке\s+сьогодні"
    r"|today.*date|what.*date.*today",
    re.I,
)

_MONTHS_UA = [
    "січня", "лютого", "березня", "квітня", "травня", "червня",
    "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
]


def _is_conversational(text: str) -> bool:
    """True → skip orchestrator, go straight to chat_pipeline."""
    stripped = text.strip()
    if len(stripped) <= 15:
        return True
    if len(stripped) <= 20 and " " not in stripped:
        return True
    lower = stripped.lower().strip("?!. ")
    if lower in _GREETINGS:
        return True
    # Emotional / social messages (longer variants not in _GREETINGS exact set)
    if lower.startswith(("дякую", "спасибі", "дуже дякую", "молодець", "чудово")):
        return True
    # Typo/random chars: short token with very low vowel ratio
    first_token = stripped.split()[0] if stripped.split() else stripped
    if len(first_token) >= 3:
        vowel_count = sum(1 for c in first_token if c in _VOWELS)
        if vowel_count == 0:
            return True
        ratio = vowel_count / len(first_token)
        if ratio < 0.1 and len(first_token) <= 8:
            return True
    return False


def _build_time_response() -> Any:
    """Pre-built AIResponse for time queries — zero LLM calls."""
    from ai.provider import AIResponse
    now = datetime.now(tz=timezone.utc)
    time_str = now.strftime("%H:%M")
    return AIResponse(content=f"Зараз {time_str} (UTC).", provider="system", tokens_used=0)


def _build_date_response() -> Any:
    """Pre-built AIResponse for date queries — zero LLM calls."""
    from ai.provider import AIResponse
    now = datetime.now(tz=timezone.utc)
    day = now.day
    month = _MONTHS_UA[now.month - 1]
    year = now.year
    return AIResponse(content=f"Сьогодні {day} {month} {year} року.", provider="system", tokens_used=0)


class OrchestratorMode(Enum):
    single = "single"
    parallel_k = "parallel-K"


def decide_mode(
    *,
    provider: str,
    flag_enabled: bool | None = None,
    user_text: str | None = None,
) -> OrchestratorMode:
    flag = (
        flag_enabled
        if flag_enabled is not None
        else bool(config.chat_orchestrator_enabled)
    )
    if not flag:
        return OrchestratorMode.single
    # Gemini-only on Day-4 per TM-17B-S2.
    if provider not in ("gemini", "gemini-flash"):
        return OrchestratorMode.single

    return OrchestratorMode.parallel_k


ChatPipelineRun = Callable[..., Awaitable[Any]]


async def run_orchestrator(
    *,
    user_text: str,
    provider: str,
    chat_pipeline_run: ChatPipelineRun,
    **chat_pipeline_kwargs: Any,
) -> Any:
    # Zero-latency: factual time/date queries never need an LLM call
    if _TIME_QUERY_RE.search(user_text):
        logger.debug("run_orchestrator: zero-latency time query")
        return _build_time_response()
    if _DATE_QUERY_RE.search(user_text):
        logger.debug("run_orchestrator: zero-latency date query")
        return _build_date_response()

    # Fast-track: conversational/short/typo messages bypass orchestrator entirely
    if _is_conversational(user_text):
        logger.debug("run_orchestrator: fast-track for %r", user_text[:30])
        chat_pipeline_kwargs.setdefault("provider_hint", provider)
        return await chat_pipeline_run(**chat_pipeline_kwargs)

    mode = decide_mode(provider=provider, user_text=user_text)
    chat_pipeline_kwargs.setdefault("provider_hint", provider)
    
    if mode is OrchestratorMode.single:
        return await chat_pipeline_run(**chat_pipeline_kwargs)
        
    # Phase A: Total Coverage Autonomous Swarm - MARS Integration
    # Create parallel K=3 branches using MARS triad
    K = 3
    # Use synthetic task_id for budget tracking
    synthetic_task_id = f"chat-orch-{secrets.token_hex(8)}"
    
    # Calculate budget split
    total_ms = int(config.chat_tool_max_total_ms)
    merge_reserve_ms = 2000 # Configurable reserve
    
    b_split = split(total_ms, K, merge_reserve_ms)
    
    if b_split.per_sub_ms <= 500:
        logger.warning("run_orchestrator: Budget too small (%d ms per sub), falling back to single mode.", b_split.per_sub_ms)
        return await chat_pipeline_run(**chat_pipeline_kwargs)

    prompts = get_triad_prompts()
    
    coros = []
    for sub_idx in range(K):
        sub_nonce = fresh_sub_nonce()
        kwargs = dict(chat_pipeline_kwargs)
        # Ensure user_message is set for the leaf if not already present
        kwargs.setdefault("user_message", user_text)
        kwargs["system_prompt"] = prompts[sub_idx]
        # K parallel leaves must never interleave deltas into one bubble.
        kwargs.pop("on_delta", None)
        
        coros.append(
            run_leaf(
                sub_idx=sub_idx,
                sub_nonce=sub_nonce,
                chat_pipeline_run=chat_pipeline_run,
                chat_pipeline_kwargs=kwargs,
            )
        )

    # Gather with deadline (gather_with_deadline handles no-cancel contract)
    deadline_s = b_split.per_sub_ms / 1000.0
    results, timed_out_indices = await gather_with_deadline(coros, deadline_s=deadline_s)

    leaves: list[LeafResult] = []
    for idx, res in enumerate(results):
        if isinstance(res, LeafTimeout):
            leaves.append(LeafResult(sub_idx=idx, ok=False, content="", reason="leaf_timeout"))
        elif isinstance(res, Exception):
            leaves.append(LeafResult(sub_idx=idx, ok=False, content="", reason=str(res)))
        else:
            leaves.append(res)
            
    # Merge outputs using the Meta-Reviewer persona
    ans = await fold(
        leaves=leaves,
        user_message=user_text,
        history=chat_pipeline_kwargs.get("history", []),
        user_id=chat_pipeline_kwargs.get("user_id", ""),
        db=chat_pipeline_kwargs.get("db"),
        task_id=synthetic_task_id,
        provider_hint=provider,
    )

    return ans
