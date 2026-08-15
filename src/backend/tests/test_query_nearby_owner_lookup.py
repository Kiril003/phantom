"""map.query_nearby — owner's saved POIs must actually come back.

Same bug as `map.add_marker` (see `test_map_agent_bridge_landing.py`):
``from db.database import async_session`` imports a name `db.database`
does not export. Here it's inside a nested `try/except Exception:
pois = []`, so the failure mode is worse than a loud error — it's the
"429 → []" class this codebase's own memory notes warn about
(`phantom-os silent audit gaps` / tools-audit.md §4b): a real DB error
silently reads back as "nothing is nearby", indistinguishable from an
operator who genuinely has no saved POIs there.

Fixed by importing the real name, `AsyncSessionLocal`.
"""
from __future__ import annotations

import uuid

import pytest

from agent.actions.base import ActionContext
from agent.actions.map import MapQueryNearby


def _ctx() -> ActionContext:
    return ActionContext(task_id="t-nearby", step_idx=0, workspace_dir="/tmp")


@pytest.mark.asyncio
async def test_query_nearby_returns_the_owners_saved_poi_instead_of_silent_empty(auth_root_user):
    """Fails on the pre-fix `async_session` import: the ImportError was
    swallowed by `except Exception: pois = []`, so a real saved POI 50m
    from the query point silently never came back."""
    from db.database import AsyncSessionLocal
    from db.models import MapPOI

    async with AsyncSessionLocal() as db:
        db.add(MapPOI(
            id=str(uuid.uuid4()),
            user_id=auth_root_user.id,
            lat=50.4502,
            lon=30.5235,
            name="Схованка",
            category="saved",
            notes="",
        ))
        await db.commit()

    res = await MapQueryNearby(
        lat=50.4501, lon=30.5234, radius_m=200, user_id=auth_root_user.id,
    ).execute(_ctx())

    assert res.ok is True
    pois_artifact = next(a for a in res.output["artifacts"] if a["label"] == "pois")
    names = {row["name"] for row in pois_artifact["payload"]["items"]}
    assert "Схованка" in names, (
        "the owner's saved POI exists in the DB but query_nearby "
        f"returned {pois_artifact['payload']['items']!r} — the DB read silently failed again"
    )
