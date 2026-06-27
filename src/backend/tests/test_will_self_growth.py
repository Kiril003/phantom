"""Will Engine — identity grows from deeds (unification map step 3)."""
import pytest

from agent.will.self_growth import (
    compose_self_reflection,
    grow_identity_from_journal,
    _select_deeds,
)
from agent.cognition.will.identity import IdentitySystem


def _entry(action, outcome, text):
    return {"action": action, "outcome": outcome,
            "decision": {"action_text": text}}


def test_select_deeds_keeps_only_defining_entries():
    entries = [
        _entry("start_task", "dispatched", "ship the report"),
        _entry("noop", "noop", ""),
        _entry("start_task", "vetoed_by_values:Прозорість", "hide logs"),
        _entry("standing_order", "budget_exhausted", "x"),
    ]
    kept = _select_deeds(entries)
    outcomes = [e["outcome"] for e in kept]
    assert "dispatched" in outcomes
    assert any(o.startswith("vetoed_by_values") for o in outcomes)
    assert "noop" not in outcomes
    assert "budget_exhausted" not in outcomes


@pytest.mark.asyncio
async def test_compose_reflection_returns_first_person_line():
    async def fake_llm(prompt, system):
        assert "ship the report" in prompt
        return '"Я істота, що доводить почате до кінця."'

    line = await compose_self_reflection(
        [_entry("start_task", "dispatched", "ship the report")],
        dispatch_llm=fake_llm)
    assert line == "Я істота, що доводить почате до кінця."


@pytest.mark.asyncio
async def test_compose_reflection_empty_when_no_deeds():
    async def fake_llm(prompt, system):
        raise AssertionError("LLM must not be called with no deeds")
    assert await compose_self_reflection([], dispatch_llm=fake_llm) == ""


class _FakeJournal:
    def __init__(self, entries):
        self._entries = entries
    async def recent(self, db, user_id, n=30):
        return self._entries


@pytest.mark.asyncio
async def test_grow_identity_appends_moment(tmp_path):
    narrative = tmp_path / "self_narrative.md"
    narrative.write_text("# Хто я\nЯ PHANTOM.\n", encoding="utf-8")
    identity = IdentitySystem(narrative_path=str(narrative))

    entries = [
        _entry("start_task", "dispatched", "ship the report"),
        _entry("start_task", "dispatched", "back up the vault"),
        _entry("start_task", "vetoed_by_values:Прозорість", "hide logs"),
    ]

    async def fake_llm(prompt, system):
        return "Я дію рішуче, але не зраджую прозорість."

    grew = await grow_identity_from_journal(
        None, "u1", dispatch_llm=fake_llm,
        journal=_FakeJournal(entries), identity=identity)

    assert grew == "Я дію рішуче, але не зраджую прозорість."
    assert grew in narrative.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_grow_identity_skips_when_too_few_deeds(tmp_path):
    narrative = tmp_path / "self_narrative.md"
    narrative.write_text("base", encoding="utf-8")
    identity = IdentitySystem(narrative_path=str(narrative))

    async def fake_llm(prompt, system):
        raise AssertionError("must not call LLM below min_deeds")

    grew = await grow_identity_from_journal(
        None, "u1", dispatch_llm=fake_llm,
        journal=_FakeJournal([_entry("start_task", "dispatched", "one thing")]),
        identity=identity, min_deeds=3)
    assert grew is None
    assert narrative.read_text(encoding="utf-8") == "base"
