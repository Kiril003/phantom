"""T4 — register_synth: dynamic import + ActionRegistry insertion + lesson write.

Validates:
  - Happy path: source with a valid Action subclass → name returned, registry updated.
  - Failure: source that defines NO Action subclass → ImportError, registry unchanged.
  - Failure: name collision with existing production action → ValueError, unchanged.
  - Synth file persisted to _synth/<slug>.py on success.
  - record_synth_lesson writes success/failure lesson (stubbed write_lesson).
"""
from __future__ import annotations

import sys
import textwrap
from pathlib import Path
from typing import Type

import pytest

from agent.actions.registry import ActionRegistry
from agent.actions._synth.synthesizer import register_synth, record_synth_lesson


_VALID_SOURCE = textwrap.dedent("""\
    from typing import ClassVar
    import time
    from pydantic import Field
    from agent.schemas import ActionResult, RiskLevel
    from agent.actions.base import Action, ActionContext

    class SynthTestReg(Action):
        name: ClassVar[str] = "synth.test_reg_{uid}"
        risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
        val: str = Field(default="")

        async def execute(self, ctx: ActionContext) -> ActionResult:
            return ActionResult(ok=True, output={{"val": self.val}}, elapsed_ms=0)
""")


_NO_ACTION_SOURCE = textwrap.dedent("""\
    class NotAnAction:
        pass
""")


def _make_source(uid: str) -> str:
    return _VALID_SOURCE.replace("{uid}", uid)


def _fresh_registry() -> ActionRegistry:
    """Return a new registry instance (not the global singleton)."""
    return ActionRegistry()


# ── Happy path ────────────────────────────────────────────────────────────────


def test_register_synth_success(tmp_path, monkeypatch):
    # Redirect _SYNTH_DIR so files land in tmp_path, not the real package.
    import agent.actions._synth.synthesizer as synth_mod
    monkeypatch.setattr(synth_mod, "_SYNTH_DIR", tmp_path)

    uid = "001"
    source = _make_source(uid)
    registry = _fresh_registry()

    name = register_synth(f"test_reg_{uid}", source, registry)

    assert name == f"synth.test_reg_{uid}"
    assert registry.get(name) is not None
    assert (tmp_path / f"test_reg_{uid}.py").exists()

    # Clean up sys.modules to avoid cross-test pollution
    sys.modules.pop(f"agent.actions._synth.test_reg_{uid}", None)


def test_register_synth_action_is_callable(tmp_path, monkeypatch):
    import agent.actions._synth.synthesizer as synth_mod
    monkeypatch.setattr(synth_mod, "_SYNTH_DIR", tmp_path)

    uid = "002"
    source = _make_source(uid)
    registry = _fresh_registry()

    name = register_synth(f"test_reg_{uid}", source, registry)
    cls = registry.get(name)
    assert cls is not None
    # Must be constructible with defaults.
    instance = cls()
    assert instance.name == name

    sys.modules.pop(f"agent.actions._synth.test_reg_{uid}", None)


# ── Failure: no Action subclass ───────────────────────────────────────────────


def test_register_synth_no_action_class_raises(tmp_path, monkeypatch):
    import agent.actions._synth.synthesizer as synth_mod
    monkeypatch.setattr(synth_mod, "_SYNTH_DIR", tmp_path)

    registry = _fresh_registry()
    before = set(registry.names())

    with pytest.raises(ImportError, match="no Action subclass"):
        register_synth("bad_slug", _NO_ACTION_SOURCE, registry)

    # Registry unchanged
    assert set(registry.names()) == before

    sys.modules.pop("agent.actions._synth.bad_slug", None)


# ── Failure: name collision ────────────────────────────────────────────────────


def test_register_synth_collision_raises(tmp_path, monkeypatch):
    import agent.actions._synth.synthesizer as synth_mod
    monkeypatch.setattr(synth_mod, "_SYNTH_DIR", tmp_path)

    uid = "003"
    source = _make_source(uid)
    registry = _fresh_registry()

    # Register once successfully.
    name = register_synth(f"test_reg_{uid}", source, registry)
    sys.modules.pop(f"agent.actions._synth.test_reg_{uid}", None)

    # A DIFFERENT class claiming the same name should be rejected.
    source2 = textwrap.dedent(f"""\
        from typing import ClassVar
        from agent.schemas import ActionResult, RiskLevel
        from agent.actions.base import Action, ActionContext

        class SynthTestReg003Dup(Action):
            name: ClassVar[str] = "synth.test_reg_{uid}"
            risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

            async def execute(self, ctx: ActionContext) -> ActionResult:
                return ActionResult(ok=True, elapsed_ms=0)
    """)

    with pytest.raises(ValueError, match="already registered"):
        register_synth(f"test_reg_{uid}_dup", source2, registry)

    sys.modules.pop(f"agent.actions._synth.test_reg_{uid}_dup", None)


# ── record_synth_lesson ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_record_lesson_success_calls_write_lesson(monkeypatch):
    written: list[dict] = []

    async def _stub_write(**kwargs):
        written.append(kwargs)
        return "lesson_id"

    import agent.cognition.memory.lessons as lesson_mod
    monkeypatch.setattr(lesson_mod, "write_lesson", _stub_write)

    await record_synth_lesson(
        task_id="task_abc",
        goal_class="parse CSV files",
        action_name="synth.csv_parser",
        success=True,
    )

    assert len(written) == 1
    w = written[0]
    assert w["outcome"] == "synth_success"
    assert "synth.csv_parser" in w["lesson"]["what_worked"]
    assert w["lesson"]["what_avoid"] == ""


@pytest.mark.asyncio
async def test_record_lesson_failure_calls_write_lesson(monkeypatch):
    written: list[dict] = []

    async def _stub_write(**kwargs):
        written.append(kwargs)
        return "lesson_id"

    import agent.cognition.memory.lessons as lesson_mod
    monkeypatch.setattr(lesson_mod, "write_lesson", _stub_write)

    await record_synth_lesson(
        task_id="task_xyz",
        goal_class="download large file",
        action_name="synth.downloader",
        success=False,
        failure_reason="smoke_test rc=1 ImportError",
    )

    assert len(written) == 1
    w = written[0]
    assert w["outcome"] == "synth_failure"
    assert "synth_failure" in w["outcome"]
    assert "smoke_test rc=1" in w["lesson"]["what_avoid"]
    assert w["lesson"]["what_worked"] == ""


@pytest.mark.asyncio
async def test_record_lesson_survives_write_exception(monkeypatch):
    """Lesson write failure must be non-fatal — no exception propagates."""
    async def _stub_raise(**kwargs):
        raise RuntimeError("chroma down")

    import agent.cognition.memory.lessons as lesson_mod
    monkeypatch.setattr(lesson_mod, "write_lesson", _stub_raise)

    # Must not raise
    await record_synth_lesson(
        task_id="t1",
        goal_class="something",
        action_name="synth.x",
        success=True,
    )
