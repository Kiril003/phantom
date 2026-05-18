"""
Vertical V11 — Intelligence actions.

DistillFactsFromChats  — runs an LLM-based distillation pass over recent chat
                         messages and proposes new UserFact rows.  dry_run=True
                         returns proposals without writing.

ExcludeFactFromPrompts — toggles exclude_from_prompts on a UserFact so it is
                         filtered from all planner / chat LLM contexts while
                         remaining visible in the IntelligenceHub UI.

# Voice follow-up note (out of scope V11):
# A future "forget my home address" voice command would:
#   1. semantic-search user_facts for a match on "home address"
#   2. call ExcludeFactFromPrompts(fact_id=..., reason="voice_forget_command")
# The plumbing is here; wire it to the voice pipeline intent classifier when ready.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import ClassVar

from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.actions.base import Action, ActionContext
from agent.schemas import ActionResult, RiskLevel
from db.models import ChatMessage, ChatSession, User, UserFact

logger = logging.getLogger(__name__)


# ─── DistillFactsFromChats ────────────────────────────────────────────────────


class DistillFactsFromChats(Action):
    """Scan recent chat messages and distil new personal facts about the operator.

    Uses Gemini (or fallback) to compare existing facts against the recent chat
    transcript and proposes 0-10 new, deduplicated, importance-scored facts.

    When dry_run=True the proposed facts are returned in output["proposed"]
    without any DB writes.
    """

    name: ClassVar[str] = "intelligence.distill_from_chats"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    estimated_peak_ram_mb: ClassVar[int] = 400
    requires_network: ClassVar[bool] = True

    lookback_hours: int = Field(default=72, ge=1, le=720,
                                description="How many hours of chat history to scan.")
    max_chats: int = Field(default=200, ge=1, le=1000,
                           description="Maximum number of messages to include.")
    dry_run: bool = Field(default=False,
                          description="If True, return proposals without writing to DB.")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from db.database import get_session
        from ai.provider import ai_router
        from security.crypto import encrypt_pii, decrypt_pii, InvalidToken

        user_id = _get_user_id(ctx)
        if not user_id:
            return ActionResult(ok=False, error="intelligence.distill_from_chats: no user_id in ctx")

        async with get_session() as db:
            # ── 1. load recent messages ───────────────────────────────────────
            from datetime import timedelta
            cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=self.lookback_hours)

            stmt = (
                select(ChatMessage)
                .where(
                    ChatMessage.user_id == user_id,
                    ChatMessage.created_at >= cutoff,
                    ChatMessage.role.in_(["user", "assistant"]),
                )
                .order_by(ChatMessage.created_at)
                .limit(self.max_chats)
            )
            messages = (await db.execute(stmt)).scalars().all()

            if not messages:
                return ActionResult(ok=True, output={
                    "distilled_count": 0,
                    "existing_count": 0,
                    "proposed": [],
                    "note": "No recent messages found.",
                })

            transcript_parts: list[str] = []
            for m in messages:
                role_label = "User" if m.role == "user" else "PHANTOM"
                transcript_parts.append(f"{role_label}: {m.content[:400]}")
            transcript = "\n".join(transcript_parts)[-8000:]  # cap to ~8k chars

            # ── 2. load existing facts ─────────────────────────────────────
            stmt2 = select(UserFact).where(UserFact.user_id == user_id)
            existing_rows = (await db.execute(stmt2)).scalars().all()
            existing_count = len(existing_rows)

            existing_texts: list[str] = []      # for the LLM prompt (with category prefix)
            existing_plaintexts: list[str] = []  # for dedup matching (raw, no prefix)
            for f in existing_rows:
                try:
                    plaintext = decrypt_pii(f.value_encrypted)
                except (InvalidToken, Exception):
                    plaintext = "[corrupt]"
                existing_texts.append(f"[{f.category}] {plaintext}")
                existing_plaintexts.append(plaintext)
            existing_block = "\n".join(existing_texts[:50]) if existing_texts else "(none)"

            # ── 3. LLM distillation call ──────────────────────────────────
            prompt = _build_distill_prompt(transcript, existing_block)
            try:
                response = await ai_router.generate(
                    user_message=prompt,
                    system_prompt=(
                        "You are a precise personal-assistant fact extractor. "
                        "Return only valid JSON. No prose. No markdown fences."
                    ),
                    history=[],
                    task_id=ctx.task_id,
                )
                raw = (response.content or "").strip()
                if raw.startswith("```"):
                    raw = raw.strip("`").lstrip("json").strip()
                proposed_raw: list[dict] = json.loads(raw)
                if not isinstance(proposed_raw, list):
                    proposed_raw = []
            except Exception as exc:
                logger.warning("distill_from_chats LLM/parse failed: %s", exc)
                return ActionResult(ok=False, error=f"LLM failure: {exc}")

            # ── 4. validate + deduplicate ─────────────────────────────────
            proposed: list[dict] = []
            # Dedup against raw plaintexts (no `[category]` prefix), so the
            # LLM's bare proposed text matches existing facts correctly.
            existing_norm = {t.lower().strip() for t in existing_plaintexts}
            for item in proposed_raw[:10]:
                if not isinstance(item, dict):
                    continue
                text = str(item.get("text") or item.get("value") or "").strip()
                category = str(item.get("category") or "fact").strip()[:32]
                importance = float(item.get("importance") or 0.5)
                importance = max(0.0, min(1.0, importance))
                if not text or len(text) < 3:
                    continue
                if text.lower() in existing_norm:
                    continue
                proposed.append({"text": text, "category": category, "importance": importance})

            if self.dry_run:
                return ActionResult(ok=True, output={
                    "distilled_count": 0,
                    "existing_count": existing_count,
                    "proposed": proposed,
                    "dry_run": True,
                })

            # ── 5. write new facts ─────────────────────────────────────────
            written = 0
            for item in proposed:
                try:
                    fact = UserFact(
                        user_id=user_id,
                        category=item["category"],
                        label=f"distilled:{item['category']}",
                        value_encrypted=encrypt_pii(item["text"]),
                        exclude_from_prompts=False,
                    )
                    db.add(fact)
                    written += 1
                except Exception as exc:
                    logger.warning("distill_from_chats write failed for item: %s", exc)

            await db.commit()

            return ActionResult(ok=True, output={
                "distilled_count": written,
                "existing_count": existing_count,
                "proposed": proposed,
                "dry_run": False,
            })


def _build_distill_prompt(transcript: str, existing_block: str) -> str:
    return f"""\
