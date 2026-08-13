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

from ..kernel.audit import fetch_audit, get_task
from ..schemas import (
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
Ти — Senior Tech Lead. Склади технічне резюме виконаної задачі.
Відповідай живо, уникай шаблонної статистики.

{{
  "achievements": ["конкретні технічні результати"],
  "obstacles": ["що заважало або пішло не так"],
  "next_steps": ["рекомендації на майбутнє"],
  "narrative": "Жива розповідь Senior інженера про те, як пройшла робота та який фінальний стан системи."
}}

Контекст:
МЕТА: {goal}
СТАТУС: {status}
ВИКОНАНО ПІДЦІЛЕЙ: {sg_done}/{sg_total}
РЕЗУЛЬТАТИ СПОСТЕРЕЖЕНЬ:
{observations}

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
        user_id: str,
        task_id: str,
        *,
        prefer_llm: bool = True,
        audit_limit: int = 200,
    ) -> TaskReport | None:
        row = await get_task(user_id, task_id)
        if row is None:
            logger.warning("ReportComposer: task %s not found", task_id)
            return None

        audit = list(reversed(await fetch_audit(user_id, task_id, limit=audit_limit)))
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
    user_id: str,
    task_id: str,
    *,
    prefer_llm: bool = True,
    llm_timeout_s: float = 8.0,
) -> TaskReport | None:
    composer = ReportComposer(llm_timeout_s=llm_timeout_s)
    return await composer.compose(user_id, task_id, prefer_llm=prefer_llm)


# ── Vertical V10 — MissionReportComposer ─────────────────────────────────────

_MISSION_SUMMARY_PROMPT = """\
You are writing a factual engineering postmortem for an autonomous agent mission.
No marketing language. No superlatives. Factual engineering postmortem voice.
Plain text — no markdown formatting in this field.

Write 3-5 paragraphs summarising the mission outcome. Include:
- What was attempted and what actually happened (status, phases completed).
- Key decisions that shaped the outcome.
- Concrete problems encountered and how they were (or were not) resolved.
- What an engineer would do differently next time.

Mission brief: {brief}
Success criteria: {success_criteria}
Status: {status}
Duration: {wall_duration_h:.1f}h
Phases completed: {phases_done}/{phases_total}
Total decisions: {total_decisions}
Total artifacts: {total_artifacts}

Phase summaries:
{phase_summaries}

Do not invent facts. If a phase has no data, say so plainly.
"""


