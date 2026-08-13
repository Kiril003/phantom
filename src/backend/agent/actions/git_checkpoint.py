"""
Git Rollback Actions — Phase Agent Expansion.
Provides `git.checkpoint` and `git.rollback` allowing the agent to save
and restore the state of the workspace directory.
"""
import asyncio
import os
import subprocess
from pydantic import Field

from .base import Action, ActionContext
from ..schemas import ActionResult, RiskLevel
from ._git import IDENTITY as _IDENTITY, owned_repo_root as _owned_repo_root

class GitCheckpoint(Action):
    """
    Saves the current state of the workspace by adding all changes and creating a commit.
    Useful before performing risky or extensive file modifications.
    """
    name = "git.checkpoint"
    risk_level = RiskLevel.SAFE
    
    message: str = Field(
        ...,
        description="A short descriptive message explaining why this checkpoint is created."
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        try:
            root, err = await _owned_repo_root(ctx.workspace_dir)
            if err:
                return ActionResult(ok=False, error=err)

            cwd = os.path.realpath(os.path.expanduser(ctx.workspace_dir))
            if root is None:
                # Not a repository anywhere above us — safe to make one here.
                await asyncio.to_thread(subprocess.run, ["git", "init"], cwd=cwd, capture_output=True, check=True)
                # Need an initial commit before we can branch or reset cleanly in some cases
                await asyncio.to_thread(subprocess.run, ["git", *_IDENTITY, "commit", "--allow-empty", "-m", "Initial empty commit"], cwd=cwd, capture_output=True, check=False)

            # Add all changes
            await asyncio.to_thread(subprocess.run, ["git", "add", "."], cwd=cwd, capture_output=True, check=True)

            # Commit
            commit_res = await asyncio.to_thread(
                subprocess.run,
                ["git", *_IDENTITY, "commit", "-m", f"phantom_auto_checkpoint: {self.message}"],
                cwd=cwd,
                capture_output=True,
                text=True,
                check=False
            )
            
            if "nothing to commit, working tree clean" in commit_res.stdout:
                return ActionResult(ok=True, output="Workspace is clean, no checkpoint created.")
                
            if commit_res.returncode != 0:
                return ActionResult(ok=False, error=f"Git commit failed: {commit_res.stderr}")
                
            return ActionResult(ok=True, output=f"Checkpoint created: {commit_res.stdout.strip()}")
            
        except Exception as e:
            return ActionResult(ok=False, error=f"Failed to create git checkpoint: {str(e)}")

class GitRollback(Action):
    """
    Restores the workspace to the state of the last checkpoint.
    This uses `git reset --hard HEAD~1`.
    """
    name = "git.rollback"
    risk_level = RiskLevel.HIGH
    requires_consent = True
    
    async def execute(self, ctx: ActionContext) -> ActionResult:
        try:
            # Containment matters even more here: `reset --hard` in the user's
            # repo discards a real commit AND their uncommitted working tree.
            root, err = await _owned_repo_root(ctx.workspace_dir)
            if err:
                return ActionResult(ok=False, error=err)
            if root is None:
                return ActionResult(
                    ok=False,
                    error="Робоча директорія не є git-репозиторієм — немає чого відкочувати.",
                )

            res = await asyncio.to_thread(
                subprocess.run,
                ["git", "reset", "--hard", "HEAD~1"],
                cwd=root,
                capture_output=True,
                text=True,
                check=False
            )
            if res.returncode != 0:
                return ActionResult(ok=False, error=f"Git rollback failed: {res.stderr}")
                
            return ActionResult(ok=True, output=f"Rolled back successfully: {res.stdout.strip()}")
            
        except Exception as e:
            return ActionResult(ok=False, error=f"Failed to execute git rollback: {str(e)}")
