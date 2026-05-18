"""
Council — coordinated debate of 3-7 AgentRoles around one situation.

Round structure:
  1. Parallel `role.deliberate(situation)` for every member EXCEPT moderator.
  2. Critic + RiskAssessor objections are prioritised; if any blocker fires
     the chosen action is downgraded (revise / ask_user / abort) regardless
     of executor's preference.
  3. Moderator composes the consensus statement + picks the chosen_action.
  4. If `prefer_llm` is True and the LLM-backed role failed → swap in the
     deterministic fallback so the round still has a complete cast on UI.

The Council does NOT broadcast WS events itself — it just returns the
`CouncilDecision`. The runtime emits `council.round_started`,
`council.role_spoke`, `council.consensus_reached` so the FE can replay rounds
deterministically (incl. tests).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from ...schemas import (
    CouncilDecision,
    CouncilSituation,
    CouncilSituationKind,
    RoleName,
    RoleStatement,
)
from .deterministic_personas import (
    fallback_moderator,
    fallback_role_statement,
    is_destructive,
)
from .role import AgentRole, build_default_council_roles

logger = logging.getLogger(__name__)


_BLOCKING_ROLES: frozenset[RoleName] = frozenset({"critic", "risk_assessor"})


class Council:
    """3-7 AgentRoles deliberating one round on a CouncilSituation."""

    def __init__(
        self,
        roles: list[AgentRole] | None = None,
        *,
        ai_router: Any | None = None,
        prefer_llm: bool = True,
        per_role_timeout_s: float = 6.0,
        on_role_spoke: Any | None = None,
    ) -> None:
        self.roles = roles or build_default_council_roles()
        self.ai_router = ai_router
        self.prefer_llm = prefer_llm
        self.per_role_timeout_s = per_role_timeout_s
        # Optional async callback fired immediately after each role yields a
        # statement. Used by the runtime to broadcast `council.role_spoke`
        # mid-round so the UI can typewriter-out the debate live.
        self.on_role_spoke = on_role_spoke

    @property
    def role_names(self) -> list[RoleName]:
        return [r.name for r in self.roles]

    async def run_round(
        self,
        situation: CouncilSituation,
        *,
        task_id: str | None = None,
    ) -> CouncilDecision:
        """Run a single deliberation round and return a CouncilDecision."""
        used_strategy = "deterministic"
        statements: list[RoleStatement] = []

        if self.prefer_llm and self.ai_router is not None:
            statements = await self._gather_llm_statements(situation, task_id)
            # If at least one role spoke via LLM, mark hybrid (others were
            # patched via deterministic fallback).
            llm_count = sum(
                1 for s in statements
                if s is not None and s.role != "moderator"
            )
            used_strategy = "hybrid" if 0 < llm_count < len(self.roles) else (
                "llm" if llm_count == len(self.roles) else "deterministic"
            )

        if not statements:
            statements = await self._gather_deterministic_statements(situation)
            used_strategy = "deterministic"

        # Moderator step — picks consensus + chosen_action.
        moderator_statement: RoleStatement
        if self.prefer_llm and self.ai_router is not None:
            moderator_role = AgentRole("moderator")
            try:
                spoken = await asyncio.wait_for(
                    moderator_role.deliberate(
                        situation,
                        ai_router=self.ai_router,
                        task_id=task_id,
                        timeout_s=self.per_role_timeout_s,
                    ),
                    timeout=self.per_role_timeout_s,
                )
            except asyncio.TimeoutError:
                spoken = None
            except Exception as exc:
                logger.debug("moderator LLM failed: %s", exc)
                spoken = None
            moderator_statement = (
                spoken
                if spoken is not None
                else fallback_moderator(situation, statements)
            )
            await self._notify_role_spoke(moderator_statement)
        else:
            moderator_statement = fallback_moderator(situation, statements)
            await self._notify_role_spoke(moderator_statement)

        statements_with_moderator = [*statements, moderator_statement]

        verdict, chosen_action = self._derive_verdict(situation, statements_with_moderator)
        consensus_summary = (
            moderator_statement.text
            or self._compose_summary_fallback(statements_with_moderator, verdict)
        )

        return CouncilDecision(
            situation=situation,
            verdict=verdict,
            statements=statements_with_moderator,
            consensus_summary=consensus_summary[:1200],
            consensus_confidence=moderator_statement.confidence,
            chosen_action=chosen_action,
            rounds_used=1,
            generation_strategy=(
                "llm" if used_strategy == "llm" and verdict != "abort" else used_strategy
            ),
        )

    # ── Internals ────────────────────────────────────────────────────────────

    async def _gather_llm_statements(
        self,
        situation: CouncilSituation,
        task_id: str | None,
    ) -> list[RoleStatement]:
        """Run all non-moderator roles in parallel via LLM, fall back per-role."""
        coros = [
            self._role_with_fallback(role, situation, task_id) for role in self.roles
        ]
        results = await asyncio.gather(*coros, return_exceptions=True)
        out: list[RoleStatement] = []
        for r in results:
            if isinstance(r, RoleStatement):
                out.append(r)
                await self._notify_role_spoke(r)
        return out

    async def _role_with_fallback(
        self,
        role: AgentRole,
        situation: CouncilSituation,
        task_id: str | None,
    ) -> RoleStatement:
        if self.ai_router is None:
            return fallback_role_statement(role.name, situation)
        try:
            spoken = await asyncio.wait_for(
                role.deliberate(
                    situation,
                    ai_router=self.ai_router,
                    task_id=task_id,
                    timeout_s=self.per_role_timeout_s,
                ),
                timeout=self.per_role_timeout_s,
            )
        except asyncio.TimeoutError:
            spoken = None
        except Exception as exc:
            logger.debug("role %s LLM failed: %s", role.name, exc)
            spoken = None
        if spoken is None:
            return fallback_role_statement(role.name, situation)
        return spoken

    async def _gather_deterministic_statements(
        self,
        situation: CouncilSituation,
    ) -> list[RoleStatement]:
        out: list[RoleStatement] = []
        for role in self.roles:
            stmt = fallback_role_statement(role.name, situation)
            out.append(stmt)
            await self._notify_role_spoke(stmt)
        return out

    async def _notify_role_spoke(self, stmt: RoleStatement) -> None:
        if self.on_role_spoke is None:
            return
        try:
            res = self.on_role_spoke(stmt)
            if asyncio.iscoroutine(res):
                await res
        except Exception as exc:
            logger.debug("on_role_spoke callback failed: %s", exc)

    def _derive_verdict(
        self,
        situation: CouncilSituation,
        statements: list[RoleStatement],
    ) -> tuple[str, dict[str, Any] | None]:
        # Aggregate objections from blocking roles.
        blockers = [
            s for s in statements
            if s.role in _BLOCKING_ROLES and s.objection_to
        ]
        # Pick chosen_action from executor / moderator suggests.
        chosen_action: dict[str, Any] | None = None
        for s in statements:
            if s.role == "moderator" and s.suggests_action:
                chosen_action = s.suggests_action
                break
        if chosen_action is None:
            for s in statements:
                if s.role == "executor" and s.suggests_action:
                    chosen_action = s.suggests_action
                    break

        # Hard-block destructive actions in info_need / before_destructive
        # situations with no operator confirmation.
        proposed_blob = ""
        if isinstance(situation.proposed_action, dict):
            proposed_blob = " ".join(
                str(v) for v in situation.proposed_action.values()
            )
        if is_destructive(proposed_blob) and situation.kind != "user_invoked":
            return "ask_user", chosen_action

        if situation.kind == "info_need":
            return "ask_user", chosen_action

        if blockers:
            return "revise", chosen_action

        if not chosen_action and situation.kind in {
            "strategic_revise", "before_destructive", "low_confidence",
        }:
            return "revise", None

        return "proceed", chosen_action

    def _compose_summary_fallback(
        self,
        statements: list[RoleStatement],
        verdict: str,
    ) -> str:
        # Lightweight 1-line digest — used only if moderator's text is empty.
        bullet = []
        for s in statements:
            if s.role == "moderator":
                continue
            bullet.append(f"{s.role}: {s.text[:120]}")
        prefix = f"[{verdict}] "
        return prefix + " · ".join(bullet[:5])


# ── Convenience ──────────────────────────────────────────────────────────────


def make_default_council(
    *,
    ai_router: Any | None = None,
    include_aesthete: bool = False,
    on_role_spoke: Any | None = None,
) -> Council:
    return Council(
        roles=build_default_council_roles(include_aesthete=include_aesthete),
        ai_router=ai_router,
        on_role_spoke=on_role_spoke,
    )


__all__ = ["Council", "make_default_council"]
