"""
Agent API — task control + read endpoints + feedback. All require JWT auth.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from agent.audit import (
    fetch_audit,
    fetch_checkpoint,
    get_task as fetch_task_row,
    list_tasks as audit_list_tasks,
    write_feedback,
)
from agent.needs import info_need_registry, validate_response
from agent.orchestrator import Council, build_default_council_roles
from agent.reports import compose_task_report
from agent.runtime import agent_runtime
from agent.schemas import CouncilSituation, InfoNeedResponse, InnerMonologue
from security.auth import require_auth
from security.jwt_manager import TokenPayload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent", tags=["agent"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class StartTaskRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=2000)


class InterveneRequest(BaseModel):
    instruction: str = Field(..., min_length=1, max_length=4000)


class StopRequest(BaseModel):
    task_id: str | None = None


class ResumeFromCheckpointRequest(BaseModel):
    checkpoint_id: int


class FeedbackRequest(BaseModel):
    audit_entry_id: int
    rating: str = Field(..., pattern=r"^(up|down|comment)$")
    comment: str | None = Field(default=None, max_length=2000)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/task")
async def start_task(
    req: StartTaskRequest,
    response: Response,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    task_id, started = await agent_runtime.start_task(req.goal)
    if not started:
        return {
            "task_id": task_id,
            "started": False,
            "detail": "Foreground slot busy — pause/stop the running task first.",
        }
    return {"task_id": task_id, "started": True}


@router.post("/task/{task_id}/pause")
async def pause_task(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    paused = await agent_runtime.pause(task_id)
    return {"paused": paused}


@router.post("/task/{task_id}/resume")
async def resume_task(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    resumed = await agent_runtime.resume(task_id)
    return {"resumed": resumed}


@router.post("/task/{task_id}/intervene")
async def intervene_task(
    task_id: str,
    req: InterveneRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    queued = await agent_runtime.intervene(task_id, req.instruction)
    return {"queued": queued}


@router.post("/task/{task_id}/cancel_step")
async def cancel_step(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    cancelled = await agent_runtime.cancel_step(task_id)
    return {"cancelled": cancelled}


@router.post("/stop")
async def stop_task(req: StopRequest, _: TokenPayload = Depends(require_auth)) -> dict:
    stopped = await agent_runtime.stop(req.task_id)
    return {"stopped": stopped}


@router.post("/task/{task_id}/checkpoint")
async def create_checkpoint(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    cp_id = await agent_runtime.checkpoint_now(task_id)
    if cp_id is None:
        raise HTTPException(status_code=404, detail="task not active")
    return {"checkpoint_id": cp_id}


@router.post("/task/{task_id}/resume_from_checkpoint")
async def resume_from_checkpoint(
    task_id: str,
    req: ResumeFromCheckpointRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    cp = await fetch_checkpoint(req.checkpoint_id)
    if cp is None:
        raise HTTPException(status_code=404, detail="checkpoint not found")
    if cp.task_id != task_id:
        raise HTTPException(status_code=400, detail="checkpoint belongs to a different task")
    ok = await agent_runtime.resume_from_checkpoint(task_id, req.checkpoint_id)
    if not ok:
        raise HTTPException(status_code=409, detail="cannot resume — slot busy or task already running")
    return {"resumed": True}


@router.get("/tasks")
async def list_tasks(
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    _: TokenPayload = Depends(require_auth),
) -> dict:
    rows = await audit_list_tasks(status=status, limit=limit)
    return {"tasks": [_serialize_task(r) for r in rows]}


@router.get("/task/{task_id}")
async def get_task(task_id: str, _: TokenPayload = Depends(require_auth)) -> dict:
    row = await fetch_task_row(task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="task not found")
    last_audit = await fetch_audit(task_id, limit=50)
    return {
        "task": _serialize_task(row),
        "sub_goals": row.get("sub_goals") or [],
        "self_model": row.get("self_model"),
        "observations": row.get("observations") or [],
        "thought_budget": row.get("thought_budget"),
        "last_audit": [a.model_dump(mode="json") for a in reversed(last_audit)],
    }


@router.get("/audit")
async def get_audit(
    task_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    _: TokenPayload = Depends(require_auth),
) -> dict:
    rows = await fetch_audit(task_id, limit=limit)
    return {"audit": [a.model_dump(mode="json") for a in rows]}


# ── Phase 16 — TaskReport endpoints ──────────────────────────────────────────

@router.get("/task/{task_id}/report")
async def get_task_report(
    task_id: str,
    prefer_llm: bool = Query(default=True),
    _: TokenPayload = Depends(require_auth),
) -> dict:
    """Return the structured TaskReport for a task.

    Tries the runtime cache first (the freshly composed report from
    finalize_task), then falls back to recomposition from persisted state.
    Recomposition is bounded by the LLM timeout in `compose_task_report`,
    so a quota-exhausted provider never blocks the response.
    """
    cached = agent_runtime.get_pending_report(task_id)
    if cached is not None:
        return {"report": cached, "from_cache": True}

    report = await compose_task_report(task_id, prefer_llm=prefer_llm)
    if report is None:
        raise HTTPException(status_code=404, detail="task not found")
    return {"report": report.model_dump(mode="json"), "from_cache": False}


@router.post("/task/{task_id}/dismiss-report")
async def dismiss_task_report(
    task_id: str,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    """Operator dismissed the report screen — perform the deferred OPERATOR
    layout exit. Idempotent: a second tap returns dismissed=False."""
    dismissed = await agent_runtime.acknowledge_report(task_id)
    return {"dismissed": dismissed}


class ResumeAsConversationResponse(BaseModel):
    task_id: str
    seed_summary: str
    suggested_starter: str
    follow_ups: list[str] = []


@router.post(
    "/task/{task_id}/resume-as-conversation",
    response_model=ResumeAsConversationResponse,
)
async def resume_task_as_conversation(
    task_id: str,
    _: TokenPayload = Depends(require_auth),
) -> ResumeAsConversationResponse:
    """Acknowledge the report screen AND surface a seed payload the chat
    layer can use to bootstrap a new conversation thread carrying the just-
    finished task's context.

    No DB writes happen here — the FE chat store seeds itself with the
    returned payload and the user's first reply triggers the regular chat
    pipeline. Keeping the seed off-record matches the project's principle
    that the user owns when something becomes a persistent message.
    """
    cached = agent_runtime.get_pending_report(task_id)
    if cached is None:
        report = await compose_task_report(task_id, prefer_llm=True)
        if report is None:
            raise HTTPException(status_code=404, detail="task not found")
        cached = report.model_dump(mode="json")

    # Best-effort: ack the pending report so OPERATOR exits cleanly. If it
    # was never pending (e.g. recomposed for a past task), this is a no-op.
    await agent_runtime.acknowledge_report(task_id)

    # Compose the seed text — short and Ukrainian-first, since the FE will
    # render it as the first AI bubble in DialogueLayout.
    goal = cached.get("goal") or ""
    achievements: list[str] = cached.get("achievements") or []
    obstacles: list[str] = cached.get("obstacles") or []
    next_steps: list[str] = cached.get("next_steps") or []
    narrative = (cached.get("llm_narrative") or "").strip()

    head = f"Я завершив задачу: {goal[:200].rstrip()}"
    if narrative:
        head += f"\n\n{narrative}"
    elif achievements:
        head += "\n\nДосягнуто:\n" + "\n".join(f"• {a}" for a in achievements[:4])
    if obstacles:
        head += "\n\nПерешкоди:\n" + "\n".join(f"• {o}" for o in obstacles[:3])

    suggested_starter = "Що ти хочеш зробити з цим далі?"
    if next_steps:
        suggested_starter = f"Наступний крок: {next_steps[0][:160]}. Продовжити?"

    return ResumeAsConversationResponse(
        task_id=task_id,
        seed_summary=head[:1200],
        suggested_starter=suggested_starter[:240],
        follow_ups=[s[:160] for s in next_steps[:5]],
    )


# ── Phase 17a.5 — Information-Need responses ────────────────────────────────


class InfoNeedAnswer(BaseModel):
    info_need_id: str = Field(..., min_length=1)
    answer: object | None = None


@router.get("/task/{task_id}/info-needs")
async def list_pending_info_needs(
    task_id: str,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    needs = info_need_registry.list_for_task(task_id)
    return {"info_needs": [n.model_dump(mode="json") for n in needs]}


# ── Phase 17a — Council manual trigger ──────────────────────────────────────


class CouncilRoundRequest(BaseModel):
    summary: str = Field(..., min_length=1, max_length=2000)
    kind: str = Field(default="user_invoked", pattern=r"^(strategic_revise|before_destructive|low_confidence|info_need|quality_gate|user_invoked)$")
    proposed_action: dict | None = None
    context: dict = Field(default_factory=dict)
    monologue_confidence: float | None = None
    include_aesthete: bool = False


@router.post("/task/{task_id}/council/round")
async def run_council_round(
    task_id: str,
    req: CouncilRoundRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    """Manually trigger a Council deliberation. Used by:
      • the `[Скликати раду]` button on the operator UI for any active task,
      • Phase 17a.6 quality-gate hooks (called from the loop, not user),
      • Phase 17b CouncilCard inside CustomAgent flows.

    Returns the full `CouncilDecision`. WS subscribers also see
    `council.round_started`, `council.role_spoke` (per role), and
    `council.consensus_reached` events, so the FE can replay the round live.
    """
    monologue = (
        InnerMonologue(confidence=float(req.monologue_confidence))
        if req.monologue_confidence is not None
        else None
    )
    situation = CouncilSituation(
        kind=req.kind,                                  # type: ignore[arg-type]
        task_id=task_id,
        summary=req.summary,
        context=req.context,
        proposed_action=req.proposed_action,
        monologue=monologue,
    )

    try:
        from ai.provider import ai_router
    except Exception:
        ai_router = None

    async def _on_role_spoke(stmt) -> None:
        try:
            await agent_runtime._broadcast(  # noqa: SLF001
                "council.role_spoke",
                {"task_id": task_id, "statement": stmt.model_dump(mode="json")},
            )
        except Exception:
            pass

    council = Council(
        roles=build_default_council_roles(include_aesthete=req.include_aesthete),
        ai_router=ai_router,
        on_role_spoke=_on_role_spoke,
    )

    # Round started.
    try:
        await agent_runtime._broadcast(  # noqa: SLF001
            "council.round_started",
            {"task_id": task_id, "kind": req.kind, "summary": req.summary[:300]},
        )
    except Exception:
        pass

    decision = await council.run_round(situation, task_id=task_id)

    try:
        await agent_runtime._broadcast(  # noqa: SLF001
            "council.consensus_reached",
            {"task_id": task_id, "decision": decision.model_dump(mode="json")},
        )
    except Exception:
        pass

    return {"decision": decision.model_dump(mode="json")}


# ── Phase 17a — Live plan editing ───────────────────────────────────────────


class InjectSubgoalRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=500)
    rationale: str = Field(default="", max_length=500)
    position: int | None = Field(default=None, ge=0, le=99)
    expected_actions: int = Field(default=3, ge=1, le=20)
    acceptance_criteria: str = Field(default="", max_length=500)


class PlanDiffEntry(BaseModel):
    op: str = Field(..., pattern=r"^(edit|skip|delete|reorder|inject)$")
    id: str | None = None
    ids: list[str] | None = None
    description: str | None = None
    rationale: str | None = None
    expected_actions: int | None = None
    acceptance_criteria: str | None = None
    position: int | None = None


class PlanPatchRequest(BaseModel):
    diffs: list[PlanDiffEntry] = Field(..., min_length=1)


@router.post("/task/{task_id}/inject-subgoal")
async def inject_subgoal_route(
    task_id: str,
    req: InjectSubgoalRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    result = await agent_runtime.inject_subgoal(
        task_id,
        description=req.description,
        rationale=req.rationale,
        position=req.position,
        expected_actions=req.expected_actions,
        acceptance_criteria=req.acceptance_criteria,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="task not found / not active")
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.delete("/task/{task_id}/subgoals/{sub_goal_id}")
async def delete_subgoal_route(
    task_id: str,
    sub_goal_id: str,
    skip_only: bool = Query(default=False),
    _: TokenPayload = Depends(require_auth),
) -> dict:
    result = await agent_runtime.delete_subgoal(
        task_id, sub_goal_id=sub_goal_id, skip_only=skip_only,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="task not found / not active")
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.patch("/task/{task_id}/plan")
async def patch_plan_route(
    task_id: str,
    req: PlanPatchRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    diffs_raw = [d.model_dump(exclude_none=True) for d in req.diffs]
    result = await agent_runtime.patch_plan(task_id, diffs=diffs_raw)
    if result is None:
        raise HTTPException(status_code=404, detail="task not found / not active")
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.post("/task/{task_id}/info-response")
async def submit_info_response(
    task_id: str,
    req: InfoNeedAnswer,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    """Operator's reply to an outstanding `agent.info_need`.

    Validates the answer against the original InfoNeed shape, then resolves
    the awaiting future on the runtime singleton's registry. The agent loop
    that emitted the AskUser action will resume immediately.
    """
    info_need = info_need_registry.get(req.info_need_id)
    if info_need is None:
        raise HTTPException(status_code=404, detail="info_need not found or already resolved")
    if info_need.task_id != task_id:
        raise HTTPException(status_code=400, detail="info_need belongs to a different task")
    ok, err = validate_response(info_need, req.answer)
    if not ok:
        raise HTTPException(status_code=422, detail=err or "invalid answer")
    response = InfoNeedResponse(
        info_need_id=req.info_need_id,
        task_id=task_id,
        kind=info_need.kind,
        answer=req.answer,
    )
    resolved = info_need_registry.resolve(response)
    if not resolved:
        raise HTTPException(status_code=409, detail="info_need future already resolved or cancelled")
    return {"resolved": True, "info_need_id": req.info_need_id}


@router.get("/status")
async def get_agent_status(_: TokenPayload = Depends(require_auth)) -> dict:
    """
    Phase 9.4a — multi-track runtime status.

    Reports per-track slot state + queue depth so UIs can show "PHANTOM
    is watching N things in the background" without racing the WS
    background_events channel. Substate is foreground-canonical (the
    StatusBar already shows it); background substate is included but
    may be stale since it's log-only.
    """
    def _slot_view(state, substate):
        if state is None:
            return {"active": False, "task_id": None, "substate": substate,
                    "goal": None, "origin": None}
        return {
            "active": True,
            "task_id": state.id,
            "substate": substate,
            "goal": (state.goal or "")[:200],
            "origin": getattr(state, "origin", "user"),
            "status": state.status,
        }

    return {
        "foreground": {
            **_slot_view(agent_runtime.foreground_slot, agent_runtime.foreground_substate),
            "queue_size": agent_runtime.queue_size("foreground"),
        },
        "background": {
            **_slot_view(agent_runtime.background_slot, agent_runtime.background_substate),
            "queue_size": agent_runtime.queue_size("background"),
        },
    }


@router.get("/router_state")
async def get_router_state(_: TokenPayload = Depends(require_auth)) -> dict:
    """
    Phase 9.2.1 — exposes AIRouter cooling / quota / last-call state so the
    StatusBar can show a live provider indicator and the operator can spot
    why a task parked on `blocked_quota`.
    """
    from ai.provider import ai_router
    return ai_router.router_state_snapshot()


@router.get("/self_model")
async def get_self_model(_: TokenPayload = Depends(require_auth)) -> dict:
    sm = agent_runtime.self_model
    if sm is None:
        # Build an ad-hoc one for inspection
        from agent.actions.registry import registry as _reg
        from agent.self_model import build_self_model
        sm = await build_self_model(_reg)
    return {"self_model": sm.model_dump(mode="json"), "substate": agent_runtime.substate}


@router.post("/feedback")
async def submit_feedback(
    req: FeedbackRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    fb_id = await write_feedback(req.audit_entry_id, req.rating, req.comment)
    return {"id": fb_id}


# ── Phase 18 — Screen / desktop control endpoints ──────────────────────────


@router.get("/screen/capture")
async def get_screen_capture(
    x: int | None = Query(default=None),
    y: int | None = Query(default=None),
    w: int | None = Query(default=None),
    h: int | None = Query(default=None),
    return_base64: bool = Query(default=True),
    _: TokenPayload = Depends(require_auth),
) -> dict:
    """Capture the operator's desktop. Returns base64 PNG by default.

    Backend cascade picks mss → grim → scrot → import. If none are
    installed, the response carries `ok=False` + `tried` list so the
    operator UI can prompt them to install grim/scrot.
    """
    from agent.actions.device import ScreenCapture
    from agent.actions.base import ActionContext
    region = None
    if all(v is not None for v in (x, y, w, h)):
        region = [int(x), int(y), int(w), int(h)]
    cap = ScreenCapture(region=region, return_base64=return_base64)
    ctx = ActionContext(task_id="screen-route", step_idx=0, workspace_dir="/tmp")
    result = await cap.execute(ctx)
    if not result.ok:
        raise HTTPException(
            status_code=503,
            detail={
                "error": result.error,
                "tried": (result.output or {}).get("tried"),
            },
        )
    return {"ok": True, **(result.output or {})}


@router.get("/screen/ocr")
async def get_screen_ocr(
    x: int | None = Query(default=None),
    y: int | None = Query(default=None),
    w: int | None = Query(default=None),
    h: int | None = Query(default=None),
    languages: str = Query(default="ukr+eng"),
    min_confidence: float = Query(default=30.0, ge=0.0, le=100.0),
    _: TokenPayload = Depends(require_auth),
) -> dict:
    from agent.actions.device import ScreenOCR
    from agent.actions.base import ActionContext
    region = None
    if all(v is not None for v in (x, y, w, h)):
        region = [int(x), int(y), int(w), int(h)]
    ocr = ScreenOCR(region=region, languages=languages, min_confidence=min_confidence)
    ctx = ActionContext(task_id="screen-route", step_idx=0, workspace_dir="/tmp")
    result = await ocr.execute(ctx)
    if not result.ok:
        raise HTTPException(
            status_code=503,
            detail={"error": result.error, "tried": (result.output or {}).get("tried")},
        )
    return {"ok": True, **(result.output or {})}


# ── Standing orders (Phase 9.3b) ─────────────────────────────────────────────


class StandingOrderCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=256)
    kind: str = Field(..., pattern=r"^(interval|cron|conditional|one_shot_future)$")
    schedule: dict = Field(...)
    action: dict = Field(...)
    enabled: bool = True


class StandingOrderPatch(BaseModel):
    enabled: bool | None = None
    description: str | None = Field(default=None, max_length=256)
    schedule: dict | None = None
    action: dict | None = None


def _so_to_dict(row) -> dict:
    import json as _json
    return {
        "id": row.id,
        "user_id": row.user_id,
        "description": row.description,
        "kind": row.kind,
        "schedule": _json.loads(row.schedule_json),
        "action": _json.loads(row.action_json),
        "enabled": row.enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_fired_at": row.last_fired_at.isoformat() if row.last_fired_at else None,
        "fire_count": row.fire_count,
        "last_outcome": row.last_outcome,
    }


@router.post("/standing_orders")
async def create_standing_order(
    req: StandingOrderCreate,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    import json as _json
    from sqlalchemy import select
    from agent.standing_orders.schedules import parse_schedule
    from agent.standing_orders.conditions import evaluate_condition  # noqa: F401
    from agent.standing_orders.schedules import ConditionalSchedule
    from db.database import get_session
    from db.models import StandingOrder as _SO

    # Validate schedule early — rejecting at write time is better than at
    # fire time.
    payload = dict(req.schedule)
    payload.setdefault("kind", req.kind)
    try:
        schedule = parse_schedule(payload)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"invalid schedule: {exc}")
    # Validate condition DSL up-front so bad conditions fail at creation.
    if isinstance(schedule, ConditionalSchedule):
        import re as _re
        if not _re.match(
            r"^\s*[a-z_]+\s*(==|>=|<=|>|<)\s*-?\d+(\.\d+)?\s*$",
            schedule.condition,
        ):
            raise HTTPException(status_code=422, detail="invalid condition DSL")
        # Also assert metric is known.
        from agent.standing_orders.conditions import KNOWN_CONDITIONS
        metric = schedule.condition.split()[0]
        if metric not in KNOWN_CONDITIONS:
            raise HTTPException(
                status_code=422,
                detail=f"unknown metric {metric!r}; supported: {sorted(KNOWN_CONDITIONS)}",
            )

    async with get_session() as db:
        row = _SO(
            user_id=token_data.user_id,
            description=req.description,
            kind=req.kind,
            schedule_json=_json.dumps(payload),
            action_json=_json.dumps(req.action),
            enabled=req.enabled,
        )
        db.add(row)
        await db.commit()
        result = await db.execute(select(_SO).where(_SO.id == row.id))
        fresh = result.scalar_one()
    return {"order": _so_to_dict(fresh)}


@router.get("/standing_orders")
async def list_standing_orders(
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    from sqlalchemy import select
    from db.database import get_session
    from db.models import StandingOrder as _SO

    async with get_session() as db:
        result = await db.execute(
            select(_SO).where(_SO.user_id == token_data.user_id)
            .order_by(_SO.created_at.desc())
        )
        rows = list(result.scalars())
    return {"orders": [_so_to_dict(r) for r in rows]}


@router.patch("/standing_orders/{order_id}")
async def patch_standing_order(
    order_id: str,
    req: StandingOrderPatch,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    import json as _json
    from sqlalchemy import select
    from db.database import get_session
    from db.models import StandingOrder as _SO

    async with get_session() as db:
        result = await db.execute(select(_SO).where(_SO.id == order_id))
        row = result.scalar_one_or_none()
        if row is None or row.user_id != token_data.user_id:
            raise HTTPException(status_code=404, detail="standing order not found")
        if req.enabled is not None:
            row.enabled = req.enabled
        if req.description is not None:
            row.description = req.description
        if req.schedule is not None:
            from agent.standing_orders.schedules import parse_schedule
            payload = dict(req.schedule)
            payload.setdefault("kind", row.kind)
            try:
                parse_schedule(payload)
            except Exception as exc:
                raise HTTPException(status_code=422, detail=f"invalid schedule: {exc}")
            row.schedule_json = _json.dumps(payload)
        if req.action is not None:
            row.action_json = _json.dumps(req.action)
        await db.commit()
        fresh_result = await db.execute(select(_SO).where(_SO.id == order_id))
        fresh = fresh_result.scalar_one()
    return {"order": _so_to_dict(fresh)}


@router.delete("/standing_orders/{order_id}")
async def delete_standing_order(
    order_id: str,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    from sqlalchemy import delete, select
    from db.database import get_session
    from db.models import StandingOrder as _SO

    async with get_session() as db:
        result = await db.execute(select(_SO).where(_SO.id == order_id))
        row = result.scalar_one_or_none()
        if row is None or row.user_id != token_data.user_id:
            raise HTTPException(status_code=404, detail="standing order not found")
        await db.execute(delete(_SO).where(_SO.id == order_id))
        await db.commit()
    return {"deleted": True, "id": order_id}


def _serialize_task(row: dict) -> dict:
    out = dict(row)
    for key in ("created_at", "finished_at"):
        v = out.get(key)
        if v is not None and hasattr(v, "isoformat"):
            out[key] = v.isoformat()
    # Drop heavy blobs from list views (callers can hit /task/{id} for them).
    for k in ("observations", "self_model", "thought_budget", "sub_goals"):
        out.pop(k, None)
    return out
