"""Day-4 Wave-2 X-2 — per-sub-agent nonce + leaf-merge sanitize hook
(ADR-ORC-002 + ADR-ORC-003).

Per ADR-ORC-002:
  - Each sub-agent leaf invocation generates its own `sub_nonce`
    (fresh `secrets.token_hex(8)`).
  - The leaf builds its tool-result envelope keyed
    `_phantom_sub_<sub_idx>_<sub_nonce>` — distinct per leaf so a
    compromised leaf cannot forge ANOTHER leaf's envelope.
  - The orchestrator's MERGE envelope reuses the existing module-level
    `_PROCESS_NONCE` from `src/backend/ai/chat_pipeline.py:60-61` —
    the merge LLM cannot forge leaf-result markers either.

Per ADR-ORC-003 (leaf-then-merge sanitize):
  - `sanitize_leaf_draft(text, user_id, db)` runs at every leaf BEFORE
    its draft is concatenated into the merge history. Sensitive
    `MemoryFact` content is redacted at the leaf so the merge LLM
    never SEES the verbatim quote → cannot honestly reproduce one
    even if asked.
  - Fail-open invariant: a sanitize crash at the leaf returns the
    original draft; never blocks the leaf.

Day-4 X-2 ships ONLY the nonce + sanitize wrapper. Sub-agent
execution itself lands in X-3/X-4.
"""
from __future__ import annotations

import logging
import secrets
from typing import TYPE_CHECKING, Any

logger = logging.getLogger(__name__)

if TYPE_CHECKING:  # pragma: no cover
    from sqlalchemy.ext.asyncio import AsyncSession


_NONCE_HEX_BYTES = 8


def fresh_sub_nonce() -> str:
    """Generate a fresh per-leaf nonce (16-char hex string).

    Each leaf invocation calls this exactly once so a compromised
    leaf-A cannot inject a leaf-B envelope marker — the marker carries
    leaf-B's distinct nonce that leaf-A never observed.
    """
    return secrets.token_hex(_NONCE_HEX_BYTES)


def envelope_key_for_sub(sub_idx: int, sub_nonce: str) -> str:
    """Build the leaf-side tool-result envelope key.

    Shape: ``_phantom_sub_<sub_idx>_<sub_nonce>``. The leading underscore
    + ``_phantom_sub`` prefix matches the existing chat_pipeline
    convention so the merge LLM's safety filter recognises it as a
    framework key (not user input).
    """
    if not isinstance(sub_idx, int) or sub_idx < 0:
        raise ValueError(f"sub_idx must be a non-negative int, got {sub_idx!r}")
    if not isinstance(sub_nonce, str) or len(sub_nonce) != _NONCE_HEX_BYTES * 2:
        raise ValueError(
            f"sub_nonce must be a {_NONCE_HEX_BYTES * 2}-char hex string"
        )
    return f"_phantom_sub_{sub_idx}_{sub_nonce}"


def merge_envelope_key() -> str:
    """The merge LLM's envelope key. Reuses chat_pipeline._PROCESS_NONCE
    so a forged leaf cannot also forge the merge envelope.

    Imported lazily because chat_pipeline is a sibling module under
    ai/ — the X-3 import-gate audit (test_phase_x3_ai_agents_import_
    gate.py) only forbids `agent.*` imports from `ai/agents/**`, not
    `ai.*` siblings, so this is allowed."""
    from ai.chat_pipeline import _PROCESS_NONCE  # noqa: PLC0415

    return f"_phantom_merge_{_PROCESS_NONCE}"


async def sanitize_leaf_draft(
    *,
    text: str,
    user_id: str,
    db: "AsyncSession | None" = None,
) -> str:
    """Defence-in-depth wrapper around `output_safety.sanitize`.

    Runs at every leaf BEFORE the draft enters the merge history.
    Fail-open: a sanitize crash returns the original draft + logs WARN.

    The function is async because `output_safety.sanitize` reads
    `MemoryFact` rows via the SQLAlchemy async session; the sub_agent
    leaf already has a session in scope so the wrapper just forwards.
    """
    if not text:
        return text
    try:
        from ai.output_safety import sanitize  # noqa: PLC0415

        result = await sanitize(text=text, user_id=user_id, db=db)
        # `sanitize` returns a SanitizationResult dataclass; the leaf
        # cares only about the cleansed text.
        return getattr(result, "text", text) or text
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "X-2 leaf sanitize fail-open: sub-agent draft passed through "
            "raw because output_safety.sanitize raised %s. Merge step "
            "will re-run the sanitize pass; the leaf is the FIRST line "
            "of defence, not the only one.",
            exc,
        )
        return text


# ─────────────────────────────────────────────────────────────── public ──


__all__ = [
    "fresh_sub_nonce",
    "envelope_key_for_sub",
    "merge_envelope_key",
    "sanitize_leaf_draft",
]
