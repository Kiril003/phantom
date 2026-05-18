"""T2 — draft-prompt builder + draft_action_source with stubbed generate_raw."""
import asyncio
import textwrap

import pytest

from agent.actions._synth.synthesizer import (
    SynthCounter,
    _slugify,
    build_draft_prompt,
    draft_action_source,
)


def test_slugify_basic():
    assert _slugify("Read Files from Disk") == "read_files_from_disk"


def test_slugify_strips_specials():
    slug = _slugify("http GET + JSON parser!")
    assert slug.isidentifier() or all(c in "abcdefghijklmnopqrstuvwxyz0123456789_" for c in slug)


def test_slugify_max_length():
    assert len(_slugify("x" * 200)) <= 40


def test_build_draft_prompt_contains_abc():
    system, user = build_draft_prompt("need a file reader", "read_file")
    assert "Action" in system
    assert "Action" in user
    assert "read_file" in user
    assert "need a file reader" in user


def test_build_draft_prompt_no_model_call():
    # purely synchronous — should never block
    system, user = build_draft_prompt("count words in text", "word_counter")
    assert "synth.word_counter" in user or "word_counter" in user


# ── draft_action_source with injected stub ─────────────────────────────────


_VALID_SOURCE = textwrap.dedent("""\
    from typing import ClassVar
    import time
    from pydantic import Field
    from agent.schemas import ActionResult, RiskLevel
    from agent.actions.base import Action, ActionContext

    class SynthWordCounter(Action):
        name: ClassVar[str] = "synth.word_counter"
        risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
        text: str = Field(default="")

        async def execute(self, ctx: ActionContext) -> ActionResult:
            t0 = time.monotonic()
            count = len(self.text.split())
            return ActionResult(ok=True, output={"count": count},
                                elapsed_ms=int((time.monotonic() - t0) * 1000))
""")


async def _stub_generate(**kwargs) -> str:
    return _VALID_SOURCE


@pytest.mark.asyncio
async def test_draft_action_source_stub_happy_path():
    source = await draft_action_source(
        "count words in a string", "word_counter",
        generate_raw_fn=_stub_generate,
    )
    assert "class Synth" in source or "Action" in source
    assert "def execute" in source


@pytest.mark.asyncio
async def test_draft_action_source_strips_fences():
    async def _stub_fenced(**kwargs) -> str:
        return f"```python\n{_VALID_SOURCE}\n```"

    source = await draft_action_source(
        "count words", "wc",
        generate_raw_fn=_stub_fenced,
    )
    assert not source.startswith("```")


# ── SynthCounter ──────────────────────────────────────────────────────────────


def test_synth_counter_default_cap(monkeypatch):
    from config import config
    monkeypatch.setattr(config, "agent_synth_max_per_task", 3)
    c = SynthCounter()
    assert not c.cap_reached()
    c.increment(); c.increment(); c.increment()
    assert c.cap_reached()


def test_synth_counter_zero_cap_unbound(monkeypatch):
    from config import config
    monkeypatch.setattr(config, "agent_synth_max_per_task", 0)
    c = SynthCounter()
    for _ in range(1000):
        c.increment()
    assert not c.cap_reached()


def test_synth_counter_from_ctx_idempotent():
    extras: dict = {}
    c1 = SynthCounter.from_ctx(extras)
    c2 = SynthCounter.from_ctx(extras)
    assert c1 is c2
