"""
Phase 17a.6 — Quality Gate Loop.

When the agent is about to emit a non-trivial output (code, document, plan,
message-to-third-party, generated file), wrap it in a
Producer → Critic.review → revise (max 3) → Verifier.confirm cycle. Only
after the gate passes does the output leave the agent.

Goals:
  1. Catch the failure modes operators routinely catch by hand: placeholder
     content (TODO/TBD), syntactic errors in code, dead links, missing
     acceptance criteria coverage, scope creep.
  2. Stay cheap when the LLM is offline: deterministic heuristics already
     cover the most common slop signals.
  3. Surface the iterations on the FE — `quality_gate.revision_started` and
     `quality_gate.revision_completed` WS events let the operator watch the
     output get progressively de-junked.

Design notes:
  • The Producer is just a callable returning a `GateDraft`. Caller supplies
    it (could be an LLM call, could be card-output code).
  • The Critic uses LLM if available, otherwise falls back to regex/heuristic
    checks (`_deterministic_critique`).
  • Verifier re-uses the Critic logic but with stricter blockers — final
    polish vs revision feedback.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


_PLACEHOLDER_PATTERN = re.compile(
    r"\b(TODO|TBD|FIXME|XXX|placeholder|пізніше|coming soon)\b",
    re.IGNORECASE,
)
_LIKELY_BROKEN_LINK = re.compile(r"https?://\s|https?://example\.com|http://localhost")
_LIKELY_HALF_CODE = re.compile(r"(\b(pass|raise NotImplementedError|return None)\b\s*$|\.\.\.\s*$)", re.MULTILINE)


@dataclass
class GateDraft:
    """One iteration of the producer's output."""
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class CritiqueIssue:
    severity: str  # "blocker" | "warning"
    message: str
    where: str | None = None  # optional pointer (line / section)


@dataclass
class CritiqueReport:
    issues: list[CritiqueIssue] = field(default_factory=list)
    summary: str = ""

    @property
    def has_blockers(self) -> bool:
        return any(i.severity == "blocker" for i in self.issues)


@dataclass
class GateResult:
    final_draft: GateDraft
    revisions: list[GateDraft]
    critiques: list[CritiqueReport]
    final_critique: CritiqueReport
    passed: bool
    rounds_used: int


# Producer callable signature: takes the previous draft (or None on first call)
# plus a critique (or None on first call), returns a coroutine resolving to a
# new GateDraft.
ProducerCb = Callable[[GateDraft | None, CritiqueReport | None], Awaitable[GateDraft]]
# Optional async callback fired after each revision so runtime can broadcast
# progress to the FE.
OnRevisionCb = Callable[[int, GateDraft, CritiqueReport], Awaitable[None]] | None