class MissionReportComposer:
    """Builds a MissionReport from persisted Mission + Phase state.

    Stateless — instantiate per call. Uses missions/store.py for DB access
    so per-user isolation is enforced at every query.

    Design mirrors ReportComposer:
    • Never raises — LLM failure always falls through to deterministic.
    • Returns the same MissionReport shape regardless of strategy.
    • Can be called on any historical mission, not just the live one.
    """

    def __init__(self, *, llm_timeout_s: float = 12.0) -> None:
        self.llm_timeout_s = llm_timeout_s

    async def compose(
        self,
        user_id: str,
        mission_id: str,
        *,
        prefer_llm: bool = True,
    ) -> "MissionReport | None":
        # `.store`, not `.missions.store`: this module already lives inside
        # `agent.missions`, so the old path resolved to
        # `agent.missions.missions.store` and every compose() call died on
        # ModuleNotFoundError — mission reports could never be produced.
        from .store import get_mission, list_phases
        from ..schemas import MissionReport, MissionReportPhase

        # Per-user isolation — raises PermissionError on cross-user access.
        try:
            mission = await get_mission(user_id, mission_id)
        except PermissionError:
            logger.warning(
                "MissionReportComposer: cross-user access denied mission=%s user=%s",
                mission_id, user_id,
            )
            return None
        if mission is None:
            logger.warning(
                "MissionReportComposer: mission %s not found", mission_id,
            )
            return None

        phases = await list_phases(mission_id)

        # Build per-phase slices.
        phase_reports: list[MissionReportPhase] = [
            self._build_phase_report(p) for p in phases
        ]

        # Aggregate metrics.
        total_artifacts = sum(len(pr.artifacts) for pr in phase_reports)
        total_decisions = sum(len(pr.decisions) for pr in phase_reports)
        all_lessons = _dedup_flat([l for pr in phase_reports for l in pr.lessons])

        # Resource summary from system_monitor history.
        resource_summary = await self._aggregate_resources(mission)

        # Wall duration.
        wall_duration_h = self._wall_duration(mission)

        # Council engagements — count observations of type 'council' across
        # all phase audit logs. Best-effort: 0 when not tracked.
        council_count = 0  # Phase D-1 will wire this properly.

        # Deterministic overall_summary.
        phases_done = sum(1 for p in phases if getattr(p, "status", "") == "done")
        det_summary = self._deterministic_summary(
            mission, phase_reports, phases_done, len(phases),
        )

        composed_at = datetime.now(timezone.utc).isoformat()

        report = MissionReport(
            mission_id=mission_id,
            brief=mission.brief or "",
            success_criteria=mission.success_criteria or "",
            quality_bar=mission.quality_bar or None,
            status=mission.status or "unknown",
            started_at=(
                mission.created_at.isoformat()
                if mission.created_at else composed_at
            ),
            finished_at=(
                mission.finished_at.isoformat()
                if mission.finished_at else None
            ),
            wall_duration_h=wall_duration_h,
            overall_summary=det_summary,
            phases=phase_reports,
            total_artifacts=total_artifacts,
            total_decisions=total_decisions,
            aggregate_lessons=all_lessons[:10],
            resource_summary=resource_summary,
            council_engagements=council_count,
            budget_spent_usd=None,
            composed_at=composed_at,
        )

        if prefer_llm:
            try:
                llm_summary = await asyncio.wait_for(
                    self._llm_summary(mission, phase_reports, phases_done),
                    timeout=self.llm_timeout_s,
                )
                if llm_summary:
                    report = report.model_copy(
                        update={"overall_summary": llm_summary}
                    )
            except asyncio.TimeoutError:
                logger.info(
                    "MissionReportComposer: LLM summary timed out, using deterministic"
                )
            except Exception as exc:
                logger.info(
                    "MissionReportComposer: LLM summary failed (%s), using deterministic",
                    exc,
                )

        return report

    # ── Phase-level builder ───────────────────────────────────────────────────

    def _build_phase_report(self, phase: Any) -> "MissionReportPhase":
        from ..schemas import MissionReportPhase
        import json as _json

        # Artifacts from artifacts_json column.
        artifacts: list[dict[str, str]] = []
        artifacts_raw = getattr(phase, "artifacts_json", None)
        if artifacts_raw:
            try:
                raw = _json.loads(artifacts_raw)
                if isinstance(raw, list):
                    for item in raw:
                        if isinstance(item, dict):
                            artifacts.append({
                                "path": str(item.get("path", "")),
                                "kind": str(item.get("kind", "file")),
                                "size_bytes": str(item.get("size_bytes", "")),
                                "embedded": str(item.get("embedded", "false")),
                            })
            except Exception:
                pass

        # Duration in hours.
        duration_h: float | None = None
        started_at = getattr(phase, "started_at", None)
        finished_at = getattr(phase, "finished_at", None)
        if started_at and finished_at:
            try:
                duration_h = (finished_at - started_at).total_seconds() / 3600.0
            except Exception:
                pass
        elif not duration_h:
            exp = getattr(phase, "expected_duration_h", None)
            if exp:
                duration_h = float(exp)

        return MissionReportPhase(
            idx=getattr(phase, "idx", 0),
            description=getattr(phase, "description", ""),
            success_criteria=getattr(phase, "success_criteria", "") or "",
            status=getattr(phase, "status", "unknown"),
            duration_h=duration_h,
            achievements=[],   # Phase audit integration deferred (no audit_id on Phase)
            decisions=[],      # Same — wired when Block D adds phase_audit table
            artifacts=artifacts,
            lessons=[],        # Ledger-parsed lessons deferred to Block D
            failure_modes=[],
            visual_snapshot_b64=None,
        )

    # ── Resource aggregation ──────────────────────────────────────────────────

    async def _aggregate_resources(self, mission: Any) -> dict[str, Any]:
        """Read system_monitor.history() and aggregate over the mission window.

        Falls back to empty dict when the monitor has no history or the
        mission timestamps are unavailable.
        """
        try:
            from core.system_monitor import system_monitor

            history = system_monitor.history(last_n=720)
            if not history:
                return {}

            # Try to filter to the mission's wall-clock window.
            # ResourceSnapshot.ts is monotonic — we can't reliably filter by
            # wall time, so we use the full history as a best approximation
            # (most missions are short relative to the 1-hour history window).
            ram_pcts = [s.ram_used_pct for s in history]
            cpu_pcts = [s.cpu_pct for s in history]
            temps = [s.cpu_temp_c for s in history if s.cpu_temp_c is not None]
            disk_frees = [s.disk_free_gb for s in history]

            return {
                "peak_ram_pct": round(max(ram_pcts), 1) if ram_pcts else None,
                "avg_cpu_pct": round(sum(cpu_pcts) / len(cpu_pcts), 1) if cpu_pcts else None,
                "max_cpu_temp_c": round(max(temps), 1) if temps else None,
                "min_disk_free_gb": round(min(disk_frees), 2) if disk_frees else None,
                "samples": len(history),
            }
        except Exception as exc:
            logger.debug("MissionReportComposer: resource aggregation failed: %s", exc)
            return {}

    # ── Duration helper ───────────────────────────────────────────────────────

    @staticmethod
    def _wall_duration(mission: Any) -> float:
        try:
            created = mission.created_at
            finished = mission.finished_at or datetime.now(timezone.utc)
            return max(0.0, (finished - created).total_seconds() / 3600.0)
        except Exception:
            return 0.0

    # ── Deterministic summary ─────────────────────────────────────────────────

    @staticmethod
    def _deterministic_summary(
        mission: Any,
        phase_reports: list[Any],
        phases_done: int,
        phases_total: int,
    ) -> str:
        """Build a template-driven summary when LLM is unavailable."""
        brief = (mission.brief or "")[:200]
        status = mission.status or "unknown"
        lines: list[str] = [
            f"Mission: {brief}",
            f"Status: {status}. {phases_done}/{phases_total} phases completed.",
        ]

        done_phases = [p for p in phase_reports if p.status == "done"]
        if done_phases:
            lines.append(
                "Completed phases: "
                + ", ".join(f"Phase {p.idx + 1} ({p.description[:60]})" for p in done_phases[:5])
                + "."
            )

        failed_phases = [p for p in phase_reports if p.status in ("failed", "abandoned")]
        if failed_phases:
            lines.append(
                "Failed phases: "
                + ", ".join(f"Phase {p.idx + 1} ({p.description[:60]})" for p in failed_phases[:3])
                + "."
            )

        all_lessons = [l for p in phase_reports for l in (p.lessons or [])]
        if all_lessons:
            lines.append("Key lessons: " + "; ".join(all_lessons[:3]) + ".")

        sc = (mission.success_criteria or "").strip()
        if sc:
            lines.append(f"Success criteria: {sc[:200]}")

        return " ".join(lines)

    # ── LLM summary ──────────────────────────────────────────────────────────

    async def _llm_summary(
        self,
        mission: Any,
        phase_reports: list[Any],
        phases_done: int,
    ) -> str | None:
        try:
            from ai.provider import ai_router
        except Exception:
            return None

        phase_summaries: list[str] = []
        for p in phase_reports:
            ach = "; ".join(p.achievements[:3]) if p.achievements else "none"
            fail = "; ".join(p.failure_modes[:2]) if p.failure_modes else "none"
            phase_summaries.append(
                f"  Phase {p.idx + 1} ({p.description[:80]}): "
                f"status={p.status}, achievements={ach}, failures={fail}"
            )

        prompt = _MISSION_SUMMARY_PROMPT.format(
            brief=(mission.brief or "")[:400],
            success_criteria=(mission.success_criteria or "")[:200],
            status=mission.status or "unknown",
            wall_duration_h=MissionReportComposer._wall_duration(mission),
            phases_done=phases_done,
            phases_total=len(phase_reports),
            total_decisions=sum(len(p.decisions) for p in phase_reports),
            total_artifacts=sum(len(p.artifacts) for p in phase_reports),
            phase_summaries="\n".join(phase_summaries) or "(no phases)",
        )

        try:
            response = await ai_router.generate(
                user_message=prompt,
                system_prompt=(
                    "You write factual engineering postmortems. "
                    "Plain prose only — no markdown, no bullet points, no headers."
                ),
                history=[],
            )
        except Exception as exc:
            logger.debug("MissionReportComposer: LLM call failed: %s", exc)
            return None

        text = (response.content or "").strip()
        if not text or len(text) < 40:
            return None
        # Reject obvious JSON blobs (model confused).
        if text.startswith("{") or text.startswith("["):
            return None
        return text[:2000]


def _dedup_flat(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.strip()
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


# Module-level convenience for V10.
async def compose_mission_report(
    user_id: str,
    mission_id: str,
    *,
    prefer_llm: bool = True,
    llm_timeout_s: float = 12.0,
) -> "MissionReport | None":
    """Compose and return a MissionReport for the given mission.

    Per-user isolated — returns None if mission not found or not owned by user.
    Deterministic fallback when LLM is unavailable.
    """
    from ..schemas import MissionReport
    composer = MissionReportComposer(llm_timeout_s=llm_timeout_s)
    return await composer.compose(user_id, mission_id, prefer_llm=prefer_llm)


__all__ = [
    "ReportComposer",
    "compose_task_report",
    "MissionReportComposer",
    "compose_mission_report",
]
