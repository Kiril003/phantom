"""
Phase 17a.5 — AskUser action.

Builds an `InfoNeed`, broadcasts it on the WS, and `await`s the operator's
reply through `agent.needs.info_need_registry`. The action's `execute()` blocks
until the user responds (or the task is cancelled / paused). The runtime
already supports `pause_event` so this doesn't introduce a new pause mechanism.

Args (Pydantic-validated):
  question: str (the operator-facing question)
  kind: InfoNeedKind ('text' | 'single_choice' | 'multi_choice' | 'file_pick' |
                      'range' | 'confirm' | 'visual_pick')
  options: list[InfoNeedOption] (for choice/visual_pick)
  hint: str | None
  default: any | None
  range_min, range_max, range_step: float | None
  placeholder: str | None
  required: bool
  resolution_strategy: 'ask' | 'search_first_then_ask'
  timeout_s: float | None — how long to wait for the operator before falling
                            back to `default` (or failing if none).

Result.output:
  { "answer": ..., "source": "user"|"memory"|"web"|"default",
    "confidence": float, "info_need_id": str }
"""
from __future__ import annotations

import logging
from typing import Any, ClassVar

from pydantic import Field

from ..needs import (
    info_need_registry,
    resolve_information_need,
    validate_response,
)
from ..schemas import (
    ActionResult,
    InfoNeed,
    InfoNeedKind,
    InfoNeedOption,
    Precondition,
    RiskLevel,
)
from .base import Action, ActionContext

logger = logging.getLogger(__name__)


