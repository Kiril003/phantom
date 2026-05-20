"""
PHANTOM OS — chat-output safety classifier (Tier 4: PII Obfuscation Filter).

As part of the Total Coverage Autonomous Swarm (Phase: Swarm Transition), 
this module acts as the "PII Obfuscation Filter" (Tier 4). It is the strict 
membrane between the user's raw input/output streams and the Episodic-Semantic 
Graph Synthesizer (and external LLM APIs).

Audit-2026-04-29 Tier C wired the chat path for Phase 17b's
``call_with_tools`` loop. Once the LLM has access to the
``recall_memory_facts`` tool, the threat surface widens: the
assistant's response can now legitimately end up containing a
verbatim quote of a sensitive memory fact (the operator's home
GPS, a medical detail, a credential snippet) — the LLM thinks it's
"helpful". Without an output classifier between the LLM and the
TTS / chat broadcast, that quote streams straight to the user's
display or speaker.

This module is the choke point. ``sanitize`` reads the user's
``MemoryFact`` rows, identifies the sensitive ones, then redacts
verbatim substring matches in the assistant text. The choice of
"sensitive" is conservative on purpose: any fact whose category
is medical / financial / location-precise / credential, OR whose
importance is at the high-confidence ceiling, OR whose stored
``metadata_extra`` carries a ``"sealed": true`` marker.

Phase 17b's call_with_tools wiring will call ``sanitize`` exactly
once per turn, between the final LLM response and ``chat_broadcast``
/ TTS. A redaction returns the sanitised text + a list of
``RedactionEvent`` rows so the operator dashboard / audit log can
show *what* was scrubbed without the redacted content itself.

The classifier is intentionally simple — substring-based with a
short normalisation pass. The swarm blueprint plans for richer
Named Entity Recognition (NER) and tokenization work in a later phase; 
the v1 here is the "defence-in-depth fallback" to ensure Zero-Trust compliance.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MemoryFact

logger = logging.getLogger(__name__)


# ── Sensitive-fact heuristics ─────────────────────────────────────────────────


# Category names that always mark a fact as sensitive, regardless of
# importance score. Conservative list — adding categories tightens the
# filter but never widens leakage.
_SENSITIVE_CATEGORIES: frozenset[str] = frozenset({
    "medical",
    "health",
    "financial",
    "credential",
    "location_precise",
    "private",
})


# Importance threshold above which a fact is treated as sensitive even
# if its category is not in the explicit list. The audit calls this the
# "high-confidence ceiling" — facts the user explicitly marked or that
# the importance scorer ranked at the top.
_IMPORTANCE_FLOOR_FOR_SENSITIVE: float = 0.85


# A fact's content is only treated as "leakable" if it contains enough
# distinctive material to be worth redacting. Single-word facts ("Home",
# "yes", "morning") are too generic and would over-redact normal text.
_MIN_FACT_TOKENS: int = 3


# Verbatim-substring matching tolerance. We compare lowercased,
# whitespace-collapsed substrings; if the fact appears in the assistant
# text after that normalisation, it's redacted. Punctuation differences
# don't fool the match.
_NORMALISER = re.compile(r"\s+")


def _normalise(s: str) -> str:
    return _NORMALISER.sub(" ", s.strip().lower())


def _is_sensitive(fact: MemoryFact) -> bool:
    """Return True if a fact's content is too sensitive to be quoted
    verbatim in an assistant response."""
    if fact.is_sealed:
        # Sealed facts are explicitly hidden — they MUST never leak
        # back into a chat broadcast.
        return True
    if (fact.category or "").lower() in _SENSITIVE_CATEGORIES:
        return True
    if (fact.importance or 0.0) >= _IMPORTANCE_FLOOR_FOR_SENSITIVE:
        return True
    return False


# ── Result types ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RedactionEvent:
    """One verbatim-fact match that was scrubbed from the assistant text.

    `fact_id` and `fact_category` are surfaced so the operator review
    can scope incidents per-tenant or per-category without re-reading
    the original fact (which the audit log MUST NOT echo)."""

    fact_id: str
    fact_category: str
    span_len: int


@dataclass
class SanitiseResult:
    """Public return type from ``sanitize``.

    `text` is the sanitised assistant body — never None even when no
    redaction fires. `redactions` is the list of events; an empty list
    means the response was clean. `examined_facts` is the count of
    sensitive-fact rows the classifier compared against (useful for
    dashboards / debugging the heuristic threshold).
    """

    text: str
    redactions: list[RedactionEvent] = field(default_factory=list)
    examined_facts: int = 0

    @property
    def safe(self) -> bool:
        return not self.redactions


# ── Public API ────────────────────────────────────────────────────────────────


_REDACTION_PLACEHOLDER: str = "[REDACTED]"


async def sanitize(
    text: str,
    *,
    user_id: str,
    db: AsyncSession,
    placeholder: str = _REDACTION_PLACEHOLDER,
) -> SanitiseResult:
    """Scrub verbatim quotes of the user's sensitive memory facts from
    the assistant text. Returns the sanitised text + audit events.

    Best-effort: a DB error returns the original text unchanged with an
    empty redaction list. Phase 17b's wiring should treat the
    classifier as defence-in-depth, not as the only barrier.
    """
    if not isinstance(text, str) or not text:
        return SanitiseResult(text=text or "")

    try:
        rows = await _load_user_sensitive_facts(user_id, db)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "output_safety: failed to load facts for user %s: %s",
            user_id, exc,
        )
        return SanitiseResult(text=text)

    if not rows:
        return SanitiseResult(text=text)

    sanitised = text
    norm_text = _normalise(sanitised)
    events: list[RedactionEvent] = []

    for fact in rows:
        content = (fact.content or "").strip()
        if len(content.split()) < _MIN_FACT_TOKENS:
            continue
        norm_fact = _normalise(content)
        if not norm_fact or norm_fact not in norm_text:
            continue

        # Replace the original content (case-preserving best-effort).
        # Compile a case-insensitive regex matching whitespace-tolerant
        # variants of the fact so reformatted quotes still get caught.
        pattern = _build_match_pattern(content)
        if pattern is None:
            continue
        new_text, n = pattern.subn(placeholder, sanitised)
        if n == 0:
            continue
        sanitised = new_text
        norm_text = _normalise(sanitised)
        events.append(
            RedactionEvent(
                fact_id=str(fact.id),
                fact_category=(fact.category or "fact"),
                span_len=len(content),
            )
        )

    if events:
        logger.info(
            "output_safety: scrubbed %d verbatim fact(s) from chat output for user %s",
            len(events), user_id,
        )

    return SanitiseResult(
        text=sanitised, redactions=events, examined_facts=len(rows)
    )


# ── Internals ─────────────────────────────────────────────────────────────────


async def _load_user_sensitive_facts(
    user_id: str, db: AsyncSession
) -> list[MemoryFact]:
    """Fetch the user's MemoryFact rows that the heuristic considers
    sensitive. Caps at 200 rows to bound the cost on heavy users — the
    most-recent / highest-importance rows survive the cap so the
    long-tail of low-importance rows doesn't burn the comparison
    budget."""
    stmt = (
        select(MemoryFact)
        .where(MemoryFact.user_id == user_id)
        .order_by(MemoryFact.importance.desc(), MemoryFact.created_at.desc())
        .limit(200)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [r for r in rows if _is_sensitive(r)]


def _build_match_pattern(content: str) -> re.Pattern[str] | None:
    """Compile a case-insensitive regex that matches the fact's content
    even when whitespace is reflowed. Returns None when the content is
    too short to risk a regex sweep (`re.escape` of a 1-2 char string
    matches every line)."""
    head = content.strip()
    if len(head) < 4:
        return None
    # Replace any whitespace run in the fact with a `\s+` so reflowed
    # text doesn't dodge the match.
    parts = re.split(r"\s+", head)
    pattern_text = r"\s+".join(re.escape(p) for p in parts if p)
    if not pattern_text:
        return None
    try:
        return re.compile(pattern_text, re.IGNORECASE)
    except re.error:
        return None


__all__ = [
    "sanitize",
    "SanitiseResult",
    "RedactionEvent",
]
