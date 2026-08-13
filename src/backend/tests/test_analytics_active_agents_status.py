"""`Активних агентів` must count the statuses the writers actually emit.

The filter read ``["RUNNING", "SCHEDULED", "PENDING"]``. Every writer emits
lowercase, `agent_tasks.status` is a plain String(24) under SQLite's binary
collation, and two of those three names are not in the vocabulary at all — so
the tile could only ever render 0, for every tenant, forever.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import func, select

from db.database import get_session
from db.models import AgentTask, Tenant, User
from main import app
from security.jwt_manager import create_token

# agent/schemas.py :: TaskStatus — the whole vocabulary, nothing invented.
ALL_STATUSES = (
    "planning",
    "running",
    "paused",
    "awaiting_user",
    "blocked_quota",
    "done",
    "failed",
    "stopped",
    "timeout",
)

EXPECTED_ACTIVE = {"planning", "running", "awaiting_user", "blocked_quota"}


@pytest.fixture
async def tenant_with_one_task_per_status():
    async with get_session() as db:
        tenant = Tenant(name=f"analytics-{uuid.uuid4().hex[:8]}")
        db.add(tenant)
        await db.flush()

        user = User(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            username="analytics_" + uuid.uuid4().hex[:8],
            role="ROOT",
        )
        db.add(user)
        await db.flush()

        for status in ALL_STATUSES:
            db.add(AgentTask(
                id=str(uuid.uuid4()),
                user_id=user.id,
                goal=f"goal for {status}",
                status=status,
            ))
        await db.commit()
        return {"user_id": user.id, "username": user.username}


@pytest.fixture
async def client():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.mark.asyncio
async def test_uppercase_filter_can_never_match_a_written_row(
    tenant_with_one_task_per_status,
):
    """The premise, proven against the real engine before anything is changed.

    `status` has no COLLATE NOCASE, so the binary comparison the old filter
    performed cannot match a lowercase row no matter how many exist.
    """
    user_id = tenant_with_one_task_per_status["user_id"]

    async with get_session() as db:
        upper = (await db.execute(
            select(func.count(AgentTask.id)).where(
                AgentTask.user_id == user_id,
                AgentTask.status.in_(["RUNNING", "SCHEDULED", "PENDING"]),
            )
        )).scalar()
        lower = (await db.execute(
            select(func.count(AgentTask.id)).where(
                AgentTask.user_id == user_id,
                AgentTask.status.in_(["running"]),
            )
        )).scalar()

    assert lower == 1, "the fixture did write a lowercase `running` row"
    assert upper == 0, (
        "an uppercase status filter matched something — the premise of this "
        "fix is wrong and the diagnosis needs redoing"
    )


@pytest.mark.asyncio
async def test_overview_counts_every_live_agent(
    tenant_with_one_task_per_status, client
):
    data = tenant_with_one_task_per_status
    token, _ = create_token(data["user_id"], data["username"], "ROOT")
    client.headers.update({"Authorization": f"Bearer {token}"})

    resp = await client.get("/api/v1/analytics/overview")
    assert resp.status_code == 200, resp.text

    assert resp.json()["active_agents"] == len(EXPECTED_ACTIVE), (
        "the tile must count planning/running/awaiting_user/blocked_quota — "
        f"got {resp.json()['active_agents']}"
    )


@pytest.mark.asyncio
async def test_overview_excludes_parked_and_terminal_tasks(
    tenant_with_one_task_per_status, client
):
    """Counting `paused` or a finished task would be the mirror-image lie."""
    data = tenant_with_one_task_per_status
    token, _ = create_token(data["user_id"], data["username"], "ROOT")
    client.headers.update({"Authorization": f"Bearer {token}"})

    resp = await client.get("/api/v1/analytics/overview")
    assert resp.status_code == 200, resp.text

    excluded = set(ALL_STATUSES) - EXPECTED_ACTIVE
    assert resp.json()["active_agents"] == len(ALL_STATUSES) - len(excluded)


def test_active_statuses_are_a_subset_of_the_vocabulary():
    """Guards the class of bug that started this: a filter naming a status
    that does not exist reads as a working filter and matches nothing."""
    from api.routes_analytics import ACTIVE_AGENT_STATUSES

    unknown = set(ACTIVE_AGENT_STATUSES) - set(ALL_STATUSES)
    assert not unknown, f"filter names statuses no writer emits: {sorted(unknown)}"
    assert set(ACTIVE_AGENT_STATUSES) == EXPECTED_ACTIVE
