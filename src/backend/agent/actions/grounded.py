"""
Test execution action — run pytest or vitest and parse results.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import time
from typing import ClassVar, Literal

from pydantic import Field

from ..schemas import ActionResult, RiskLevel
from .base import Action, ActionContext


class TestRun(Action):
    """Run automated tests for a specific suite (backend/frontend).
    Parses results to provide structured feedback for the self-healing loop.
    """

    name: ClassVar[str] = "test.run"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    reversible: ClassVar[bool] = False

    suite: Literal["backend", "frontend"] = Field(..., description="Which test suite to run")
    path: str | None = Field(default=None, description="Optional path to a specific test file or directory")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        
        # 1. Determine command and working directory
        if self.suite == "backend":
            cwd = os.path.join(ctx.workspace_dir, "src/backend")
            cmd = [".venv/bin/pytest", "-v", "--no-header"]
            if self.path:
                # Ensure relative to src/backend
                rel_path = os.path.relpath(os.path.abspath(os.path.expanduser(self.path)), cwd)
                cmd.append(rel_path)
        else:
            cwd = os.path.join(ctx.workspace_dir, "src/frontend")
            cmd = ["npm", "test", "--", "--run", "--reporter=verbose"]
            if self.path:
                rel_path = os.path.relpath(os.path.abspath(os.path.expanduser(self.path)), cwd)
                cmd.extend(["-t", rel_path])

        try:
            # Run in sandbox-like subprocess (can be improved with bwrap later)
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()
            
            success = process.returncode == 0
            stdout_str = stdout.decode("utf-8", errors="replace")
            stderr_str = stderr.decode("utf-8", errors="replace")

            # 2. Parse summary
            summary = "Tests passed" if success else "Tests failed"
            if self.suite == "backend":
                # Look for lines like "FAILED tests/test_api.py::test_login - AssertionError"
                failures = [line for line in stdout_str.splitlines() if line.startswith("FAILED")]
                if failures:
                    summary = f"FAILURES detected:\n" + "\n".join(failures[:5])
            
            return ActionResult(
                ok=True, # Action itself succeeded in running the tests
                output={
                    "success": success,
                    "suite": self.suite,
                    "summary": summary,
                    "stdout": stdout_str[-2000:], # keep last 2kb
                    "stderr": stderr_str[-1000:],
                    "return_code": process.returncode
                },
                side_effects=[f"ran {self.suite} tests (result={success})"],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
            
        except Exception as exc:
            return ActionResult(
                ok=False, error=str(exc), error_class="test_execution_failed",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