class AskUser(Action):
    name: ClassVar[str] = "agent.ask_user"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    question: str
    kind: InfoNeedKind = "text"
    options: list[InfoNeedOption] = Field(default_factory=list)
    hint: str | None = None
    default: Any | None = None
    range_min: float | None = None
    range_max: float | None = None
    range_step: float | None = None
    placeholder: str | None = None
    required: bool = True
    resolution_strategy: str = "ask"  # "ask" | "search_first_then_ask"
    timeout_s: float | None = 600.0   # 10-minute default soft cap

    def preconditions(self) -> list[Precondition]:
        # No DB / network preconditions — purely communicative action.
        return []

    async def execute(self, ctx: ActionContext) -> ActionResult:
        info_need = InfoNeed(
            task_id=ctx.task_id,
            kind=self.kind,
            question=self.question,
            hint=self.hint,
            options=self.options,
            default=self.default,
            required=self.required,
            range_min=self.range_min,
            range_max=self.range_max,
            range_step=self.range_step,
            placeholder=self.placeholder,
            resolution_strategy=(
                self.resolution_strategy if self.resolution_strategy in
                {"ask", "search_first_then_ask"} else "ask"
            ),  # type: ignore[arg-type]
        )

        runtime = ctx.runtime  # AgentRuntime singleton, may be None in tests

        async def _broadcast(need: InfoNeed) -> None:
            if runtime is None:
                return
            try:
                await runtime._broadcast(  # noqa: SLF001 — internal hub access
                    "agent.info_need",
                    {
                        "task_id": need.task_id,
                        "info_need": need.model_dump(mode="json"),
                    },
                )
            except Exception as exc:
                logger.debug("agent.info_need broadcast failed: %s", exc)

        # Phase 17a.5 follow-up: when the planner asks for "search_first_then_ask"
        # and the answer is open-ended text, we now actually try memory and the
        # web BEFORE bothering the operator. Previously these hooks were always
        # None — the strategy declared but never honoured. The lookups stay
        # best-effort: any failure / empty result silently falls through to the
        # ask-user path so the operator never sees a degraded experience.
        memory_lookup = None
        web_research = None
        if (
            info_need.resolution_strategy == "search_first_then_ask"
            and info_need.kind == "text"
        ):
            user_id = self._extract_user_id(ctx)
            if user_id:
                memory_lookup = self._build_memory_lookup(user_id)
            web_research = self._build_web_research(ctx)

        try:
            resolution = await resolve_information_need(
                info_need,
                ai_router=None,
                memory_lookup=memory_lookup,
                web_research=web_research,
                on_emit=_broadcast,
                timeout_s=self.timeout_s,
            )
        except Exception as exc:
            return ActionResult(
                ok=False,
                error=f"info_need resolution failed: {exc}",
                error_class=type(exc).__name__,
                elapsed_ms=0,
            )

        # Validate the answer's shape against the InfoNeed (defensive — the FE
        # should already validate, but the audit trail benefits from a clean
        # rejection if a malformed reply lands).
        ok, err = validate_response(info_need, resolution.answer)
        if not ok:
            return ActionResult(
                ok=False,
                error=err or "invalid info_need answer",
                error_class="InfoNeedValidationError",
                elapsed_ms=0,
            )

        if runtime is not None:
            try:
                await runtime._broadcast(  # noqa: SLF001
                    "agent.info_need_resolved",
                    {
                        "task_id": ctx.task_id,
                        "info_need_id": info_need.id,
                        "source": resolution.source,
                    },
                )
            except Exception as exc:
                logger.debug("agent.info_need_resolved broadcast failed: %s", exc)

        # Side-effect cleanup if a stale entry survived.
        info_need_registry.cancel(info_need.id, reason="resolved")

        return ActionResult(
            ok=True,
            output={
                "answer": resolution.answer,
                "source": resolution.source,
                "confidence": resolution.confidence,
                "info_need_id": info_need.id,
                "kind": info_need.kind,
            },
            elapsed_ms=0,
            sandboxed=False,
            side_effects=["asked_user"],
        )

    # ── Resolution-strategy helpers ──────────────────────────────────────────

    @staticmethod
    def _extract_user_id(ctx: ActionContext) -> str | None:
        """Pull the active task's user_id off the runtime so memory queries
        can scope to the owner. Returns None when running in a unit test
        harness without a runtime, in which case memory lookup is skipped.
        """
        runtime = ctx.runtime
        if runtime is None:
            return None
        try:
            state = runtime._state_for_task(ctx.task_id)  # noqa: SLF001
        except Exception:
            return None
        if state is None:
            return None
        try:
            return state.self_model.user_id
        except Exception:
            return None

    @staticmethod
    def _build_memory_lookup(user_id: str):
        """Build a `memory_lookup(info_need) -> str | None` callable that
        queries strategic memory (ChromaDB) for facts relevant to the
        operator's question. Returns the joined top-3 fact texts, or None
        if nothing meaningful was found.
        """
        async def _lookup(info_need: InfoNeed) -> str | None:
            try:
                from memory.strategic_memory import retrieve_relevant
            except Exception:
                return None
            try:
                hits = await retrieve_relevant(
                    user_id=user_id,
                    query=info_need.question[:240],
                    top_k=5,
                )
            except Exception as exc:
                logger.debug("strategic_memory lookup failed: %s", exc)
                return None
            if not hits:
                return None
            # Drop empty / very-short hits — semantic match noise.
            cleaned = [h.strip() for h in hits if h and len(h.strip()) >= 12]
            if not cleaned:
                return None
            return " ".join(cleaned[:3])[:1200]
        return _lookup

    @staticmethod
    def _build_web_research(ctx: ActionContext):
        """Build a `web_research(info_need) -> str | None` callable that
        runs the existing WebResearch action with the InfoNeed's question
        as the seed query. Returns the synthesised digest, or None on
        empty result / network failure.
        """
        async def _research(info_need: InfoNeed) -> str | None:
            try:
                from .research import WebResearch
            except Exception:
                return None
            try:
                researcher = WebResearch(
                    query=info_need.question[:240],
                    context=(info_need.hint or "")[:200],
                    min_sources=3,
                    max_iterations=6,
                )
                # Reuse the parent action's ctx — WebResearch only reads
                # task_id / runtime for telemetry, doesn't write to the
                # workspace.
                result = await researcher.execute(ctx)
            except Exception as exc:
                logger.debug("web_research callable raised: %s", exc)
                return None
            if not result.ok or not isinstance(result.output, dict):
                return None
            digest = result.output.get("digest") or ""
            sources = result.output.get("sources") or []
            if not digest or len(sources) < 2:
                # Insufficient corroboration — better to fall through to
                # ask-user than feed a thin guess back to the agent.
                return None
            return str(digest)[:2000]
        return _research


__all__ = ["AskUser"]
