"""Shared containment check for the git actions.

Both `git_checkpoint` and `git_branch` shell out to git with
`cwd=ctx.workspace_dir`, and git resolves a repository by walking *upwards*
from that directory. When the agent's workspace sits inside the user's own
project — the normal setup for "work on my repo" — every one of those commands
lands in the USER's repository: checkpoints commit to their history, `branch
-D` force-deletes their branches, `reset --hard` discards their work.

The check lives here rather than in either module because a security check
copied into two places is a security check that will drift.
"""
from __future__ import annotations

import asyncio
import os
import subprocess

# A fresh device has no git identity configured and `git commit` hard-fails
# with "Please tell me who you are". Pass one per-invocation so the agent works
# out of the box without writing to the user's global git config.
IDENTITY = [
    "-c", "user.name=PHANTOM",
    "-c", "user.email=phantom@localhost",
]


async def owned_repo_root(workspace_dir: str) -> tuple[str | None, str | None]:
    """Resolve the repo the agent may write to.

    Returns ``(root, None)`` when the workspace *is* a repository root,
    ``(None, None)`` when there is no repository anywhere above it (the caller
    may create one), and ``(None, error)`` when the workspace is nested inside
    a repository the agent does not own.

    `git rev-parse --is-inside-work-tree` cannot make this distinction — it
    answers "is there a repository somewhere above me", which is true in
    exactly the dangerous case.
    """
    ws = os.path.realpath(os.path.expanduser(workspace_dir))
    res = await asyncio.to_thread(
        subprocess.run,
        ["git", "rev-parse", "--show-toplevel"],
        cwd=ws, capture_output=True, text=True, check=False,
    )
    if res.returncode != 0:
        return None, None
    root = os.path.realpath(res.stdout.strip())
    if root != ws:
        return None, (
            f"Робоча директорія {ws} лежить всередині чужого git-репозиторію "
            f"({root}). Відмовляюсь змінювати історію, яка мені не належить."
        )
    return root, None
