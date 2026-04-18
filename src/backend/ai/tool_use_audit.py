"""
Per-attempt audit log for AIRouter.call_with_tools (Phase 9.2).

Every primary + fallback attempt writes one row to `ai_tool_use_log`. The
table is read by tests + (later) operator dashboards to tune which provider
handles what kind of tool selection.
"""
from __future__ import annotations

import contextlib
import logging

from db.database import get_session
from db.models import AiToolUseLog

logger = logging.getLogger(__name__)


async def write_log(
    *,
    task_id: str | None,
    step_idx: int | None,
    provider: str,
    model: str,
    tool_name: str | None,
    success: bool,
    error_kind: str | None,
    error_message: str | None,
    elapsed_ms: int,
    retry_count: int,
) -> int | None:
    """Persist one tool-use attempt. Returns row id or None on failure."""
    try:
        async with get_session() as db:
            row = AiToolUseLog(
                task_id=task_id,
                step_idx=step_idx,
                provider=provider,
                model=model,
                tool_name=tool_name,
                success=bool(success),
                error_kind=error_kind,
                error_message=(error_message or "")[:1000] if error_message else None,
                elapsed_ms=int(elapsed_ms),
                retry_count=int(retry_count),
            )
            db.add(row)
            await db.flush()
            return int(row.id)
    except Exception as exc:
        # Audit must never crash the calling path.
        logger.debug("tool_use_audit write failed: %s", exc)
        return None


@contextlib.asynccontextmanager
async def best_effort():
    """Use to wrap audit writes when callers want suppression around them."""
    try:
        yield
    except Exception as exc:
        logger.debug("tool_use_audit suppressed: %s", exc)


__all__ = ["write_log", "best_effort"]