class QualityGate:
    """Wraps a Producer in the review-revise-verify cycle."""

    def __init__(
        self,
        *,
        ai_router: Any | None = None,
        max_revisions: int = 3,
        prefer_llm: bool = True,
        on_revision: OnRevisionCb = None,
    ) -> None:
        self.ai_router = ai_router
        self.max_revisions = max(1, int(max_revisions))
        self.prefer_llm = prefer_llm
        self.on_revision = on_revision

    async def run(
        self,
        *,
        intent: str,
        acceptance_criteria: str,
        producer: ProducerCb,
        artefact_kind: str = "text",
        task_id: str | None = None,
    ) -> GateResult:
        """Drive the loop. Returns the final GateResult.

        - `intent` and `acceptance_criteria` are passed to the critic so it
          checks the output against the actual ask, not a generic rubric.
        - `artefact_kind` ∈ {"text","code","document","plan","message"} —
          tunes the deterministic heuristics.
        """
        revisions: list[GateDraft] = []
        critiques: list[CritiqueReport] = []
        previous: GateDraft | None = None
        previous_critique: CritiqueReport | None = None

        for round_idx in range(self.max_revisions):
            try:
                draft = await producer(previous, previous_critique)
            except Exception as exc:
                logger.warning("quality_gate producer raised: %s", exc)
                # Producer failed — if we already have a previous draft, just
                # ship it; otherwise return an empty failure.
                if previous is not None:
                    return GateResult(
                        final_draft=previous,
                        revisions=revisions,
                        critiques=critiques,
                        final_critique=previous_critique or CritiqueReport(),
                        passed=False,
                        rounds_used=round_idx,
                    )
                empty = GateDraft(text="")
                return GateResult(
                    final_draft=empty,
                    revisions=[],
                    critiques=[],
                    final_critique=CritiqueReport(
                        issues=[CritiqueIssue("blocker", f"producer failed: {exc}")],
                    ),
                    passed=False,
                    rounds_used=0,
                )

            critique = await self._critique(
                draft=draft,
                intent=intent,
                acceptance_criteria=acceptance_criteria,
                artefact_kind=artefact_kind,
                task_id=task_id,
            )
            revisions.append(draft)
            critiques.append(critique)

            if self.on_revision is not None:
                try:
                    await self.on_revision(round_idx + 1, draft, critique)
                except Exception as exc:
                    logger.debug("quality_gate on_revision callback failed: %s", exc)

            if not critique.has_blockers:
                # Final verifier pass — looks for last-mile issues that the
                # revision critic might have missed.
                verifier = await self._verify(
                    draft=draft,
                    intent=intent,
                    acceptance_criteria=acceptance_criteria,
                    artefact_kind=artefact_kind,
                    task_id=task_id,
                )
                if not verifier.has_blockers:
                    return GateResult(
                        final_draft=draft,
                        revisions=revisions,
                        critiques=critiques,
                        final_critique=verifier,
                        passed=True,
                        rounds_used=round_idx + 1,
                    )
                # Verifier blocked — feed its critique back into the loop.
                previous = draft
                previous_critique = verifier
                critiques.append(verifier)
                continue

            previous = draft
            previous_critique = critique

        # Exhausted revisions. Return last draft + last critique, not passed.
        last_draft = revisions[-1] if revisions else GateDraft(text="")
        last_critique = critiques[-1] if critiques else CritiqueReport()
        return GateResult(
            final_draft=last_draft,
            revisions=revisions,
            critiques=critiques,
            final_critique=last_critique,
            passed=False,
            rounds_used=len(revisions),
        )

    # ── Critic / Verifier ────────────────────────────────────────────────────

    async def _critique(
        self,
        *,
        draft: GateDraft,
        intent: str,
        acceptance_criteria: str,
        artefact_kind: str,
        task_id: str | None,
    ) -> CritiqueReport:
        det = _deterministic_critique(draft.text, artefact_kind, acceptance_criteria)
        if not self.prefer_llm or self.ai_router is None:
            return det
        llm = await self._llm_critique(draft, intent, acceptance_criteria, artefact_kind, task_id)
        if llm is None:
            return det
        # Merge: LLM issues + det issues; dedupe by message text.
        seen: set[str] = set()
        merged: list[CritiqueIssue] = []
        for src in (llm.issues, det.issues):
            for it in src:
                key = it.message.strip().lower()
                if key in seen:
                    continue
                seen.add(key)
                merged.append(it)
        return CritiqueReport(
            issues=merged,
            summary=llm.summary or det.summary,
        )

    async def _verify(
        self,
        *,
        draft: GateDraft,
        intent: str,
        acceptance_criteria: str,
        artefact_kind: str,
        task_id: str | None,
    ) -> CritiqueReport:
        # Verifier is a stricter critic — mostly catches placeholders that the
        # critic let through and acceptance-criteria coverage gaps.
        report = _deterministic_critique(draft.text, artefact_kind, acceptance_criteria)
        if self.prefer_llm and self.ai_router is not None:
            llm = await self._llm_critique(
                draft, intent, acceptance_criteria, artefact_kind, task_id,
                stage="verify",
            )
            if llm is not None and llm.has_blockers:
                # Verifier blockers always count.
                report.issues.extend(llm.issues)
        return report

    async def _llm_critique(
        self,
        draft: GateDraft,
        intent: str,
        acceptance_criteria: str,
        artefact_kind: str,
        task_id: str | None,
        *,
        stage: str = "critique",
        timeout_s: float = 8.0,
    ) -> CritiqueReport | None:
        prompt = _LLM_CRITIQUE_PROMPT.format(
            stage=stage,
            artefact_kind=artefact_kind,
            intent=intent[:500],
            acceptance=acceptance_criteria[:500] or "(не вказано)",
            draft=draft.text[:3000],
        )
        try:
            response = await asyncio.wait_for(
                self.ai_router.generate(
                    user_message=prompt,
                    system_prompt=(
                        "Ти суворий рецензент. Відповідай ЛИШЕ JSON-об'єктом."
                    ),
                    history=[],
                    task_id=task_id,
                ),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError:
            return None
        except Exception as exc:
            logger.debug("quality_gate LLM critique failed: %s", exc)
            return None
        text = (response.content or "").strip()
        if not text:
            return None
        if text.startswith("```"):
            text = text.strip("` \n")
            if text.lower().startswith("json"):
                text = text[4:].strip()
        import json as _json
        try:
            data = _json.loads(text)
        except Exception:
            start = text.find("{")
            end = text.rfind("}")
            if start < 0 or end <= start:
                return None
            try:
                data = _json.loads(text[start:end + 1])
            except Exception:
                return None
        if not isinstance(data, dict):
            return None
        issues_raw = data.get("issues") or []
        issues: list[CritiqueIssue] = []
        if isinstance(issues_raw, list):
            for it in issues_raw:
                if not isinstance(it, dict):
                    continue
                sev = (it.get("severity") or "warning").lower()
                if sev not in {"blocker", "warning"}:
                    sev = "warning"
                msg = str(it.get("message") or "").strip()
                if not msg:
                    continue
                where = it.get("where")
                issues.append(CritiqueIssue(
                    severity=sev,
                    message=msg[:280],
                    where=str(where) if where else None,
                ))
        summary = str(data.get("summary") or "").strip()[:400]
        return CritiqueReport(issues=issues, summary=summary)


# ── Deterministic critique (offline path) ────────────────────────────────────


def _deterministic_critique(
    text: str,
    artefact_kind: str,
    acceptance_criteria: str,
) -> CritiqueReport:
    issues: list[CritiqueIssue] = []
    if not text or not text.strip():
        issues.append(CritiqueIssue("blocker", "Текст порожній — нічого випускати."))
        return CritiqueReport(issues=issues, summary="empty draft")

    # Placeholder content is always a blocker.
    if _PLACEHOLDER_PATTERN.search(text):
        issues.append(CritiqueIssue(
            "blocker",
            "Чернетка містить плейсхолдери (TODO/TBD/FIXME). Доведи до кінця.",
        ))

    # Likely broken / placeholder URLs in documents/messages.
    if artefact_kind in {"document", "message", "plan"} and _LIKELY_BROKEN_LINK.search(text):
        issues.append(CritiqueIssue(
            "warning",
            "У тексті є підозрілі посилання (example.com / localhost) — заміни.",
        ))

    # Code-specific: bare 'pass' or NotImplementedError signals stub.
    if artefact_kind == "code" and _LIKELY_HALF_CODE.search(text):
        issues.append(CritiqueIssue(
            "blocker",
            "Код містить заглушку (pass / NotImplementedError / `...`). Реалізуй.",
        ))

    # Acceptance-criteria coverage hint: if user supplied criteria, every
    # criterion phrase >5 chars should appear in the draft. We tolerate
    # paraphrasing — only flag this as a warning, not a blocker.
    if acceptance_criteria and len(acceptance_criteria) > 8:
        for chunk in _split_acceptance(acceptance_criteria):
            if chunk and chunk.lower() not in text.lower():
                issues.append(CritiqueIssue(
                    "warning",
                    f"Критерій '{chunk[:60]}' не явно покритий у виводі.",
                ))
                break  # one warning is enough; don't flood

    summary = (
        "OK"
        if not issues
        else f"{sum(1 for i in issues if i.severity == 'blocker')} blockers, "
             f"{sum(1 for i in issues if i.severity == 'warning')} warnings"
    )
    return CritiqueReport(issues=issues, summary=summary)


def _split_acceptance(criteria: str) -> list[str]:
    parts: list[str] = []
    for raw in re.split(r"[\n;,]", criteria):
        chunk = raw.strip()
        if len(chunk) >= 6:
            parts.append(chunk)
    return parts[:5]


_LLM_CRITIQUE_PROMPT = """\
Ти {stage} (рецензент якості). Перевір, чи чернетка готова до випуску.

ARTEFACT_KIND: {artefact_kind}
INTENT: {intent}
ACCEPTANCE: {acceptance}

ЧЕРНЕТКА:
\"\"\"
{draft}
\"\"\"

Поверни ЛИШЕ JSON:

{{
  "issues": [
    {{ "severity": "blocker"|"warning", "message": "коротко що не так", "where": "опційно" }}
  ],
  "summary": "одне речення підсумку"
}}

Принципи:
- "blocker" — поки це є, не можна випускати (плейсхолдери, фактичні помилки, зламана логіка, незаповнений acceptance).
- "warning" — варто виправити, але не критично.
- Якщо все ОК → issues: []. Не вигадуй проблем.

JSON:"""


# ── Module-level convenience ────────────────────────────────────────────────


async def run_quality_gate(
    *,
    intent: str,
    acceptance_criteria: str,
    producer: ProducerCb,
    artefact_kind: str = "text",
    ai_router: Any | None = None,
    max_revisions: int = 3,
    on_revision: OnRevisionCb = None,
    task_id: str | None = None,
) -> GateResult:
    gate = QualityGate(
        ai_router=ai_router,
        max_revisions=max_revisions,
        on_revision=on_revision,
    )
    return await gate.run(
        intent=intent,
        acceptance_criteria=acceptance_criteria,
        producer=producer,
        artefact_kind=artefact_kind,
        task_id=task_id,
    )


__all__ = [
    "GateDraft",
    "CritiqueIssue",
    "CritiqueReport",
    "GateResult",
    "QualityGate",
    "run_quality_gate",
]
