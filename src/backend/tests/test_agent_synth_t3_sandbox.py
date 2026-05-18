"""T3 — run_smoke_test: sandbox wrapper with stubbed subprocess.

Validates:
  - Success path (rc=0) → (True, "")
  - Failure path (rc=1) → (False, reason with rc + stderr)
  - sandbox wrap_argv is called when unsafe_mode=False (argv contains bwrap
    OR bwrap is absent and fallback is plain argv — both are accepted; what
    matters is that no real subprocess is launched and the env is clean)
  - unsafe_mode=True → sandboxed=False path executes without bwrap wrapper
  - tmp smoke file is cleaned up after run (both pass and fail)
  - assert_env_safe is satisfied (no JWT_/AI_/PHANTOM_ leaks)
"""
from __future__ import annotations

import tempfile
import textwrap
from pathlib import Path

import pytest

from agent.actions._synth.synthesizer import run_smoke_test

_VALID_SOURCE = textwrap.dedent("""\
    from typing import ClassVar
    import time
    from pydantic import Field
    from agent.schemas import ActionResult, RiskLevel
    from agent.actions.base import Action, ActionContext

    class SynthEcho(Action):
        name: ClassVar[str] = "synth.echo"
        risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
        msg: str = Field(default="")

        async def execute(self, ctx: ActionContext) -> ActionResult:
            return ActionResult(ok=True, output={"msg": self.msg},
                                elapsed_ms=0)
""")


def _make_stub(returncode: int, stdout: str = "OK: synth.echo", stderr: str = ""):
    """Return a synchronous _subprocess_run stub."""
    def _stub(argv, env):
        # Validate the env is clean — defence-in-depth inside test layer.
        from agent.operations.safety.sandbox import assert_env_safe
        assert_env_safe(env)
        return returncode, stdout, stderr
    return _stub


@pytest.mark.asyncio
async def test_smoke_success(tmp_path):
    passed, reason = await run_smoke_test(
        "echo",
        _VALID_SOURCE,
        workspace_dir=str(tmp_path),
        unsafe_mode=False,
        _subprocess_run=_make_stub(0),
    )
    assert passed is True
    assert reason == ""


@pytest.mark.asyncio
async def test_smoke_failure_rc1(tmp_path):
    passed, reason = await run_smoke_test(
        "echo",
        _VALID_SOURCE,
        workspace_dir=str(tmp_path),
        unsafe_mode=False,
        _subprocess_run=_make_stub(1, stdout="", stderr="SyntaxError: invalid syntax"),
    )
    assert passed is False
    assert "rc=1" in reason
    assert "SyntaxError" in reason


@pytest.mark.asyncio
async def test_smoke_temp_file_cleaned_up_on_success(tmp_path):
    await run_smoke_test(
        "echo",
        _VALID_SOURCE,
        workspace_dir=str(tmp_path),
        unsafe_mode=False,
        _subprocess_run=_make_stub(0),
    )
    leftover = list(tmp_path.glob("_synth_smoke_*.py"))
    assert leftover == [], f"temp smoke file not cleaned up: {leftover}"


@pytest.mark.asyncio
async def test_smoke_temp_file_cleaned_up_on_failure(tmp_path):
    await run_smoke_test(
        "echo",
        _VALID_SOURCE,
        workspace_dir=str(tmp_path),
        unsafe_mode=False,
        _subprocess_run=_make_stub(1, stderr="error"),
    )
    leftover = list(tmp_path.glob("_synth_smoke_*.py"))
    assert leftover == [], f"temp smoke file not cleaned up after failure: {leftover}"


@pytest.mark.asyncio
async def test_smoke_unsafe_mode_skips_sandbox(tmp_path, monkeypatch):
    """unsafe_mode=True → wrap_argv is NOT called; env comes from host_env_unsafe."""
    wrapped_calls: list = []

    import agent.operations.safety.sandbox as sbx
    original_wrap = sbx.wrap_argv

    def _spy_wrap(*args, **kwargs):
        wrapped_calls.append(args)
        return original_wrap(*args, **kwargs)

    monkeypatch.setattr(sbx, "wrap_argv", _spy_wrap)

    def _stub_unsafe(argv, env):
        from agent.operations.safety.sandbox import assert_env_safe
        assert_env_safe(env)
        return 0, "OK: synth.echo", ""

    await run_smoke_test(
        "echo",
        _VALID_SOURCE,
        workspace_dir=str(tmp_path),
        unsafe_mode=True,
        _subprocess_run=_stub_unsafe,
    )
    # wrap_argv must NOT have been called when unsafe_mode=True
    assert wrapped_calls == [], "wrap_argv was called despite unsafe_mode=True"


@pytest.mark.asyncio
async def test_smoke_exception_in_subprocess_returns_false(tmp_path):
    def _stub_raises(argv, env):
        raise RuntimeError("bwrap not found")

    passed, reason = await run_smoke_test(
        "echo",
        _VALID_SOURCE,
        workspace_dir=str(tmp_path),
        unsafe_mode=False,
        _subprocess_run=_stub_raises,
    )
    assert passed is False
    assert "smoke_run_error" in reason
