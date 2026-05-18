"""
Phase 32 — git.branch_manage action.

Provides professional git flow for the agent: creating branches, 
switching, and merging. Allows the agent to isolate its work 
just like a Senior Engineer.
"""
from __future__ import annotations

import subprocess
import time
from typing import ClassVar, Literal

from pydantic import Field

from .base import Action, ActionContext
from ..schemas import ActionResult, RiskLevel

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
        cwd = ctx.workspace_dir
        
        try:
            if self.op == "list":
                res = subprocess.run(["git", "branch"], cwd=cwd, capture_output=True, text=True)
                return ActionResult(ok=True, output={"branches": res.stdout.strip()}, elapsed_ms=int((time.monotonic()-t0)*1000))

            if not self.branch_name:
                return ActionResult(ok=False, error="branch_name is required for this operation", error_class="invalid_args")

            if self.op == "create":
                # Check if branch exists
                check = subprocess.run(["git", "rev-parse", "--verify", self.branch_name], cwd=cwd, capture_output=True)
                if check.returncode == 0:
                    return ActionResult(ok=False, error=f"branch {self.branch_name} already exists", error_class="already_exists")
                
                subprocess.run(["git", "checkout", "-b", self.branch_name, self.base_branch], cwd=cwd, check=True)
                return ActionResult(ok=True, output=f"Branch {self.branch_name} created and checked out from {self.base_branch}", side_effects=[f"git branch {self.branch_name}"])

            if self.op == "switch":
                subprocess.run(["git", "checkout", self.branch_name], cwd=cwd, check=True)
                return ActionResult(ok=True, output=f"Switched to branch {self.branch_name}")

            if self.op == "merge":
                # Switch to base first
                subprocess.run(["git", "checkout", self.base_branch], cwd=cwd, check=True)
                res = subprocess.run(["git", "merge", self.branch_name], cwd=cwd, capture_output=True, text=True)
                if res.returncode != 0:
                    return ActionResult(ok=False, error=f"Merge conflict: {res.stderr}", error_class="merge_conflict")
                return ActionResult(ok=True, output=f"Merged {self.branch_name} into {self.base_branch}", side_effects=[f"git merge {self.branch_name}"])

            if self.op == "delete":
                subprocess.run(["git", "branch", "-D", self.branch_name], cwd=cwd, check=True)
                return ActionResult(ok=True, output=f"Deleted branch {self.branch_name}")

        except subprocess.CalledProcessError as exc:
            return ActionResult(ok=False, error=f"Git command failed: {exc.stderr}", error_class="git_error")
        except Exception as exc:
            return ActionResult(ok=False, error=str(exc), error_class="internal_error")

        return ActionResult(ok=False, error="unreachable", error_class="internal_error")
