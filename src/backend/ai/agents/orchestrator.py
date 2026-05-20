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
import secrets
from enum import Enum
from typing import Any, Awaitable, Callable

from config import config

from ai.agents.budget import split, gather_with_deadline, LeafTimeout
from ai.agents.nonce import fresh_sub_nonce
from ai.agents.mars import get_triad_prompts
from ai.agents.sub_agent import run_leaf, LeafResult
from ai.agents.merge import fold

logger = logging.getLogger(__name__)

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
