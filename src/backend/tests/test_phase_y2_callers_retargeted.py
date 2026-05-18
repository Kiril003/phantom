"""Day-4 Wave-2 Y-2 — caller retarget through wrap_argv + clean_env
(closes audit U4-SEC-G1 caller-drift).

bash.run + MCP stdio client both consume the new ``wrap_argv`` /
``clean_env`` / ``assert_env_safe`` API. The legacy ``wrap_shell_cmd``
shim survives only as a back-compat helper; nothing under
``agent/actions/`` or ``agent/mcp/`` should call it directly anymore.

Coverage:

1. bash.py imports SandboxProfile + wrap_argv + clean_env +
   assert_env_safe; does NOT import wrap_shell_cmd anymore.
2. mcp/adapter.py imports the same.
3. bash.py source-grep: contains "wrap_argv(SandboxProfile.compute"
   call site (the closed-enum policy boundary).
4. mcp/adapter.py source-grep: same.
5. bash.py source-grep: contains "assert_env_safe(scrubbed_env)" so a
   future allowlist drift trips the audit.
6. mcp/adapter.py source-grep: same.
7. mcp/adapter.py: McpStdioClient gains `_sandboxed: None|bool`
   tri-state attribute on construction.
8. End-to-end smoke: BashRun(sandboxed=True) when bwrap missing →
   ActionResult.sandboxed=False (audit truth carried through).
"""
from __future__ import annotations

from pathlib import Path

import pytest


_BACKEND = Path(__file__).resolve().parents[1]


# ──────────────────────────────────────────────────────────── source pins ──


class TestBashSourceContract:
    def test_bash_imports_y1_api_only(self):
        body = (_BACKEND / "agent" / "actions" / "bash.py").read_text(encoding="utf-8")
        assert "from ..safety.sandbox import" in body
        assert "SandboxProfile" in body
        assert "wrap_argv" in body
        assert "clean_env" in body
        assert "assert_env_safe" in body
        # Legacy shim no longer IMPORTED here — Y-2 retarget. The
        # docstring may still reference the name for archaeological
        # context; only the import line is forbidden.
        for line in body.splitlines():
            if line.lstrip().startswith("#") or line.lstrip().startswith('"'):
                continue
            assert "wrap_shell_cmd" not in line or "import" not in line, (
                "Y-2 regression: bash.py still imports wrap_shell_cmd. "
                f"Offending line: {line!r}"
            )

    def test_bash_call_site_uses_compute_profile(self):
        body = (_BACKEND / "agent" / "actions" / "bash.py").read_text(encoding="utf-8")
        assert "wrap_argv(" in body
        assert "SandboxProfile.compute" in body
        # Defence-in-depth env audit fires on every call.
        assert "assert_env_safe(scrubbed_env)" in body


class TestMcpAdapterSourceContract:
    def test_adapter_imports_y1_api(self):
        body = (_BACKEND / "agent" / "mcp" / "adapter.py").read_text(encoding="utf-8")
        assert "from ..safety.sandbox import" in body
        assert "SandboxProfile" in body
        assert "wrap_argv" in body
        assert "clean_env" in body
        assert "assert_env_safe" in body

    def test_adapter_call_site_uses_compute_profile(self):
        body = (_BACKEND / "agent" / "mcp" / "adapter.py").read_text(encoding="utf-8")
        # Either inline `wrap_argv(SandboxProfile.compute, ...)` OR the
        # multi-line shape `wrap_argv(\n    SandboxProfile.compute, ...)`
        # is acceptable — both pin the closed-enum policy boundary.
        assert "wrap_argv(" in body
        assert "SandboxProfile.compute" in body
        assert "assert_env_safe(scrubbed_env)" in body


# ────────────────────────────────────────────────────── McpStdioClient state ──


class TestMcpStdioClientSandboxedAttribute:
    def test_sandboxed_starts_as_none(self):
        from agent.mcp.adapter import McpStdioClient

        client = McpStdioClient(name="test", command="echo hi")
        # Pre-connect: None means "never attempted".
        assert client._sandboxed is None


# ───────────────────────────────────────────────────── end-to-end smoke ──


@pytest.mark.asyncio
async def test_bash_run_sandboxed_true_audit_truth_when_bwrap_missing(
    monkeypatch, tmp_path
):
    """If bwrap is missing on PATH, BashRun(sandboxed=True) must
    return ActionResult.sandboxed=False (audit truth invariant)."""
    import agent.operations.safety.sandbox as sb
    from agent.actions.bash import BashRun
    from agent.actions.base import ActionContext

    # Force bwrap missing.
    monkeypatch.setattr(sb.shutil, "which", lambda *_a, **_kw: None)

    ctx = ActionContext(
        task_id="t-y2",
        step_idx=0,
        workspace_dir=str(tmp_path),
    )
    res = await BashRun(cmd="echo OK", timeout_s=5, sandboxed=True).execute(ctx)
    assert res.ok, res.error
    assert res.sandboxed is False, (
        "Y-2 audit-truth: bwrap missing must surface as sandboxed=False "
        "in the ActionResult so the audit log doesn't lie."
    )
