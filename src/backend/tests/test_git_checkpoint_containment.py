"""`git.checkpoint` / `git.rollback` must only ever touch their own repo.

Two defects, both live in production before these tests existed:

1. Every ``ActionResult`` in the module was built with ``success=``, but the
   model's field is ``ok``. Pydantic raised ``ValidationError`` on the happy
   path, on the failure path, AND inside the ``except Exception`` handler that
   was supposed to catch it — so both actions raised out of ``execute()`` on
   every single call. The agent's checkpoint/rollback safety net never worked.

2. Containment was decided by ``git rev-parse --is-inside-work-tree``, which
   answers "is there a repository anywhere *above* me". With the workspace
   nested in the user's own project — the normal case for "work on my repo" —
   it said yes for the USER's repo, and `git add . && git commit` wrote a
   ``phantom_auto_checkpoint`` commit into their history. Because ``git
   commit`` without a pathspec commits the whole index, anything the user had
   staged for their own commit was swept in too.
"""
from __future__ import annotations

import os
import subprocess

import pytest

from agent.actions.git_checkpoint import GitCheckpoint, GitRollback
from agent.schemas import ActionResult


def _git(*args: str, cwd: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", *args],
        cwd=cwd, capture_output=True, text=True, check=False,
    )


class _Ctx:
    """Minimal stand-in for ActionContext — the actions only read workspace_dir."""

    def __init__(self, workspace_dir: str) -> None:
        self.workspace_dir = workspace_dir


@pytest.fixture
def user_repo(tmp_path):
    """The user's own repository, with a nested agent workspace inside it."""
    root = tmp_path / "userproject"
    (root / "sub" / "workspace").mkdir(parents=True)
    _git("init", "-q", ".", cwd=str(root))
    _git("commit", "-q", "--allow-empty", "-m", "base", cwd=str(root))
    # A second real commit, so `reset --hard HEAD~1` is a valid operation that
    # would genuinely destroy the user's history. Without it the rollback test
    # passes for the wrong reason — git refusing an unknown revision.
    (root / "shipped.py").write_text("def shipped(): return 1\n")
    _git("add", "shipped.py", cwd=str(root))
    _git("commit", "-q", "-m", "user feature", cwd=str(root))
    # Work the user staged for their OWN next commit.
    (root / "important.txt").write_text("user work in progress")
    _git("add", "important.txt", cwd=str(root))
    # Something the agent produced inside its workspace.
    (root / "sub" / "workspace" / "out.txt").write_text("agent output")
    return root


# ── Defect 1: the constructor ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_checkpoint_returns_an_actionresult_not_a_validationerror(tmp_path):
    """A standalone workspace is the happy path — it must return, not raise."""
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "file.txt").write_text("content")

    result = await GitCheckpoint(message="before risky edit").execute(_Ctx(str(ws)))

    assert isinstance(result, ActionResult)
    assert result.ok is True, result.error
    assert os.path.isdir(ws / ".git"), "should have initialised its own repo"


@pytest.mark.asyncio
async def test_rollback_returns_an_actionresult_not_a_validationerror(tmp_path):
    """The error path must also construct — it used to raise inside `except`."""
    ws = tmp_path / "plain"
    ws.mkdir()

    result = await GitRollback().execute(_Ctx(str(ws)))

    assert isinstance(result, ActionResult)
    assert result.ok is False
    assert result.error


@pytest.mark.asyncio
async def test_checkpoint_commits_its_own_work(tmp_path):
    """Round-trip: the checkpoint is a real commit containing the workspace."""
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "file.txt").write_text("content")

    result = await GitCheckpoint(message="snapshot").execute(_Ctx(str(ws)))
    assert result.ok is True, result.error

    log = _git("log", "--oneline", "-1", cwd=str(ws)).stdout
    assert "phantom_auto_checkpoint: snapshot" in log
    tracked = _git("show", "--name-only", "--format=", "HEAD", cwd=str(ws)).stdout
    assert "file.txt" in tracked


