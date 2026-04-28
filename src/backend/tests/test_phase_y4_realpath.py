"""Day-4 Wave-1 — Block Y-4: F-40 / D3-F-40 / U4-SEC-H4 realpath workspace check.

`agent/actions/fs.py::FsWrite.execute` previously containment-checked the
target path with `os.path.abspath(...)` + `startswith(workspace + os.sep)`.
That is symlink-vulnerable: an attacker who can plant a symlink inside
the workspace can point it at `/etc` (or anywhere else), and the prefix
check still passes — `open()` then follows the link and writes outside
the workspace.

The fix (per ADR-SBX-006 in `docs/architecture/sandbox-runtime.md`):

* `os.path.realpath` BOTH sides — resolves through symlinks.
* `os.path.commonpath` equality — the canonical "is X a descendant of Y"
  check that does not get fooled by `prefix` matching `<workspace>` vs
  `<workspace>-evil/`.
* After `os.makedirs`, re-check the parent's `realpath` to catch a TOCTOU
  swap of an intermediate directory to a symlink between the two
  realpath() calls. Documented residual race; bulletproof closure
  requires `O_NOFOLLOW` per path component (openat dance) — Day-4 ships
  this narrower mitigation.

These tests are the regression gate.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest


# ---------------------------------------------------------------------- helpers


class _StubRuntime:
    """Stand-in for AgentRuntime — fs.py never calls into runtime."""


@pytest.fixture
def workspace(tmp_path: Path) -> str:
    """Workspace is a *sub*-directory of tmp_path so symlink-escape tests can
    point at sibling-of-workspace directories (still under tmp_path → still
    auto-cleaned by pytest, but truly outside the workspace boundary).
    Using `tmp_path` directly would make every "outside" sibling be ALSO
    under the workspace's realpath — defeating the test.
    """
    ws = tmp_path / "ws"
    ws.mkdir()
    return str(ws)


@pytest.fixture
def ctx(workspace: str):
    from agent.actions.base import ActionContext

    return ActionContext(
        task_id="t-y4",
        step_idx=0,
        workspace_dir=workspace,
        runtime=_StubRuntime(),
    )


# ----------------------------------------------------- Y-4 closure tests


class TestY4SymlinkEscapeClosure:
    @pytest.mark.asyncio
    async def test_symlink_in_workspace_pointing_outside_is_refused(
        self, ctx, workspace, tmp_path
    ):
        """The classic F-40 attack: <workspace>/escape -> /etc.
        Pre-fix: `<workspace>/escape` abspath stays inside workspace,
        startswith passes, open() follows the link, writes to `/etc`.
        Post-fix: realpath resolves to `/etc`, commonpath check fails,
        we refuse with `requires_confirm`.
        """
        from agent.actions.fs import FsWrite

        evil_target = tmp_path / "outside_dir"
        evil_target.mkdir()
        symlink = Path(workspace) / "escape"
        os.symlink(str(evil_target), str(symlink))

        # Try writing to <workspace>/escape/secret.txt — symlink follows
        # to <outside_dir>/secret.txt which is OUTSIDE the workspace.
        target = str(symlink / "secret.txt")
        res = await FsWrite(path=target, content="leaked").execute(ctx)

        assert not res.ok, "FsWrite must refuse to follow symlink-out"
        assert res.error_class in {"requires_confirm", "symlink_escape"}, (
            f"expected refuse-class, got {res.error_class}: {res.error}"
        )
        assert not (evil_target / "secret.txt").exists(), (
            "Y-4 regression: write leaked outside workspace via symlink"
        )

    @pytest.mark.asyncio
    async def test_intermediate_symlink_dir_is_refused_after_makedirs(
        self, ctx, workspace, tmp_path
    ):
        """`<workspace>/dir1` is a symlink to `<outside>/dir1`. Writing to
        `<workspace>/dir1/file.txt` resolves outside via the parent.
        Post-fix: parent realpath after makedirs is checked, and writes
        to the resolved-outside path are refused.
        """
        from agent.actions.fs import FsWrite

        outside = tmp_path / "evil_root"
        outside.mkdir()
        symlinked_dir = Path(workspace) / "dir1"
        os.symlink(str(outside), str(symlinked_dir))

        target = str(symlinked_dir / "file.txt")
        res = await FsWrite(path=target, content="x").execute(ctx)

        assert not res.ok
        assert res.error_class in {"requires_confirm", "symlink_escape"}, (
            f"expected refuse-class, got {res.error_class}: {res.error}"
        )
        assert not (outside / "file.txt").exists(), (
            "Y-4 regression: intermediate symlink let write escape"
        )

    @pytest.mark.asyncio
    async def test_legit_nested_write_still_works(self, ctx, workspace):
        """Back-compat: a legitimate nested write under the workspace —
        no symlinks anywhere — must still succeed exactly as today.
        """
        from agent.actions.fs import FsWrite

        target = os.path.join(workspace, "subdir", "deep", "file.txt")
        res = await FsWrite(path=target, content="legit").execute(ctx)

        assert res.ok, f"legit nested write regressed: {res.error}"
        assert Path(target).read_text() == "legit"

    @pytest.mark.asyncio
    async def test_workspace_at_root_path_writes_succeed(self, ctx, workspace):
        """Edge: writing exactly to `<workspace>/file.txt` — top-level —
        the path_real == workspace_real branch handles this.
        """
        from agent.actions.fs import FsWrite

        target = os.path.join(workspace, "top.txt")
        res = await FsWrite(path=target, content="hi").execute(ctx)

        assert res.ok, f"top-level write regressed: {res.error}"
        assert Path(target).read_text() == "hi"

    @pytest.mark.asyncio
    async def test_workspace_itself_is_a_symlink_writes_inside_succeed(
        self, ctx, tmp_path, monkeypatch
    ):
        """If the operator's `agent_workspace_dir` itself is a symlink
        (e.g., `~/work -> /var/lib/phantom/workspace`), writes inside it
        must STILL succeed. realpath resolves both sides — symmetric.
        """
        from agent.actions.base import ActionContext
        from agent.actions.fs import FsWrite

        real_target = tmp_path / "real_workspace"
        real_target.mkdir()
        link_workspace = tmp_path / "link_workspace"
        os.symlink(str(real_target), str(link_workspace))

        ctx2 = ActionContext(
            task_id="t-y4-link",
            step_idx=0,
            workspace_dir=str(link_workspace),
            runtime=_StubRuntime(),
        )

        target = str(link_workspace / "file.txt")
        res = await FsWrite(path=target, content="ok").execute(ctx2)

        assert res.ok, (
            f"writes through a symlinked workspace dir regressed: {res.error}"
        )
        assert (real_target / "file.txt").read_text() == "ok"

    @pytest.mark.asyncio
    async def test_confirm_true_from_llm_does_not_bypass_realpath_check(
        self, ctx, workspace, tmp_path
    ):
        """Hard rule (existing behaviour): LLM-supplied `confirm=True` is
        always overridden to False. Combined with Y-4: even with confirm,
        a symlink-escape is refused.
        """
        from agent.actions.fs import FsWrite

        outside = tmp_path / "outside2"
        outside.mkdir()
        symlink = Path(workspace) / "escape2"
        os.symlink(str(outside), str(symlink))

        target = str(symlink / "still.txt")
        res = await FsWrite(path=target, content="x", confirm=True).execute(ctx)

        assert not res.ok
        assert res.error_class in {"requires_confirm", "symlink_escape"}
        assert not (outside / "still.txt").exists()
