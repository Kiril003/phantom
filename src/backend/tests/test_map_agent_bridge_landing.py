"""`docs/design/chat-teardown.md` §7 / `docs/design/tools-audit.md` §8d.

The audit's claim was that `add_marker` / `route` / `snapshot` /
`open_map` compute a correct result server-side and then only surface a
toast — the map state never actually changes. Tracing `map.add_marker`
turned up something worse: it never even reached that point. Every real
call raised inside its own `try/except` because
``from db.database import async_session`` imports a name that does not
exist (`db.database` only exports ``AsyncSessionLocal``) — so
`map.add_marker` returned ``ok=False, reason="db_error"`` on every single
invocation. The two pre-existing tests for this action
(`test_add_marker_rejects_unknown_category`,
`test_add_marker_rejects_missing_owner`) both short-circuit before that
import ever runs, so the bug shipped invisibly.

This file proves the fixed happy path end to end: the action returns
`ok=True` AND the row is actually readable back from the database
afterwards — not just that `execute()` didn't raise.
"""
from __future__ import annotations

import pytest

from agent.actions.base import ActionContext
from agent.actions.map import MAP_ACTIONS, MapAddMarker


def _ctx() -> ActionContext:
    return ActionContext(task_id="t-landing", step_idx=0, workspace_dir="/tmp")


@pytest.mark.asyncio
async def test_add_marker_persists_a_readable_row(auth_root_user):
    """This is the test that fails on the pre-fix `async_session` import.

    Before the fix: `MapAddMarker.execute` catches the ImportError inside
    its broad `except Exception`, returns `ok=False,
    output.reason="db_error"`, and no `MapPOI` row is ever created —
    `assert res.ok is True` below fails immediately.
    """
    res = await MapAddMarker(
        lat=50.4501,
        lon=30.5234,
        name="Спостережний пункт",
        category="intel",
        icon="👁",
        user_id=auth_root_user.id,
    ).execute(_ctx())

    assert res.ok is True, res.output
    assert res.output["map_mutation"]["op"] == "add_marker"
    marker_id = res.output["extras"]["marker_id"]
    assert marker_id

    # The resulting *state*, not just a truthy return value: read the row
    # back through a fresh session, the same way a later `map.query_nearby`
    # or the HTTP `/map/pois` endpoint would.
    from db.database import AsyncSessionLocal
    from db.models import MapPOI
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        row = (
            await db.execute(select(MapPOI).where(MapPOI.id == marker_id))
        ).scalar_one_or_none()

    assert row is not None, "marker was reported ok=True but never persisted"
    assert row.name == "Спостережний пункт"
    assert row.category == "intel"
    assert row.lat == pytest.approx(50.4501)
    assert row.lon == pytest.approx(30.5234)
    assert row.user_id == auth_root_user.id


@pytest.mark.asyncio
async def test_add_marker_broadcasts_the_same_coordinates_it_persisted(auth_root_user, monkeypatch):
    """The WS mutation the frontend bridge consumes must describe the row
    that actually landed in the DB — not a stale/partial echo of the
    request. Captures the broadcast instead of needing a live hub."""
    captured: list[dict] = []

    async def _fake_broadcast(mutation, *, narrative="", user_id=None):
        captured.append({"op": mutation.op, "payload": mutation.payload, "user_id": user_id})

    monkeypatch.setattr(
        "agent.actions.map.add_marker.broadcast_map_mutation", _fake_broadcast,
    )

    res = await MapAddMarker(
        lat=49.0, lon=31.0, name="Точка", user_id=auth_root_user.id,
    ).execute(_ctx())

    assert res.ok is True
    assert len(captured) == 1
    assert captured[0]["op"] == "add_marker"
    assert captured[0]["payload"]["lat"] == 49.0
    assert captured[0]["payload"]["lon"] == 31.0
    assert captured[0]["payload"]["name"] == "Точка"
    assert captured[0]["user_id"] == auth_root_user.id


def test_add_marker_still_registered_after_the_import_fix():
    """Regression guard: the fix touched the DB import, not the registry
    wiring — `map.add_marker` must still be one of the catalog verbs."""
    assert MapAddMarker in MAP_ACTIONS
    assert MapAddMarker.name == "map.add_marker"
