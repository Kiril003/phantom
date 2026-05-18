"""
Block C-1 — Mission + Phase async CRUD helpers.

All functions are async, use get_session() from db.database, and enforce
per-user isolation: every query is scoped by user_id. Attempting to read
another user's Mission raises PermissionError — same pattern as audit.get_task.

No changes to loop.py / runtime.py / planner — that is Block C-2 territory.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from db.database import get_session
from db.models import Mission, Phase

from agent.schemas import MissionBrief, PhaseSpec

logger = logging.getLogger(__name__)

_PHANTOM_HOME = os.path.expanduser("~/.phantom")


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _ledger_path(mission_id: str) -> str:
    """Return the canonical ledger path for a mission (directory + filename)."""
    return os.path.join(_PHANTOM_HOME, "missions", mission_id, "ledger.md")


# ── Mission CRUD ──────────────────────────────────────────────────────────────


async def create_mission(user_id: str, brief: MissionBrief) -> Mission:
    """Persist a new Mission row and return it.

    The ledger path is assigned deterministically from the mission id.
    success_criteria and quality_bar start empty and are written by the
    planner via update_mission_status (or a dedicated update in C-2).
    """
    mission_id = _uuid()
    budget_json: str | None = None
    if brief.budget_constraints is not None:
        budget_json = json.dumps(
            brief.budget_constraints.model_dump(mode="json"), ensure_ascii=False
        )

    row = Mission(
        id=mission_id,
        user_id=user_id,
        brief=brief.brief,
        success_criteria="",
        quality_bar=brief.quality_bar,
        deadline_at=brief.deadline_at,
        budget_constraints_json=budget_json,
        status="planning",
        ledger_path=_ledger_path(mission_id),
    )

    async with get_session() as db:
        db.add(row)
        await db.flush()
        # Ensure the ledger directory exists immediately so callers can open
        # LedgerWriter right after create_mission without a separate mkdir.
        ledger_dir = os.path.dirname(row.ledger_path)
        os.makedirs(ledger_dir, exist_ok=True)

    logger.info("mission created: id=%s user=%s", mission_id, user_id)
    return row


async def get_mission(user_id: str, mission_id: str) -> Mission | None:
    """Return the Mission for this user, or None if not found.

    Raises PermissionError if the mission exists but belongs to a different
    user — prevents cross-user enumeration via timing. Matches the pattern
    in audit.get_task.
    """
    async with get_session() as db:
        row = await db.get(Mission, mission_id)

    if row is None:
        return None
    if row.user_id != user_id:
        raise PermissionError(
            f"mission {mission_id!r} does not belong to user {user_id!r}"
        )
    return row


async def list_missions(
    user_id: str,
    status: str | None = None,
    limit: int = 50,
) -> list[Mission]:
    """Return missions for this user, optionally filtered by status.

    Results are ordered newest-first by created_at.
    """
    async with get_session() as db:
        stmt = (
            select(Mission)
            .where(Mission.user_id == user_id)
        )
        if status is not None:
            stmt = stmt.where(Mission.status == status)
        stmt = stmt.order_by(Mission.created_at.desc()).limit(limit)
        result = await db.execute(stmt)
        rows = list(result.scalars().all())
    return rows


async def update_mission_status(
    user_id: str,
    mission_id: str,
    status: str,
    *,
    finished_at: datetime | None = None,
    success_criteria: str | None = None,
) -> None:
    """Update a mission's status (and optionally finished_at / success_criteria).

    Raises PermissionError on cross-user access. Explicit commit after mutate
    mirrors the pattern in audit.update_task_status to ensure durability even
    if the surrounding context raises before the session exits normally.
    """
    async with get_session() as db:
        row = await db.get(Mission, mission_id)
        if row is None:
            logger.warning("update_mission_status: mission %s not found", mission_id)
            return
        if row.user_id != user_id:
            raise PermissionError(
                f"mission {mission_id!r} does not belong to user {user_id!r}"
            )
        row.status = status
        if finished_at is not None:
            row.finished_at = finished_at
        elif status in ("done", "failed", "abandoned") and row.finished_at is None:
            row.finished_at = _now()
        if success_criteria is not None:
            row.success_criteria = success_criteria
        await db.commit()
    logger.info("mission %s status → %s", mission_id, status)


# ── Phase CRUD ────────────────────────────────────────────────────────────────


async def create_phase(mission_id: str, spec: PhaseSpec, idx: int) -> Phase:
    """Persist a new Phase row and return it.

    idx must be unique within the mission; the UniqueConstraint on
    (mission_id, idx) enforces this at the DB level.
    """
    artifacts_json: str | None = None
    if spec.artifacts:
        artifacts_json = json.dumps(spec.artifacts, ensure_ascii=False)

    row = Phase(
        id=_uuid(),
        mission_id=mission_id,
        idx=idx,
        description=spec.description,
        rationale=spec.rationale,
        success_criteria=spec.success_criteria,
        expected_duration_h=spec.expected_duration_h,
        status="planning",
        artifacts_json=artifacts_json,
    )

    async with get_session() as db:
        db.add(row)
        await db.flush()

    logger.debug("phase created: mission=%s idx=%d id=%s", mission_id, idx, row.id)
    return row


async def get_phase(mission_id: str, phase_id: str) -> Phase | None:
    """Return a Phase by id, scoped to the given mission.

    Returns None if not found or if the phase belongs to a different mission.
    """
    async with get_session() as db:
        row = await db.get(Phase, phase_id)
    if row is None:
        return None
    if row.mission_id != mission_id:
        return None
    return row


async def list_phases(mission_id: str) -> list[Phase]:
    """Return all phases for a mission, ordered by idx ascending."""
    async with get_session() as db:
        stmt = (
            select(Phase)
            .where(Phase.mission_id == mission_id)
            .order_by(Phase.idx.asc())
        )
        result = await db.execute(stmt)
        rows = list(result.scalars().all())
    return rows


async def update_phase_status(
    mission_id: str,
    phase_id: str,
    status: str,
    **kwargs: Any,
) -> None:
    """Update a phase's status and any additional keyword columns.

    Accepted kwargs: started_at, finished_at, artifacts_json.
    All other keys are silently ignored to avoid attribute errors on future
    schema changes — callers pass only what they know about.
    """
    async with get_session() as db:
        row = await db.get(Phase, phase_id)
        if row is None:
            logger.warning("update_phase_status: phase %s not found", phase_id)
            return
        if row.mission_id != mission_id:
            logger.warning(
                "update_phase_status: phase %s mission mismatch", phase_id
            )
            return
        row.status = status

        # Timestamp helpers: auto-set when transitioning into known states.
        if status == "running" and row.started_at is None:
            row.started_at = kwargs.get("started_at") or _now()
        if status in ("done", "failed", "abandoned") and row.finished_at is None:
            row.finished_at = kwargs.get("finished_at") or _now()

        # Explicit overrides accepted from callers.
        for col in ("started_at", "finished_at", "artifacts_json"):
            if col in kwargs and kwargs[col] is not None:
                setattr(row, col, kwargs[col])

        await db.commit()
    logger.debug("phase %s status → %s", phase_id, status)


async def mark_artifact_produced(
    mission_id: str, phase_id: str, artifact_path: str
) -> None:
    """Flip produced=True for the artifact matching artifact_path on a Phase.

    If the artifact is not declared in the phase's artifacts_json, a new entry
    is appended so callers do not need to pre-declare every possible output.
    No-op if phase is not found or belongs to a different mission.
    """
    async with get_session() as db:
        row = await db.get(Phase, phase_id)
        if row is None or row.mission_id != mission_id:
            logger.warning(
                "mark_artifact_produced: phase %s not found or mission mismatch",
                phase_id,
            )
            return

        artifacts: list[dict[str, Any]] = []
        if row.artifacts_json:
            try:
                artifacts = json.loads(row.artifacts_json)
            except (json.JSONDecodeError, ValueError):
                artifacts = []

        # Find matching entry and flip produced flag.
        found = False
        for entry in artifacts:
            if entry.get("path") == artifact_path:
                entry["produced"] = True
                found = True
                break

        if not found:
            # Append an implicit entry so the ledger can reference it.
            artifacts.append({"path": artifact_path, "kind": "file", "produced": True})

        row.artifacts_json = json.dumps(artifacts, ensure_ascii=False)
        await db.commit()

    logger.debug(
        "artifact produced: mission=%s phase=%s path=%s",
        mission_id, phase_id, artifact_path,
    )