You are analysing a conversation between an operator and PHANTOM AI assistant.
Your task: identify NEW personal facts about the operator that are NOT already
in the existing facts list.

EXISTING FACTS (do NOT duplicate these):
{existing_block}

RECENT CONVERSATION:
{transcript}

Return a JSON array of 0-10 NEW facts. Each fact:
  {{"text": "<fact in plain language>", "category": "<one of: preference|decision|event|emotion|pattern|contact|fact>", "importance": <0.0-1.0>}}

Rules:
- Only include facts that are clearly about the operator as a person.
- Skip anything already semantically covered by EXISTING FACTS.
- importance: 0.9 = identity/permanent fact, 0.5 = preference, 0.3 = transient.
- Return [] if nothing new and important is found.
- Return ONLY the JSON array. No prose. No markdown.
"""


# ─── ExcludeFactFromPrompts ───────────────────────────────────────────────────


class ExcludeFactFromPrompts(Action):
    """Toggle the exclude_from_prompts flag on a UserFact.

    When excluded, the fact is filtered from all planner and chat LLM prompts.
    The fact remains visible in the IntelligenceHub UI so the operator can
    un-exclude it at any time.

    This is the programmatic backend for the "forget X" operator intent.
    """

    name: ClassVar[str] = "intelligence.exclude_fact"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    fact_id: str = Field(..., description="UUID of the UserFact to toggle.")
    reason: str = Field(
        default="operator_request",
        max_length=240,
        description="Short reason logged with the audit entry.",
    )
    exclude: bool = Field(
        default=True,
        description="True = exclude from prompts; False = re-include.",
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        from db.database import get_session

        user_id = _get_user_id(ctx)
        if not user_id:
            return ActionResult(ok=False, error="intelligence.exclude_fact: no user_id in ctx")

        async with get_session() as db:
            stmt = select(UserFact).where(
                UserFact.id == self.fact_id,
                UserFact.user_id == user_id,
            )
            fact = (await db.execute(stmt)).scalar_one_or_none()
            if fact is None:
                return ActionResult(
                    ok=False,
                    error=f"UserFact {self.fact_id!r} not found for this user.",
                )

            old_value = bool(fact.exclude_from_prompts)
            fact.exclude_from_prompts = self.exclude
            await db.commit()

            return ActionResult(ok=True, output={
                "fact_id": self.fact_id,
                "exclude_from_prompts": self.exclude,
                "previously": old_value,
                "reason": self.reason,
            })


class IntelligenceUpsertKnowledge(Action):
    """Store a solid architectural or project-wide fact in the Knowledge Base.
    Use this when you discover something 'permanent' about the project (e.g. tech stack, 
    file locations, coding rules) that MUST survive session resets.
    """
    name: ClassVar[str] = "intelligence.upsert_knowledge"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = False

    subject: str = Field(..., description="The entity or component (e.g. 'Backend', 'Database', 'Layout')")
    predicate: str = Field(..., description="The property or relationship (e.g. 'UsesLibrary', 'StoragePath')")
    object_val: str = Field(..., description="The value or fact (e.g. 'FastAPI', '/home/radxa/data')")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        import time
        t0 = time.monotonic()
        try:
            from agent.cognition.knowledge import project_kb
            project_kb.upsert(self.subject, self.predicate, self.object_val)
            return ActionResult(
                ok=True,
                output={"subject": self.subject, "predicate": self.predicate, "object_val": self.object_val},
                side_effects=[f"KO recorded: {self.subject} -> {self.object_val}"],
                elapsed_ms=int((time.monotonic() - t0) * 1000)
            )
        except Exception as e:
            return ActionResult(ok=False, error=str(e), error_class="kb_error")


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _get_user_id(ctx: ActionContext) -> str | None:
    """Extract user_id from ActionContext extras (set by the runtime)."""
    return ctx.extras.get("user_id") or ctx.extras.get("operator_user_id") or None
