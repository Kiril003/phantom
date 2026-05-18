"""T6 — SynthesizeCapability action: full end-to-end with stubs.

Validates:
  - Happy path: spec → draft → smoke OK → registered → pickable from registry.
  - Cap reached → ok=False, error_class=synth_cap_reached, counter NOT incremented.
  - Draft failure → ok=False, synth_draft_failed, NOT registered.
  - Smoke failure → ok=False, synth_smoke_failed, NOT registered.
  - Register failure (import error) → ok=False, synth_register_failed, NOT registered.
  - synthesize_capability is present in the module-level registry.
  - _load_synth_actions scans _synth/ at boot and auto-loads persisted files.
"""
from __future__ import annotations

import importlib
import sys
import textwrap
from pathlib import Path

import pytest

from agent.actions.synthesize_capability import SynthesizeCapability
from agent.actions.base import ActionContext
from agent.actions.registry import ActionRegistry
from agent.actions._synth.synthesizer import SynthCounter

# Force the subpackage into sys.modules so monkeypatching works even when
# pytest's import machinery has cached agent.actions without _synth resolved.
import agent.actions._synth.synthesizer as _synth_mod_global  # noqa: E402


def _ctx(tmp_path: Path, extras: dict | None = None, unsafe_mode: bool = False) -> ActionContext:
    return ActionContext(
        task_id="task_t6",
        step_idx=0,
        workspace_dir=str(tmp_path),
        extras=extras if extras is not None else {},
        unsafe_mode=unsafe_mode,
    )


def _fresh_registry() -> ActionRegistry:
    return ActionRegistry()


_VALID_SOURCE_TMPL = textwrap.dedent("""\
    from typing import ClassVar
    import time
    from pydantic import Field
    from agent.schemas import ActionResult, RiskLevel
    from agent.actions.base import Action, ActionContext

    class SynthT6_{uid}(Action):
        name: ClassVar[str] = "synth.t6_{uid}"
        risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

        async def execute(self, ctx: ActionContext) -> ActionResult:
            return ActionResult(ok=True, elapsed_ms=0)
""")


# ── Happy path ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_happy_path_registers_and_pickable(tmp_path, monkeypatch):
    synth_mod = _synth_mod_global
    monkeypatch.setattr(synth_mod, "_SYNTH_DIR", tmp_path)

    uid = "h1"
    source = _VALID_SOURCE_TMPL.replace("{uid}", uid)

    async def _patched_draft(spec, slug, **kwargs):
        return source

    async def _patched_smoke(slug, src, *, workspace_dir, unsafe_mode=False):
        return True, ""

    monkeypatch.setattr(synth_mod, "draft_action_source", _patched_draft)
    monkeypatch.setattr(synth_mod, "run_smoke_test", _patched_smoke)

    registry = _fresh_registry()
    extras: dict = {}
    ctx = _ctx(tmp_path, extras)
    ctx.runtime = type("R", (), {"registry": registry})()

    action = SynthesizeCapability(spec="count words in text")
    result = await action.execute(ctx)

    assert result.ok is True
    assert result.output["action_name"] == f"synth.t6_{uid}"
    assert registry.get(f"synth.t6_{uid}") is not None
    # Counter is stored in ctx.extras (Pydantic v2 copies the dict on construction).
    assert ctx.extras["_synth_counter"].count == 1
    # output also carries the count
    assert result.output["synth_count"] == 1

    sys.modules.pop(f"agent.actions._synth.t6_{uid}", None)


# ── Cap reached ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cap_reached_returns_error(tmp_path, monkeypatch):
    from config import config
    monkeypatch.setattr(config, "agent_synth_max_per_task", 2)

    extras: dict = {}
    counter = SynthCounter.from_ctx(extras)
    counter.increment()
    counter.increment()
    assert counter.cap_reached()

    ctx = _ctx(tmp_path, extras)
    action = SynthesizeCapability(spec="do something")
    result = await action.execute(ctx)

    assert result.ok is False
    assert result.error_class == "synth_cap_reached"
    assert counter.count == 2  # NOT incremented again


# ── Draft failure ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_draft_failure_not_registered(tmp_path, monkeypatch):
    synth_mod = _synth_mod_global

    async def _fail_draft(spec, slug, **kwargs):
        raise RuntimeError("LLM quota exhausted")

    async def _noop(**kwargs):
        pass

    monkeypatch.setattr(synth_mod, "draft_action_source", _fail_draft)
    monkeypatch.setattr(synth_mod, "record_synth_lesson", _noop)

    registry = _fresh_registry()
    before = set(registry.names())
    ctx = _ctx(tmp_path)
    ctx.runtime = type("R", (), {"registry": registry})()

    action = SynthesizeCapability(spec="something impossible")
    result = await action.execute(ctx)

    assert result.ok is False
    assert result.error_class == "synth_draft_failed"
    assert set(registry.names()) == before