# ── Defect 2: containment ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_checkpoint_refuses_to_commit_into_the_users_repo(user_repo):
    """The decisive case: workspace nested inside a repo the agent doesn't own."""
    workspace = user_repo / "sub" / "workspace"
    before = _git("rev-parse", "HEAD", cwd=str(user_repo)).stdout.strip()

    result = await GitCheckpoint(message="before risky edit").execute(
        _Ctx(str(workspace))
    )

    assert result.ok is False
    assert "чужого git-репозиторію" in (result.error or "")

    after = _git("rev-parse", "HEAD", cwd=str(user_repo)).stdout.strip()
    assert after == before, "agent wrote a commit into the user's repository"

    # And the user's staged work is still staged, not swallowed by a checkpoint.
    staged = _git("diff", "--cached", "--name-only", cwd=str(user_repo)).stdout
    assert "important.txt" in staged


@pytest.mark.asyncio
async def test_rollback_refuses_to_reset_the_users_repo(user_repo):
    """`reset --hard` in the user's repo would destroy real commits AND worktree."""
    workspace = user_repo / "sub" / "workspace"
    before = _git("rev-parse", "HEAD", cwd=str(user_repo)).stdout.strip()

    result = await GitRollback().execute(_Ctx(str(workspace)))

    assert result.ok is False
    assert "чужого git-репозиторію" in (result.error or "")
    after = _git("rev-parse", "HEAD", cwd=str(user_repo)).stdout.strip()
    assert after == before, "agent reset the user's repository"
    assert (user_repo / "shipped.py").exists(), "agent discarded the user's commit"
    assert (user_repo / "important.txt").exists(), "user's working tree was destroyed"


@pytest.mark.asyncio
async def test_checkpoint_accepts_a_workspace_that_is_the_repo_root(tmp_path):
    """Containment rejects *foreign* repos, not the agent's own established one."""
    ws = tmp_path / "ws"
    ws.mkdir()
    _git("init", "-q", ".", cwd=str(ws))
    _git("commit", "-q", "--allow-empty", "-m", "base", cwd=str(ws))
    (ws / "new.txt").write_text("agent work")

    result = await GitCheckpoint(message="own repo").execute(_Ctx(str(ws)))

    assert result.ok is True, result.error
    assert "phantom_auto_checkpoint: own repo" in _git(
        "log", "--oneline", "-1", cwd=str(ws)
    ).stdout


# ── git.branch_manage shares the same escape ─────────────────────────────────


@pytest.mark.asyncio
async def test_branch_delete_refuses_in_the_users_repo(user_repo):
    """`branch -D` is a force-delete — in the user's repo it loses their work."""
    from agent.actions.git_branch import GitBranchManage

    _git("branch", "user-feature", cwd=str(user_repo))
    workspace = user_repo / "sub" / "workspace"

    result = await GitBranchManage(op="delete", branch_name="user-feature").execute(
        _Ctx(str(workspace))
    )

    assert result.ok is False
    assert result.error_class == "foreign_repo"
    branches = _git("branch", cwd=str(user_repo)).stdout
    assert "user-feature" in branches, "agent force-deleted the user's branch"


@pytest.mark.asyncio
async def test_branch_ops_work_in_the_agents_own_repo(tmp_path):
    """Containment must not break the legitimate case."""
    from agent.actions.git_branch import GitBranchManage

    ws = tmp_path / "ws"
    ws.mkdir()
    _git("init", "-q", "-b", "main", ".", cwd=str(ws))
    _git("commit", "-q", "--allow-empty", "-m", "base", cwd=str(ws))

    created = await GitBranchManage(
        op="create", branch_name="feature", base_branch="main"
    ).execute(_Ctx(str(ws)))
    assert created.ok is True, created.error
    assert "feature" in _git("branch", cwd=str(ws)).stdout


@pytest.mark.asyncio
async def test_branch_failure_reports_git_stderr_not_none(tmp_path):
    """The write ops used `check=True` with no capture, so `exc.stderr` was None
    and every failure read "Git command failed: None"."""
    from agent.actions.git_branch import GitBranchManage

    ws = tmp_path / "ws"
    ws.mkdir()
    _git("init", "-q", "-b", "main", ".", cwd=str(ws))
    _git("commit", "-q", "--allow-empty", "-m", "base", cwd=str(ws))

    result = await GitBranchManage(op="switch", branch_name="does-not-exist").execute(
        _Ctx(str(ws))
    )

    assert result.ok is False
    assert "None" not in (result.error or ""), result.error
    assert (result.error or "").strip() not in ("", "Git command failed:")
