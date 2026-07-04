"""ПОЛІС population — reputation from real outcomes, persistence, census."""
from __future__ import annotations

import pytest

from agent.fabric.citizens import CitizenRep, Population


@pytest.fixture
async def pop():
    from db.database import init_db
    await init_db()
    p = Population()
    await p.load()
    yield p
    from db.database import get_session
    from db.models import PolisCitizenRow
    from sqlalchemy import delete
    async with get_session() as db:
        await db.execute(delete(PolisCitizenRow))
        await db.commit()


def test_reliability_math():
    rep = CitizenRep(role="x", successes=9, failures=1, revisions=0)
    assert rep.reliability > 0.85
    assert rep.tier == "майстер"
    flaky = CitizenRep(role="y", successes=5, failures=5, revisions=8)
    assert flaky.reliability < rep.reliability
    assert CitizenRep(role="z").tier == "новачок"


def test_revision_drag_lowers_reliability():
    clean = CitizenRep(role="a", successes=8, failures=2)
    churny = CitizenRep(role="b", successes=8, failures=2, revisions=10)
    assert churny.reliability < clean.reliability


@pytest.mark.asyncio
async def test_record_accumulates_and_persists(pop):
    await pop.record("senior_backend", ok=True, domain="dev", attempts=1,
                     tokens=1200, title="Ядро auth")
    await pop.record("senior_backend", ok=True, domain="dev", attempts=2,
                     tokens=800, title="Ядро sessions")
    await pop.record("senior_backend", ok=False, domain="dev", attempts=2,
                     tokens=100, title="Кеш")
    d = pop.dossier("senior_backend")
    assert d["successes"] == 2 and d["failures"] == 1
    assert d["revisions"] == 2  # (2-1)+(2-1) from the two multi-attempt nodes
    assert d["tokens_produced"] == 2100
    assert d["top_domain"] == "dev"
    assert "Ядро auth" in d["recent_titles"]

    # survives a fresh Population (reboot)
    fresh = Population()
    await fresh.load()
    assert fresh.dossier("senior_backend")["successes"] == 2


@pytest.mark.asyncio
async def test_dossier_enriches_from_specialist_catalog(pop):
    d = pop.dossier("senior_architect")
    assert "department" in d and d["description"]


@pytest.mark.asyncio
async def test_census_ranks_by_reliability(pop):
    for _ in range(5):
        await pop.record("designer", ok=True, domain="game", attempts=1,
                         tokens=500, title="асет")
    await pop.record("pen_tester", ok=False, domain="dev", attempts=2,
                     tokens=50, title="скан")
    census = pop.census()
    roles = [c["role"] for c in census]
    assert roles.index("designer") < roles.index("pen_tester")
    assert any(c["tier"] == "майстер" for c in census if c["role"] == "designer")


@pytest.mark.asyncio
async def test_reliability_of_lookup(pop):
    await pop.record("osint", ok=True, domain="research", attempts=1,
                     tokens=300, title="джерела")
    await pop.record("osint", ok=True, domain="research", attempts=1,
                     tokens=300, title="джерела2")
    await pop.record("osint", ok=True, domain="research", attempts=1,
                     tokens=300, title="джерела3")
    assert pop.reliability_of("osint") > 0.9
    assert pop.reliability_of("nobody") == 0.0
