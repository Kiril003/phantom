"""
Phase 32 — git.branch_manage action.

Provides professional git flow for the agent: creating branches, 
switching, and merging. Allows the agent to isolate its work 
just like a Senior Engineer.
"""
from __future__ import annotations

import asyncio
import subprocess
import time
from typing import ClassVar, Literal

from pydantic import Field

from .base import Action, ActionContext
from ..schemas import ActionResult, RiskLevel
from ._git import owned_repo_root


async def _run(args: list[str], cwd: str) -> subprocess.CompletedProcess:
    """Run git with output captured.

    The write ops used `check=True` with no `capture_output`, so
    `CalledProcessError.stderr` was always None and the handler below reported
    "Git command failed: None" — the agent got a failure with no reason to act
    on. Capture, then let the caller decide.
    """
    return await asyncio.to_thread(
        subprocess.run, ["git", *args],
        cwd=cwd, capture_output=True, text=True, check=False,
    )


class GitBranchManage(Action):
    """
    Manages git branches for task isolation. 
    Supports: create, switch, merge, delete.
    """
    name: ClassVar[str] = "git.branch_manage"
    risk_level: ClassVar[RiskLevel] = RiskLevel.MEDIUM
    reversible: ClassVar[bool] = True

    op: Literal["create", "switch", "merge", "delete", "list"] = Field(
        ..., description="The git operation to perform."
    )
    branch_name: str = Field(
        default="", 
        description="Name of the branch. Required for all ops except 'list'."
    )
    base_branch: str = Field(
        default="main",
        description="Base branch for 'create' or target for 'merge'."
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        try:
            # Every op below rewrites branch state, and `delete` force-deletes.
            # Without this the workspace resolves to whatever repository sits
            # above it — i.e. the user's own project.
            cwd, err = await owned_repo_root(ctx.workspace_dir)
            if err:
                return ActionResult(ok=False, error=err, error_class="foreign_repo")
            if cwd is None:
                return ActionResult(
                    ok=False,
                    error="Робоча директорія не є git-репозиторієм.",
                    error_class="not_a_repo",
                )

            if self.op == "list":
                res = await _run(["branch"], cwd)
                return ActionResult(ok=True, output={"branches": res.stdout.strip()}, elapsed_ms=int((time.monotonic()-t0)*1000))

            if not self.branch_name:
                return ActionResult(ok=False, error="branch_name is required for this operation", error_class="invalid_args")

            if self.op == "create":
                # Check if branch exists
                check = await _run(["rev-parse", "--verify", self.branch_name], cwd)
                if check.returncode == 0:
                    return ActionResult(ok=False, error=f"branch {self.branch_name} already exists", error_class="already_exists")

                res = await _run(["checkout", "-b", self.branch_name, self.base_branch], cwd)
                if res.returncode != 0:
                    return ActionResult(ok=False, error=f"Git command failed: {res.stderr.strip()}", error_class="git_error")
                return ActionResult(ok=True, output=f"Branch {self.branch_name} created and checked out from {self.base_branch}", side_effects=[f"git branch {self.branch_name}"])

            if self.op == "switch":
                res = await _run(["checkout", self.branch_name], cwd)
                if res.returncode != 0:
                    return ActionResult(ok=False, error=f"Git command failed: {res.stderr.strip()}", error_class="git_error")
                return ActionResult(ok=True, output=f"Switched to branch {self.branch_name}")

            if self.op == "merge":
                # Switch to base first
                res = await _run(["checkout", self.base_branch], cwd)
                if res.returncode != 0:
                    return ActionResult(ok=False, error=f"Git command failed: {res.stderr.strip()}", error_class="git_error")
                res = await _run(["merge", self.branch_name], cwd)
                if res.returncode != 0:
                    return ActionResult(ok=False, error=f"Merge conflict: {res.stderr.strip()}", error_class="merge_conflict")
                return ActionResult(ok=True, output=f"Merged {self.branch_name} into {self.base_branch}", side_effects=[f"git merge {self.branch_name}"])

            if self.op == "delete":
                res = await _run(["branch", "-D", self.branch_name], cwd)
                if res.returncode != 0:
                    return ActionResult(ok=False, error=f"Git command failed: {res.stderr.strip()}", error_class="git_error")
                return ActionResult(ok=True, output=f"Deleted branch {self.branch_name}")

        except Exception as exc:
            return ActionResult(ok=False, error=str(exc), error_class="internal_error")

        return ActionResult(ok=False, error="unreachable", error_class="internal_error")
