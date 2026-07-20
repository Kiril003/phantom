"""
Git Rollback Actions — Phase Agent Expansion.
Provides `git.checkpoint` and `git.rollback` allowing the agent to save
and restore the state of the workspace directory.
"""
import asyncio
import subprocess
from pydantic import Field

from .base import Action, ActionContext
from ..schemas import ActionResult, RiskLevel

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
        # Check if the workspace is a git repository
        try:
            res = await asyncio.to_thread(
                subprocess.run,
                ["git", "rev-parse", "--is-inside-work-tree"],
                cwd=ctx.workspace_dir,
                capture_output=True,
                text=True,
                check=False
            )
            if res.returncode != 0:
                # Initialize it if it's not
                await asyncio.to_thread(subprocess.run, ["git", "init"], cwd=ctx.workspace_dir, capture_output=True, check=True)
                # Need an initial commit before we can branch or reset cleanly in some cases
                await asyncio.to_thread(subprocess.run, ["git", "commit", "--allow-empty", "-m", "Initial empty commit"], cwd=ctx.workspace_dir, capture_output=True, check=False)

            # Add all changes
            await asyncio.to_thread(subprocess.run, ["git", "add", "."], cwd=ctx.workspace_dir, capture_output=True, check=True)

            # Commit
            commit_res = await asyncio.to_thread(
                subprocess.run,
                ["git", "commit", "-m", f"phantom_auto_checkpoint: {self.message}"],
                cwd=ctx.workspace_dir,
                capture_output=True,
                text=True,
                check=False
            )
            
            if "nothing to commit, working tree clean" in commit_res.stdout:
                return ActionResult(success=True, output="Workspace is clean, no checkpoint created.")
                
            if commit_res.returncode != 0:
                return ActionResult(success=False, error=f"Git commit failed: {commit_res.stderr}")
                
            return ActionResult(success=True, output=f"Checkpoint created: {commit_res.stdout.strip()}")
            
        except Exception as e:
            return ActionResult(success=False, error=f"Failed to create git checkpoint: {str(e)}")

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
            res = await asyncio.to_thread(
                subprocess.run,
                ["git", "reset", "--hard", "HEAD~1"],
                cwd=ctx.workspace_dir,
                capture_output=True,
                text=True,
                check=False
            )
            if res.returncode != 0:
                return ActionResult(success=False, error=f"Git rollback failed: {res.stderr}")
                
            return ActionResult(success=True, output=f"Rolled back successfully: {res.stdout.strip()}")
            
        except Exception as e:
            return ActionResult(success=False, error=f"Failed to execute git rollback: {str(e)}")
