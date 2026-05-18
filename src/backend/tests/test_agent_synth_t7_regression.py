"""T7 — regression: existing action/registry/sandbox/lessons suites unaffected by V4.

Validates:
  - ActionRegistry still contains all pre-V4 actions (spot check core ones).
  - synthesize_capability is an ADDITION, not a replacement.
  - SandboxProfile.compute + wrap_argv still work correctly (V4 reuses them).
  - recall_lessons / write_lesson API unchanged.
  - _load_synth_actions with empty _synth/ is a no-op at boot (clean install).
  - Action ABC interface: SynthesizeCapability satisfies all ClassVar + execute.
"""
from __future__ import annotations

import textwrap

import pytest

from agent.actions.registry import ActionRegistry, _load_synth_actions
from agent.actions.base import Action, ActionContext
from agent.actions.synthesize_capability import SynthesizeCapability
from agent.schemas import ActionResult, RiskLevel


# ── Registry completeness (spot-check pre-V4 actions still present) ───────────


def test_pre_v4_actions_still_registered():
    registry = ActionRegistry()
    expected = [
        "bash.run",
        "fs.read",
        "fs.write",
        "self.capability",
        "self.recall",
        "net.scan",
        "notify.desktop",
        "time.wait",
        "web.search",
        "voice.say",
        "voice.listen",
        "agent.delegate",
        "git.checkpoint",
    ]
    names = registry.names()
    for name in expected:
        assert name in names, f"Pre-V4 action '{name}' missing from registry after V4 changes"


def test_synthesize_capability_is_additive():
    registry = ActionRegistry()
    names = registry.names()
    # V4 added synthesize_capability; core actions must still be there.
    assert "synthesize_capability" in names
    assert len(names) > 30, "Registry shrank — some actions may have been dropped"


# ── sandbox wrap_argv still works (V4 imports it, must not break it) ──────────


def test_wrap_argv_compute_profile_unchanged():
    from agent.operations.safety.sandbox import SandboxProfile, wrap_argv, bwrap_available
    argv, sandboxed = wrap_argv(
        SandboxProfile.compute,
        ["/bin/sh", "-c", "echo ok"],
        workspace_dir="/tmp",
    )
    if bwrap_available():
        assert sandboxed is True
        assert "bwrap" in argv[0] or "prlimit" in argv[0]
    else:
        assert sandboxed is False
        assert argv == ["/bin/sh", "-c", "echo ok"]


def test_clean_env_no_sensitive_keys():
    from agent.operations.safety.sandbox import clean_env, assert_env_safe
    env = clean_env(workspace_dir="/tmp/ws")
    assert_env_safe(env)  # must not raise
    assert "PATH" in env
    assert "JWT_SECRET_KEY" not in env
    assert "AI_GEMINI_API_KEY" not in env


# ── Action ABC: SynthesizeCapability satisfies the interface ──────────────────


def test_synthesize_capability_is_action_subclass():
    assert issubclass(SynthesizeCapability, Action)


def test_synthesize_capability_class_vars():
    assert SynthesizeCapability.name == "synthesize_capability"
    assert SynthesizeCapability.risk_level == RiskLevel.MEDIUM
    assert SynthesizeCapability.estimated_peak_ram_mb > 0
    assert SynthesizeCapability.estimated_wall_seconds > 0


def test_synthesize_capability_constructible():
    a = SynthesizeCapability(spec="do something useful")
    assert a.spec == "do something useful"
    assert a.slug == ""


def test_synthesize_capability_catalog_entry():
    registry = ActionRegistry()
    catalog = {e["name"]: e for e in registry.catalog()}
    entry = catalog["synthesize_capability"]
    assert entry["risk_level"] == int(RiskLevel.MEDIUM)
    assert "spec" in entry["args"]


# ── _load_synth_actions: empty _synth/ is a no-op ────────────────────────────


def test_load_synth_actions_empty_dir(tmp_path, monkeypatch):
    """No .py files (other than __init__) → empty list, no error."""
    import agent.actions.registry as reg_mod

    def _patched_load():
        from agent.actions.base import Action as _A
        import importlib.util, sys
        result = []
        for f in sorted(tmp_path.glob("*.py")):
            if f.name.startswith("_"):
                continue
            mname = f"agent.actions._synth.{f.stem}"
            spec = importlib.util.spec_from_file_location(mname, str(f))
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            sys.modules[mname] = mod
            try:
                spec.loader.exec_module(mod)
            except Exception:
                sys.modules.pop(mname, None)
                continue
            for v in vars(mod).values():
                if isinstance(v, type) and issubclass(v, _A) and v is not _A:
                    result.append(v)
        return result

    monkeypatch.setattr(reg_mod, "_load_synth_actions", _patched_load)

    reg = ActionRegistry()
    # All production actions still present, no synth entries added.
    assert "bash.run" in reg.names()
    assert "synthesize_capability" in reg.names()
    # None of the tmp_path synth names present (empty dir).
    synth_names = [n for n in reg.names() if n.startswith("synth.")]
    assert synth_names == []


# ── lessons API unchanged ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_recall_lessons_api_unchanged(monkeypatch):
    """recall_lessons returns [] when lessons disabled — API shape unchanged."""
    from config import config
    monkeypatch.setattr(config, "agent_lessons_enabled", False)

    from agent.cognition.memory.lessons import recall_lessons
    result = await recall_lessons("synthesize file reader action")
    assert result == []


@pytest.mark.asyncio
async def test_write_lesson_api_unchanged(monkeypatch):
    """write_lesson returns '' when lessons disabled — API shape unchanged."""
    from config import config
    monkeypatch.setattr(config, "agent_lessons_enabled", False)

    from agent.cognition.memory.lessons import write_lesson
    result = await write_lesson(
        task_id="t_reg",
        goal="test regression",
        outcome="done",
        lesson={"what_worked": "x", "what_avoid": "", "applicability": "test"},
    )
    assert result == ""
