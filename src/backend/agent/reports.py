"""
Phase 16 — TaskReport composition.

Two strategies:
  • llm_narrative: asks ai_router to produce a structured JSON report (rich prose,
    achievements, obstacles, key decisions, next steps). Hybrid path: deterministic
    skeleton + LLM-narrated description (`llm_narrative` field).
  • deterministic: pure mechanical assembly from audit / observations / reflections /
    sub-goals. Always works, even when both providers are quota-exhausted (П-1).

Design rules:
  • Composition NEVER raises — failure paths fall through to deterministic. The
    runtime calls this from finalize_task() and must never be blocked by report
    generation.
  • Output is the same `TaskReport` pydantic shape regardless of strategy, so the
    frontend doesn't branch on `generation_strategy`.
  • The composer reads from the persisted state (DB rows) so it can be called on
    demand later for any past task — not just the one finalizing right now.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from .audit import fetch_audit, get_task
from .schemas import (
    AuditCompact,
    AuditEntry,
    EvidenceLink,
    KeyDecision,
    Observation,
    ReflectionResult,
    ReflectionVerdict,
    SubGoal,
    TaskReport,
    TaskStatus,
)

logger = logging.getLogger(__name__)


# Maximum sizes to keep the report cheap to ship over WS and render in 1024×600.
MAX_ACHIEVEMENTS = 8
MAX_OBSTACLES = 6
MAX_KEY_DECISIONS = 6
MAX_NEXT_STEPS = 5
MAX_EVIDENCE = 12
MAX_AUDIT_COMPACT = 24


_NARRATIVE_PROMPT = """\
Ти — стислий редактор-аналітик. Склади структуроване резюме виконаної агентом
задачі українською мовою. Поверни ЛИШЕ валідний JSON-об'єкт без коментарів,
без markdown-обгорток. Поля:

{{
  "achievements": ["1-2 речення про конкретні досягнення", ...],   // 1..{max_a}
  "obstacles": ["1 речення про реальну перешкоду чи помилку", ...], // 0..{max_o}
  "next_steps": ["1 речення — наступний логічний крок", ...],       // 0..{max_n}
  "narrative": "одне-два речення живої прози про результат"
}}

Орієнтуйся на контекст:
МЕТА: {goal}
СТАТУС: {status}
ТРИВАЛІСТЬ: {duration_s}s
ВИКОНАНО ПІДЦІЛЕЙ: {sg_done}/{sg_total}
ЛІЧИЛЬНИКИ ДІЙ: {action_counts}
КЛЮЧОВІ СПОСТЕРЕЖЕННЯ:
{observations}
КЛЮЧОВІ РЕФЛЕКСІЇ:
{reflections}

