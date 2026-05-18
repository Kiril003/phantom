import time
import asyncio
from typing import ClassVar
from pydantic import Field
from agent.actions.base import Action, ActionContext
from agent.schemas import ActionResult, RiskLevel

class VoiceGreetSynth(Action):
    """
    Synthesizes and speaks a given text string using the system's 'espeak' command-line tool.
    """
    name: ClassVar[str] = "synth.voice_greet_synth"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = False
    estimated_peak_ram_mb: ClassVar[int] = 50
    estimated_disk_write_mb: ClassVar[int] = 0
    estimated_wall_seconds: ClassVar[int] = 15
    requires_network: ClassVar[bool] = False

    text: str = Field(
        ...,
        description="The text to be synthesized and spoken aloud."
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        if not ctx.runtime or not hasattr(ctx.runtime, 'bash'):
            return ActionResult(
                ok=False,
                error="Execution environment (bash) is not available in the current context.",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        # Check if the 'espeak' command exists
        check_proc = await ctx.runtime.bash.run(['command', '-v', 'espeak'])
        if check_proc.returncode != 0:
            return ActionResult(
                ok=False,
                error="The 'espeak' command-line tool is not installed or not in the system's PATH. Please install it to use this action.",
                output={"stderr": check_proc.stderr},
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        try:
            # Execute the espeak command with the provided text
            # Passing arguments as a list prevents shell injection vulnerabilities
            proc = await ctx.runtime.bash.run(['espeak', self.text])

            if proc.returncode == 0:
                result = ActionResult(
                    ok=True,
                    output={
                        "status": "Speech synthesized successfully.",
                        "stdout": proc.stdout,
                        "stderr": proc.stderr,
                    },
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            else:
                result = ActionResult(
                    ok=False,
                    error=f"The 'espeak' command failed with exit code {proc.returncode}.",
                    output={"stdout": proc.stdout, "stderr": proc.stderr},
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
        except asyncio.TimeoutError:
            result = ActionResult(
                ok=False,
                error="The 'espeak' command timed out.",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        except Exception as e:
            result = ActionResult(
                ok=False,
                error=f"An unexpected error occurred while executing 'espeak': {str(e)}",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        return result