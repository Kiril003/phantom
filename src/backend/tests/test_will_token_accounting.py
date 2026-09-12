"""The token half of the will's budget.

Budget.ok (agent/will/types.py:51) is `calls_used < calls_cap AND
tokens_used < tokens_cap`, so the token clause is a live gate — not dead code.
Every production caller of note_spend passed the literal 0, so the clause read
0 < 300_000 forever and could never fire, the decide prompt always told the
model it had the full 300k left, and GET .../engine always reported 0 spent.
"""
import importlib
import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "t")
os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def db_factory():
    import db.database as dbm
    import db.models as dm  # noqa: F401
    if not dbm.Base.metadata.tables:
        importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
    factory = async_sessionmaker(eng, expire_on_commit=False)
    from db.models import User
    async with factory() as s:
        s.add(User(id="u1", username="u1"))
        await s.commit()
    yield factory
    await eng.dispose()
    os.unlink(tmp)


@pytest.mark.asyncio
async def test_real_token_count_reaches_the_ledger(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from agent.will.budget import BudgetGovernor
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)

    async with db_factory() as db:
        await goals.seed(db, "u1", "ціль", 6)
        await db.commit()

    eng = WillEngine()

    async def metered_llm(prompt, system):
        # The shape _default_dispatch_llm now returns: text + what the provider
        # actually reported in AIResponse.tokens_used.
        return ('{"kind":"noop","goal_id":null,"action_text":"","rationale":"r"}', 137)

    eng.dispatch_llm = metered_llm

    async with db_factory() as db:
        await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    async with db_factory() as db:
        budget = await BudgetGovernor().remaining(db, "u1")
    assert budget.tokens_used == 137, "the provider's count never reached the ledger"
    assert budget.calls_used == 1


@pytest.mark.asyncio
async def test_token_cap_can_actually_exhaust_the_budget(db_factory, monkeypatch):
    """With tokens wired to 0 this was unreachable: the conjunct in Budget.ok
    could never be false no matter how much the will spent."""
    from agent.will.engine import WillEngine
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    monkeypatch.setattr(config, "will_daily_token_cap", 500, raising=False)
    monkeypatch.setattr(config, "will_daily_llm_calls", 10_000, raising=False)

    async with db_factory() as db:
        await goals.seed(db, "u1", "ціль", 6)
        await db.commit()

    eng = WillEngine()

    async def fat_llm(prompt, system):
        return ('{"kind":"noop","goal_id":null,"action_text":"","rationale":"r"}', 400)

    eng.dispatch_llm = fat_llm

    async with db_factory() as db:
        first = await eng.run_once(db, "u1", snapshot={})
        await db.commit()
    assert first.note == "noop"

    async with db_factory() as db:
        second = await eng.run_once(db, "u1", snapshot={})
        await db.commit()
    assert second.note == "noop"

    async with db_factory() as db:
        third = await eng.run_once(db, "u1", snapshot={})
        await db.commit()
    assert third.note == "budget_exhausted", "the token cap still cannot bind"


@pytest.mark.asyncio
async def test_a_helper_that_made_no_call_is_not_billed(db_factory, monkeypatch):
    """decide_next returns noop WITHOUT calling the LLM when there are no goals
    (decide.py:56-57), yet the engine charged calls=1 unconditionally."""
    from agent.will.engine import WillEngine
    from agent.will.budget import BudgetGovernor
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)

    eng = WillEngine()
    called = {"n": 0}

    async def counting_llm(prompt, system):
        called["n"] += 1
        return ("[]", 50)

    eng.dispatch_llm = counting_llm

    async with db_factory() as db:  # no goals seeded at all
        await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    async with db_factory() as db:
        budget = await BudgetGovernor().remaining(db, "u1")
    assert called["n"] == 0
    assert budget.calls_used == 0, "billed a call the will never made"
    assert budget.tokens_used == 0


@pytest.mark.asyncio
async def test_a_stub_returning_bare_text_bills_zero(db_factory, monkeypatch):
    """Back-compat: the four planning helpers are typed (prompt, system) -> str.
    A caller or test that supplies a plain string made no provider call and must
    bill no tokens — never a guessed number."""
    from agent.will.engine import WillEngine
    from agent.will.budget import BudgetGovernor
    from agent.will import goals
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)

    async with db_factory() as db:
        await goals.seed(db, "u1", "ціль", 6)
        await db.commit()

    eng = WillEngine()

    async def bare_llm(prompt, system):
        return '{"kind":"noop","goal_id":null,"action_text":"","rationale":"r"}'

    eng.dispatch_llm = bare_llm

    async with db_factory() as db:
        await eng.run_once(db, "u1", snapshot={})
        await db.commit()

    async with db_factory() as db:
        budget = await BudgetGovernor().remaining(db, "u1")
    assert budget.calls_used == 1
    assert budget.tokens_used == 0


def test_default_dispatch_llm_keeps_the_provider_count():
    """The seam itself: _default_dispatch_llm must hand back what
    AIResponse.tokens_used carried, not drop it."""
    import asyncio
    from agent.will import engine as eng_mod

    class _Resp:
        content = "привіт"
        tokens_used = 4242

    class _Hub:
        async def dispatch(self, *a, **kw):
            return _Resp()

    import ai.hub as hub_mod
    real = hub_mod.ai_hub
    hub_mod.ai_hub = _Hub()
    try:
        text, tokens = asyncio.run(eng_mod._default_dispatch_llm("p", "s"))
    finally:
        hub_mod.ai_hub = real
    assert text == "привіт"
    assert tokens == 4242
