"""
Precondition registry + evaluator.

Each precondition is a `(value) -> bool` (sync or async). Failures carry their
declared `failure_mode`, letting the executor decide between abandon, reflect,
ask_user, or skip without parsing strings.
"""
from __future__ import annotations

import asyncio
import logging
import os
import socket
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from ..schemas import Precondition, PreconditionFailureMode

logger = logging.getLogger(__name__)

CheckFn = Callable[[Any], "Any | Awaitable[Any]"]


# ── Built-in checks ──────────────────────────────────────────────────────────

def _path_exists(value: Any) -> bool:
    return isinstance(value, str) and os.path.exists(os.path.expanduser(value))


def _path_size_under(value: Any) -> bool:
    """`value` is interpreted as a path; checked against a 10 MB ceiling."""
    if not isinstance(value, str):
        return False
    p = os.path.expanduser(value)
    try:
        return os.path.getsize(p) < 10_000_000
    except OSError:
        return False


def _network_online(value: Any = None) -> bool:
    """Cheap UDP socket connect — does not transmit anything."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(1.0)
        sock.connect(("8.8.8.8", 53))
        sock.close()
        return True
    except OSError:
        return False


def _workspace_writable(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    p = os.path.expanduser(value)
    try:
        os.makedirs(p, exist_ok=True)
    except OSError:
        return False
    return os.access(p, os.W_OK)


def _browser_page_active(value: Any) -> bool:
    """Patched at runtime by AgentRuntime when a Playwright page exists."""
    from ..runtime import agent_runtime  # local import to avoid cycle
    browser = getattr(agent_runtime, "browser", None)
    page = getattr(agent_runtime, "browser_page", None)
    return bool(browser and page)


PRECONDITION_REGISTRY: dict[str, CheckFn] = {
    "path.exists": _path_exists,
    "path.size_under": _path_size_under,
    "network.online": _network_online,
    "workspace.writable": _workspace_writable,
    "browser.page_active": _browser_page_active,
}


# ── Result + evaluator ───────────────────────────────────────────────────────

@dataclass
class FailedPrecondition:
    key: str
    failure_mode: PreconditionFailureMode
    detail: str


@dataclass
class PreconditionResult:
    ok: bool
    failures: list[FailedPrecondition]


async def check_preconditions(preconditions: list[Precondition]) -> PreconditionResult:
    failures: list[FailedPrecondition] = []
    for pc in preconditions:
        check = PRECONDITION_REGISTRY.get(pc.key)
        if check is None:
            failures.append(FailedPrecondition(
                key=pc.key,
                failure_mode=pc.failure_mode,
                detail=f"unknown precondition '{pc.key}'",
            ))
            continue
        try:
            outcome = check(pc.required)
            if asyncio.iscoroutine(outcome):
                outcome = await outcome
            if not outcome:
                failures.append(FailedPrecondition(
                    key=pc.key,
                    failure_mode=pc.failure_mode,
                    detail=f"precondition '{pc.key}' failed for value={pc.required!r}",
                ))
        except Exception as exc:
            failures.append(FailedPrecondition(
                key=pc.key,
                failure_mode=pc.failure_mode,
                detail=f"precondition '{pc.key}' raised {type(exc).__name__}: {exc}",
            ))
    return PreconditionResult(ok=not failures, failures=failures)
