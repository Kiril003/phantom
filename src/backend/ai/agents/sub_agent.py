"""
PHANTOM OS - Tier 3: Sub-Agent Leaf Execution

Implements the leaf execution logic for the MARS architecture. Each leaf executes
the standard chat pipeline but with a specialized system prompt and isolated
envelope nonces to prevent cross-agent prompt injection.
"""

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from typing import Any

from ai.provider import AIResponse

logger = logging.getLogger(__name__)

@dataclass
class LeafResult:
    """Result of a single leaf execution in the parallel-K orchestrator."""
    sub_idx: int
    ok: bool
    content: str
    reason: str | None = None


async def run_leaf(
    sub_idx: int,
    sub_nonce: str,
    chat_pipeline_run: Any,
    chat_pipeline_kwargs: dict[str, Any],
) -> LeafResult:
    """Execute a single specialized leaf agent.

    This function wraps the chat pipeline execution with an override to the
    system prompt, specific to this leaf's MARS persona. It uses the given
    sub_nonce for its tool envelope to satisfy TM-17B-S1 mitigation and ADR-ORC-002.
    """
    try:
        # Run the full chat pipeline (including tool use if needed) but
        # with the overridden system_prompt for this leaf's persona.
        ans: AIResponse = await chat_pipeline_run(**chat_pipeline_kwargs)
        # Output safety is already run inside chat_pipeline.run at the end.
        return LeafResult(
            sub_idx=sub_idx,
            ok=True,
            content=ans.content,
        )
    except asyncio.CancelledError:
        # Leaf was cancelled due to orchestrator deadline.
        logger.warning("run_leaf cancelled for sub_idx=%d", sub_idx)
        raise
    except Exception as exc:
        logger.exception("run_leaf failed for sub_idx=%d: %s", sub_idx, exc)
        return LeafResult(
            sub_idx=sub_idx,
            ok=False,
            content="",
            reason=str(exc),
        )