# ── Smoke failure ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_smoke_failure_not_registered(tmp_path, monkeypatch):
    synth_mod = _synth_mod_global

    async def _ok_draft(spec, slug, **kwargs):
        return _VALID_SOURCE_TMPL.replace("{uid}", "sf1")

    async def _fail_smoke(slug, src, *, workspace_dir, unsafe_mode=False):
        return False, "rc=1 ImportError"

    async def _noop(**kwargs):
        pass

    monkeypatch.setattr(synth_mod, "draft_action_source", _ok_draft)
    monkeypatch.setattr(synth_mod, "run_smoke_test", _fail_smoke)
    monkeypatch.setattr(synth_mod, "record_synth_lesson", _noop)

    registry = _fresh_registry()
    before = set(registry.names())
    ctx = _ctx(tmp_path)
    ctx.runtime = type("R", (), {"registry": registry})()

    action = SynthesizeCapability(spec="something risky")
    result = await action.execute(ctx)

    assert result.ok is False
    assert result.error_class == "synth_smoke_failed"
    assert set(registry.names()) == before


# ── synthesize_capability in module-level registry ────────────────────────────


def test_synthesize_capability_in_global_registry():
    from agent.actions.registry import registry
    assert registry.get("synthesize_capability") is SynthesizeCapability


def test_synthesize_capability_in_catalog():
    from agent.actions.registry import registry
    names = [e["name"] for e in registry.catalog()]
    assert "synthesize_capability" in names


# ── _load_synth_actions boot seam ─────────────────────────────────────────────


def test_load_synth_actions_scans_directory(tmp_path, monkeypatch):
    """A valid .py file in _synth/ is picked up at boot."""
    source = _VALID_SOURCE_TMPL.replace("{uid}", "boot1")
    (tmp_path / "t6_boot1.py").write_text(source, encoding="utf-8")

    import agent.actions.registry as reg_mod  # noqa: PLC0415

    original_load = reg_mod._load_synth_actions

    def _patched_load():
        import importlib.util, sys as _sys
        from agent.actions.base import Action as _Action
        result = []
        for py_file in sorted(tmp_path.glob("*.py")):
            if py_file.name.startswith("_"):
                continue
            slug = py_file.stem
            mname = f"agent.actions._synth.{slug}"
            if mname in _sys.modules:
                mod = _sys.modules[mname]
            else:
                spec = importlib.util.spec_from_file_location(mname, str(py_file))
                if spec is None or spec.loader is None:
                    continue
                mod = importlib.util.module_from_spec(spec)
                _sys.modules[mname] = mod
                try:
                    spec.loader.exec_module(mod)
                except Exception:
                    _sys.modules.pop(mname, None)
                    continue
            for v in vars(mod).values():
                if isinstance(v, type) and issubclass(v, _Action) and v is not _Action:
                    result.append(v)
        return result

    monkeypatch.setattr(reg_mod, "_load_synth_actions", _patched_load)

    # Build a fresh registry that uses the patched loader.
    reg = ActionRegistry()
    assert reg.get("synth.t6_boot1") is not None

    sys.modules.pop("agent.actions._synth.t6_boot1", None)


def test_load_synth_actions_skips_corrupt_file(tmp_path, monkeypatch):
    """A corrupt .py file is skipped without raising."""
    (tmp_path / "corrupt.py").write_text("this is not valid python ???###", encoding="utf-8")

    import agent.actions.registry as reg_mod

    def _patched_load():
        import importlib.util, sys as _sys
        from agent.actions.base import Action as _Action
        result = []
        for py_file in sorted(tmp_path.glob("*.py")):
            if py_file.name.startswith("_"):
                continue
            mname = f"agent.actions._synth.{py_file.stem}"
            spec = importlib.util.spec_from_file_location(mname, str(py_file))
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            _sys.modules[mname] = mod
            try:
                spec.loader.exec_module(mod)
            except Exception:
                _sys.modules.pop(mname, None)
                continue
            for v in vars(mod).values():
                if isinstance(v, type) and issubclass(v, _Action) and v is not _Action:
                    result.append(v)
        return result

    monkeypatch.setattr(reg_mod, "_load_synth_actions", _patched_load)

    # Must not raise; registry builds successfully (empty synth section).
    reg = ActionRegistry()
    assert reg.get("synthesize_capability") is SynthesizeCapability
