"""
PHANTOM OS - Tier 3: Merge Agent (Tactical Meta-Reviewer)

Synthesizes the independent critiques from the MARS Redundancy Triad.
"""
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ai import output_safety
from ai.provider import ai_router, AIResponse
from ai.agents.sub_agent import LeafResult
from ai.agents.mars import get_meta_reviewer_prompt

logger = logging.getLogger(__name__)


async def fold(
    leaves: list[LeafResult],
    user_message: str,
    history: list[dict],
    user_id: str,
    db: AsyncSession,
    task_id: str,
    provider_hint: str | None = None,
) -> AIResponse:
    """Fold the leaf responses into a single, synthesized response.

    Executes the Tactical Meta-Reviewer generation and applies the secondary
    output_safety.sanitize pass as mandated by ADR-ORC-003.
    """
    # ADR-ORC-006: Stable join order by sub_agent_idx
    sorted_leaves = sorted(leaves, key=lambda l: l.sub_idx)

    # Construct the merge history. We present the user's original message,
    # then append the leaf findings as synthesized context.
    synthesis_context = "The following are independent evaluations from your sub-agents:\n\n"
    for leaf in sorted_leaves:
        if leaf.ok:
            synthesis_context += f"--- Agent {leaf.sub_idx} Evaluation ---\n{leaf.content}\n\n"
        else:
            synthesis_context += f"--- Agent {leaf.sub_idx} Evaluation (FAILED) ---\nReason: {leaf.reason}\n\n"

    synthesis_context += "Review these findings. Resolve contradictions and synthesize the optimal response for the user."

    # We append this context to the history to form the merge LLM prompt
    appended_history = list(history)
    appended_history.append({"role": "user", "content": user_message})
    appended_history.append({"role": "system", "content": synthesis_context})

    # Call the LLM with the META_REVIEWER prompt
    ans: AIResponse = await ai_router.generate(
        user_message="Synthesize the final response.",
        system_prompt=get_meta_reviewer_prompt(),
        history=appended_history,
        user_id=user_id,
        task_id=task_id,
        provider_hint=provider_hint,
    )

    # ADR-ORC-003: Re-run sanitize on the merged final text
    sanitized = await output_safety.sanitize(ans.content, user_id=user_id, db=db)
    ans.content = sanitized.text

    # Keep track of redactions if necessary
    return ans