JSON:"""


def _safe_json(s: str | None) -> Any:
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


def _aggregate_subgoals(sub_goals: list[SubGoal]) -> tuple[int, int]:
    done = sum(1 for sg in sub_goals if sg.status == "done")
    return done, len(sub_goals)


def _aggregate_actions(audit: list[AuditEntry]) -> tuple[int, int, dict[str, int]]:
    total = len(audit)
    failed = sum(1 for a in audit if not a.result.ok)
    counts: dict[str, int] = {}
    for a in audit:
        counts[a.action_name] = counts.get(a.action_name, 0) + 1
    return total, failed, counts


def _extract_reflections(observations: list[Observation]) -> list[ReflectionResult]:
    """Reflections are persisted as observations with type=='reflection' (loop.py
    appends them so they survive task restarts). The body field carries the
    JSON-encoded ReflectionResult; we recover what we can — best-effort."""
    out: list[ReflectionResult] = []
    for obs in observations:
        if obs.type != "reflection":
            continue
        # Body shape per loop._run_reflection: usually a one-line summary.
        # Confidence rides on obs.confidence; verdict often in source.
        verdict_raw = obs.source if obs.source in {
            "continue", "revise_subgoal", "revise_strategy",
            "abandon_task", "wait_user",
        } else "continue"
        out.append(ReflectionResult(
            verdict=verdict_raw,  # type: ignore[arg-type]
            summary=obs.content[:400],
            new_confidence=float(obs.confidence or 0.5),
        ))
    return out


def _key_decisions_from(
    observations: list[Observation],
    audit: list[AuditEntry],
) -> list[KeyDecision]:
    """Pick reflections + objection-bearing audit entries as user-facing decisions."""
    out: list[KeyDecision] = []

    # 1) Reflections that signaled a strategic shift (revise_strategy / abandon /
    #    wait_user) — these are higher signal than 'continue' verdicts.
    for obs in observations:
        if obs.type != "reflection":
            continue
        verdict: ReflectionVerdict = "continue"
        v = obs.source
        if v in {"revise_subgoal", "revise_strategy", "abandon_task", "wait_user"}:
            verdict = v  # type: ignore[assignment]
        if verdict == "continue":
            continue
        out.append(KeyDecision(
            step_idx=obs.step_idx,
            verdict=verdict,
            summary=obs.content[:280],
            confidence=float(obs.confidence or 0.5),
            ts=obs.ts,
        ))
        if len(out) >= MAX_KEY_DECISIONS:
            return out

    # 2) Audit entries with a non-trivial objection in the monologue —
    #    moments where the agent debated itself before acting.
    for a in audit:
        if len(out) >= MAX_KEY_DECISIONS:
            break
        mono = a.monologue
        if mono is None:
            continue
        if not mono.objection:
            continue
        out.append(KeyDecision(
            step_idx=a.step_idx,
            sub_goal_id=a.sub_goal_id,
            verdict="continue",
            summary=(mono.what_i_plan or a.intent or a.action_name)[:280],
            confidence=float(mono.confidence or 0.5),
            objection=mono.objection[:280],
            ts=a.timestamp,
        ))

    return out


def _achievements_deterministic(
    sub_goals: list[SubGoal],
    audit: list[AuditEntry],
    status: TaskStatus,
) -> list[str]:
    achievements: list[str] = []
    for sg in sub_goals:
        if sg.status == "done":
            achievements.append(sg.description[:200])
        if len(achievements) >= MAX_ACHIEVEMENTS:
            return achievements
    if not achievements and status == "done":
        # Headline succeeded but no sub-goals tracked it (rare path).
        ok_actions = [a for a in audit if a.result.ok]
        if ok_actions:
            achievements.append(
                f"Виконано {len(ok_actions)} дій без зафіксованих помилок."
            )
    return achievements


def _obstacles_deterministic(
    sub_goals: list[SubGoal],
    audit: list[AuditEntry],
    error: str | None,
) -> list[str]:
    obstacles: list[str] = []
    for sg in sub_goals:
        if sg.status in {"failed", "skipped"}:
            obstacles.append(f"{sg.description[:160]} → {sg.status}")
        if len(obstacles) >= MAX_OBSTACLES:
            return obstacles

    # Most-recent failure messages, deduped.
    seen: set[str] = set()
    for a in reversed(audit):
        if a.result.ok:
            continue
        msg = (a.result.error or a.result.error_class or a.action_name)[:200]
        if msg in seen:
            continue
        seen.add(msg)
        obstacles.append(f"{a.action_name}: {msg}")
        if len(obstacles) >= MAX_OBSTACLES:
            return obstacles

    if error and not obstacles:
        obstacles.append(error[:240])
    return obstacles


def _next_steps_deterministic(
    sub_goals: list[SubGoal],
    status: TaskStatus,
) -> list[str]:
    steps: list[str] = []
    for sg in sub_goals:
        if sg.status in {"pending", "active", "failed"}:
            steps.append(f"Завершити: {sg.description[:160]}")
        if len(steps) >= MAX_NEXT_STEPS:
            return steps
    if not steps and status in {"failed", "stopped", "timeout"}:
        steps.append("Переглянути аудит-лог і повторити завдання з уточненням.")
    return steps


def _evidence_links(
    audit: list[AuditEntry],
) -> list[EvidenceLink]:
    out: list[EvidenceLink] = []
    seen_urls: set[str] = set()
    for a in audit:
        if len(out) >= MAX_EVIDENCE:
            break
        # URL evidence — browser navigations + web searches.
        url = ""
        if isinstance(a.args, dict):
            url = str(a.args.get("url") or "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            out.append(EvidenceLink(
                kind="url",
                ref=url[:500],
                label=a.action_name,
            ))
            continue
        # File evidence — fs reads/writes.
        path = ""
        if isinstance(a.args, dict):
            path = str(a.args.get("path") or a.args.get("file") or "")
        if path and a.result.ok:
            out.append(EvidenceLink(
                kind="file",
                ref=path[:500],
                label=a.action_name,
            ))
    return out


def _audit_compact(audit: list[AuditEntry]) -> list[AuditCompact]:
    out: list[AuditCompact] = []
    for a in audit[-MAX_AUDIT_COMPACT:]:
        out.append(AuditCompact(
            audit_id=a.id,
            step_idx=a.step_idx,
            action=a.action_name,
            ok=bool(a.result.ok),
            elapsed_ms=int(a.elapsed_ms or 0),
            intent=(a.intent or "")[:160],
        ))
    return out


def _hardcap(values: list[str], n: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        v = (v or "").strip()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
        if len(out) >= n:
            break
    return out


# ── Public API ────────────────────────────────────────────────────────────────

class ReportComposer:
    """Builds a TaskReport from persisted task state.

    Stateless — instantiate per-call. Holds no DB session of its own; uses the
    audit module's helpers so it works for both live finalize and on-demand
    historical look-ups.
    """

    def __init__(self, *, llm_timeout_s: float = 8.0) -> None:
        self.llm_timeout_s = llm_timeout_s

    async def compose(
        self,
        task_id: str,
        *,
        prefer_llm: bool = True,
        audit_limit: int = 200,
    ) -> TaskReport | None:
        row = await get_task(task_id)
        if row is None:
            logger.warning("ReportComposer: task %s not found", task_id)
            return None

        audit = list(reversed(await fetch_audit(task_id, limit=audit_limit)))
        sub_goals_raw = row.get("sub_goals") or []
        sub_goals = [SubGoal(**sg) for sg in sub_goals_raw if isinstance(sg, dict)]
        observations_raw = row.get("observations") or []
        observations = [Observation(**o) for o in observations_raw if isinstance(o, dict)]

        skeleton = self._build_skeleton(row, sub_goals, observations, audit)

        if prefer_llm:
            try:
                narrative = await asyncio.wait_for(
                    self._compose_llm(skeleton, sub_goals, observations, row),
                    timeout=self.llm_timeout_s,
                )
                if narrative is not None:
                    skeleton = self._merge_narrative(skeleton, narrative)
            except asyncio.TimeoutError:
                logger.info(
                    "ReportComposer LLM narrative timed out — using deterministic.")
            except Exception as exc:
                logger.info(
                    "ReportComposer LLM narrative failed (%s) — using deterministic.",
                    exc,
                )

        return skeleton

    # ── strategies ────────────────────────────────────────────────────────────

    def _build_skeleton(
        self,
        row: dict[str, Any],
        sub_goals: list[SubGoal],
        observations: list[Observation],
        audit: list[AuditEntry],
    ) -> TaskReport:
        sg_done, sg_total = _aggregate_subgoals(sub_goals)
        actions_total, actions_failed, _ = _aggregate_actions(audit)

        created_at = row.get("created_at")
        finished_at = row.get("finished_at") or datetime.now(tz=timezone.utc)
        try:
            duration_ms = int((finished_at - created_at).total_seconds() * 1000)
            if duration_ms < 0:
                duration_ms = 0
        except Exception:
            duration_ms = 0

        status = (row.get("status") or "done")
        return TaskReport(
            task_id=row["id"],
            goal=row.get("goal", ""),
            status=status,  # type: ignore[arg-type]
            track=row.get("track") or "foreground",  # type: ignore[arg-type]
            duration_ms=duration_ms,
            achievements=_hardcap(
                _achievements_deterministic(sub_goals, audit, status),  # type: ignore[arg-type]
                MAX_ACHIEVEMENTS,
            ),
            obstacles=_hardcap(
                _obstacles_deterministic(sub_goals, audit, row.get("error")),
                MAX_OBSTACLES,
            ),
            key_decisions=_key_decisions_from(observations, audit),
            next_steps=_hardcap(
                _next_steps_deterministic(sub_goals, status),  # type: ignore[arg-type]
                MAX_NEXT_STEPS,
            ),
            evidence_links=_evidence_links(audit),
            audit_trail_compact=_audit_compact(audit),
            llm_narrative=None,
            generation_strategy="deterministic",
            sub_goals_done=sg_done,
            sub_goals_total=sg_total,
            actions_total=actions_total,
            actions_failed=actions_failed,
        )

    async def _compose_llm(
        self,
        skeleton: TaskReport,
        sub_goals: list[SubGoal],
        observations: list[Observation],
        row: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Call ai_router for a structured JSON enrichment. Returns a dict with
        keys {achievements, obstacles, next_steps, narrative} or None on any
        problem (caller falls back to skeleton).
        """
        try:
            from ai.provider import ai_router
        except Exception:
            return None

        _, _, action_counts = _aggregate_actions([])  # placeholder no-op

        # Recompute counts from audit_trail_compact (we already truncated above).
        counts: dict[str, int] = {}
        for a in skeleton.audit_trail_compact:
            counts[a.action] = counts.get(a.action, 0) + 1

        # Take last 6 observations + reflection summaries as context.
        obs_lines: list[str] = []
        for obs in observations[-12:]:
            tag = obs.type[:4].upper()
            obs_lines.append(f"- [{tag}] {obs.content[:200]}")
        reflections = _extract_reflections(observations)
        ref_lines = [
            f"- {r.verdict}: {r.summary[:200]} (cf={r.new_confidence:.2f})"
            for r in reflections[-6:]
        ]

        prompt = _NARRATIVE_PROMPT.format(
            max_a=MAX_ACHIEVEMENTS,
            max_o=MAX_OBSTACLES,
            max_n=MAX_NEXT_STEPS,
            goal=skeleton.goal[:400],
            status=skeleton.status,
            duration_s=int(skeleton.duration_ms / 1000),
            sg_done=skeleton.sub_goals_done,
            sg_total=skeleton.sub_goals_total,
            action_counts=json.dumps(counts, ensure_ascii=False),
            observations="\n".join(obs_lines) or "(none)",
            reflections="\n".join(ref_lines) or "(none)",
        )

        try:
            response = await ai_router.generate(
                user_message=prompt,
                system_prompt="Ти — стислий редактор. Відповідай ЛИШЕ JSON.",
                history=[],
                task_id=row.get("id"),
            )
        except Exception as exc:
            logger.debug("ReportComposer ai_router call failed: %s", exc)
            return None

        text = (response.content or "").strip()
        if not text:
            return None
        # Strip code-fence guards if model insisted on them.
        if text.startswith("```"):
            text = text.strip("` \n")
            if text.lower().startswith("json"):
                text = text[4:].strip()
        try:
            obj = json.loads(text)
        except Exception:
            # One soft-retry: clip to the largest valid {...} substring.
            start = text.find("{")
            end = text.rfind("}")
            if start >= 0 and end > start:
                try:
                    obj = json.loads(text[start:end + 1])
                except Exception:
                    return None
            else:
                return None

        if not isinstance(obj, dict):
            return None
        return obj

    def _merge_narrative(
        self,
        skeleton: TaskReport,
        narrative: dict[str, Any],
    ) -> TaskReport:
        """Merge LLM-supplied bullets into the deterministic skeleton.

        Strategy: prefer LLM-narrative for human-readable bullet text, but cap
        sizes and dedupe against the skeleton. The deterministic skeleton remains
        as a backstop if any field is empty/missing.
        """
        def _coerce_list(v: Any) -> list[str]:
            if isinstance(v, list):
                return [str(x) for x in v if x]
            return []

        ach = _coerce_list(narrative.get("achievements"))
        obs = _coerce_list(narrative.get("obstacles"))
        nxt = _coerce_list(narrative.get("next_steps"))
        narrative_text = str(narrative.get("narrative") or "").strip()

        merged_ach = _hardcap([*ach, *skeleton.achievements], MAX_ACHIEVEMENTS)
        merged_obs = _hardcap([*obs, *skeleton.obstacles], MAX_OBSTACLES)
        merged_nxt = _hardcap([*nxt, *skeleton.next_steps], MAX_NEXT_STEPS)

        return skeleton.model_copy(update={
            "achievements": merged_ach,
            "obstacles": merged_obs,
            "next_steps": merged_nxt,
            "llm_narrative": narrative_text or None,
            "generation_strategy": "hybrid" if narrative_text else "deterministic",
        })


# Module-level convenience.
async def compose_task_report(
    task_id: str,
    *,
    prefer_llm: bool = True,
    llm_timeout_s: float = 8.0,
) -> TaskReport | None:
    composer = ReportComposer(llm_timeout_s=llm_timeout_s)
    return await composer.compose(task_id, prefer_llm=prefer_llm)


__all__ = ["ReportComposer", "compose_task_report"]
