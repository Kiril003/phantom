"""
firejail wrapper. Honest about what it actually does — never lies in audit.

If firejail isn't on PATH, returns the unwrapped command and reports
sandboxed=False. Caller is responsible for surfacing that flag in the
ActionResult so the audit trail tells the truth.
"""
from __future__ import annotations

import logging
import shutil

logger = logging.getLogger(__name__)

_FIREJAIL_FLAGS = [
    "--quiet",
    "--private",
    "--net=none",
    "--rlimit-as=536870912",  # 512 MiB
]


def firejail_available() -> bool:
    return shutil.which("firejail") is not None


def wrap_shell_cmd(cmd: str, sandboxed: bool) -> tuple[list[str], bool]:
    """
    Wrap a /bin/sh -c command with firejail when both requested AND available.

    Returns (argv, actually_sandboxed). If sandboxed was requested but firejail
    is missing, logs a WARNING once and falls through with sandboxed=False so
    the caller can surface that fact.
    """
    if not sandboxed:
        return (["/bin/sh", "-c", cmd], False)

    if not firejail_available():
        logger.warning(
            "agent.bash.run requested sandboxed=True but firejail is missing — "
            "running unsandboxed and reporting sandboxed=False in audit"
        )
        return (["/bin/sh", "-c", cmd], False)

    argv = ["firejail", *_FIREJAIL_FLAGS, "--", "/bin/sh", "-c", cmd]
    return (argv, True)
