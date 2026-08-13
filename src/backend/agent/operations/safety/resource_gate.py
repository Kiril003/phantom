"""
Block B — Pre-action resource gate.

Called by ``agent.executor.execute()`` immediately before dispatching an
action. Checks live RAM, disk, and network availability against the
action's declared resource requirements and returns a verdict that the
executor uses to decide: proceed, warn, or defer.

Design principles (from the Block B brief):
- **Fail-open**: if the monitor is off or raises, verdict is ``proceed=True``
  with ``pressure='unknown'``. Missing telemetry MUST NOT block the agent.
- ``unsafe_mode=True`` tasks still run the gate (resource constraints are
  physical, not policy) but are more permissive on the *network* check.
- Deferred actions ARE audited — but by the caller, not here. ``executor``
  turns a ``proceed=False`` verdict into a normal ``resource_unavailable``
  ActionResult and writes it through ``write_audit_entry`` under the real
  actor / task / step. The row carries ``output.gate == "resource_gate"``
  plus the pressure and snapshot summary, so the operator's grep handle
  survives. The gate itself only logs — see ``_log_defer``.

Usage::

    from agent.operations.safety.resource_gate import check_resources, ResourceGateVerdict
    verdict = await check_resources(action, unsafe_mode=unsafe_mode)
    if not verdict.proceed:
        # build ActionResult from verdict.reason / verdict.advice
        ...
"""
from __future__ import annotations

import logging

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# RAM safety margin: require 20 % headroom beyond the action's estimate.
_RAM_SAFETY_MARGIN = 1.2
# Minimum free disk beyond the action's estimated write (GB).
_DISK_MIN_HEADROOM_GB = 0.5


class ResourceGateVerdict(BaseModel):
    """Result of the pre-action resource check."""

    proceed: bool
    pressure: str = "unknown"      # green | yellow | red | unknown
    reason: str | None = None      # only when proceed=False
    advice: str | None = None      # for the planner
    snapshot_summary: str | None = None  # short string for observation


async def check_resources(
    action: object,
    *,
    unsafe_mode: bool = False,
) -> ResourceGateVerdict:
    """Check whether current system resources allow running ``action``.

    Parameters
    ----------
    action:
        An ``Action`` instance.  Resource declarations are read via
        ``ClassVar`` attributes + optional ``expected_peak_ram_mb()`` method.
    unsafe_mode:
        When True, network failures are still surfaced as warnings but do NOT
        cause a defer — the operator may have an unknown connectivity path.

    Returns
    -------
    ResourceGateVerdict
        ``proceed=True`` unless a hard resource constraint prevents execution.
    """
    # Import here to avoid circular imports at module level.
    try:
        from core.system_monitor import system_monitor
        snap = system_monitor.current()
    except Exception as exc:
        logger.debug("resource_gate: system_monitor unavailable: %s", exc)
        snap = None

    if snap is None:
        # Fail-open: monitor not yet running.
        return ResourceGateVerdict(
            proceed=True,
            pressure="unknown",
            snapshot_summary="resource_monitor_offline",
        )

    pressure = snap.pressure_label

    # Resolve action's RAM estimate (class-level default + optional instance override).
    try:
        estimated_ram_mb: int = _get_estimated_ram(action)
    except Exception as exc:
        logger.debug("resource_gate: ram estimate failed: %s", exc)
        estimated_ram_mb = 50  # conservative default

    # Resolve estimated disk write.
    try:
        estimated_disk_mb: int = int(
            getattr(type(action), "estimated_disk_write_mb", 0)
        )
    except Exception:
        estimated_disk_mb = 0

    # Resolve network requirement.
    try:
        requires_network: bool = bool(
            getattr(type(action), "requires_network", False)
        )
    except Exception:
        requires_network = False

    # ── RAM check ─────────────────────────────────────────────────────────────
    needed_mb = int(estimated_ram_mb * _RAM_SAFETY_MARGIN)
    if snap.ram_available_mb < needed_mb:
        if pressure == "red":
            _log_defer(action, "ram_unavailable", snap)
            return ResourceGateVerdict(
                proceed=False,
                pressure=pressure,
                reason="ram_unavailable",
                advice="wait_or_revise",
                snapshot_summary=_short_summary(snap),
            )
        elif pressure == "yellow":
            _log_warn(action, "ram_low_yellow", snap)
            # Proceed with warning — yellow is advisory.
        # green but math says insufficient → snapshot likely stale, proceed.

    # ── Disk check ────────────────────────────────────────────────────────────
    if estimated_disk_mb > 0:
        needed_disk_gb = estimated_disk_mb / 1024.0 + _DISK_MIN_HEADROOM_GB
        if snap.disk_free_gb < needed_disk_gb:
            if pressure == "red":
                _log_defer(action, "disk_unavailable", snap)
                return ResourceGateVerdict(
                    proceed=False,
                    pressure=pressure,
                    reason="disk_unavailable",
                    advice="free_disk_space_or_revise",
                    snapshot_summary=_short_summary(snap),
                )
            elif pressure == "yellow":
                _log_warn(action, "disk_low_yellow", snap)

    # ── Network check ─────────────────────────────────────────────────────────
    if requires_network and not snap.network_up:
        if unsafe_mode:
            # Operator may have a path we can't probe — warn and proceed.
            _log_warn(action, "network_down_unsafe_proceed", snap)
        else:
            if pressure == "red":
                _log_defer(action, "network_unavailable", snap)
                return ResourceGateVerdict(
                    proceed=False,
                    pressure=pressure,
                    reason="network_unavailable",
                    advice="wait_for_connectivity_or_revise",
                    snapshot_summary=_short_summary(snap),
                )
            else:
                # yellow / green pressure but no network — warn only.
                _log_warn(action, "network_down_yellow", snap)

    return ResourceGateVerdict(
        proceed=True,
        pressure=pressure,
        snapshot_summary=_short_summary(snap),
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_estimated_ram(action: object) -> int:
    """Return the action's peak RAM estimate in MB.

    Priority:
    1. ``action.expected_peak_ram_mb()`` — instance method if defined.
    2. ``type(action).estimated_peak_ram_mb`` — class-level ClassVar.
    3. Hard fallback: 50 MB.
    """
    instance_override = getattr(action, "expected_peak_ram_mb", None)
    if callable(instance_override):
        try:
            return int(instance_override())
        except Exception:
            pass
    return int(getattr(type(action), "estimated_peak_ram_mb", 50))


def _short_summary(snap: object) -> str:
    try:
        return (
            f"pressure={snap.pressure_label} "  # type: ignore[attr-defined]
            f"ram_avail={snap.ram_available_mb}MB "  # type: ignore[attr-defined]
            f"cpu={snap.cpu_pct:.0f}% "  # type: ignore[attr-defined]
            f"disk={snap.disk_free_gb:.1f}GB"  # type: ignore[attr-defined]
        )
    except Exception:
        return "snapshot_unavailable"


def _action_name(action: object) -> str:
    return str(getattr(type(action), "name", type(action).__name__))


def _log_defer(action: object, reason: str, snap: object) -> None:
    """Log the deferral. Deliberately does NOT touch the database.

    This used to fire-and-forget a synthetic ``AgentAuditEntry`` under
    ``user_id="__system__"`` / ``task_id="__resource_gate__"``. It never once
    reached the table: the kwargs didn't match the model (``action``/``ok``
    instead of ``action_name``, and NOT NULL ``step_idx`` was never passed),
    and even after fixing those the row would have been rejected by the
    ``agent_audit.user_id`` FK — no ``__system__`` user exists, and SQLite FK
    enforcement is ON (``db/database.py``). A broad ``except`` logged all of
    that at debug, so the write looked healthy for an entire schema migration.

    It is not being repaired, because it was always a *duplicate*. The caller
    (``agent/kernel/executor.py``) already persists this exact deferral via
    ``write_audit_entry`` with the real ``user_id``, ``task_id`` and
    ``step_idx``, and a richer result payload (pressure, advice, snapshot
    summary, ``gate="resource_gate"``). Auditing it a second time here would
    require inventing a non-loginable ``__system__`` user and a migration to
    seed it on every existing install — real authentication surface, bought
    for a strictly poorer copy of a row we already write correctly.

    Keep this function free of DB access: the gate runs on the hot path in
    front of every action and must stay fail-open and side-effect-free.
    """
    logger.warning(
        "resource_gate: DEFERRED action=%s reason=%s %s",
        _action_name(action), reason, _short_summary(snap),
    )


def _log_warn(action: object, reason: str, snap: object) -> None:
    logger.warning(
        "resource_gate: WARNING action=%s reason=%s %s",
        _action_name(action), reason, _short_summary(snap),
    )
    # Emit warning on the runtime broadcast if available.
    try:
        from core.event_bus import event_bus
        event_bus.emit("warning.issued", {
            "category": "resource_pressure",
            "action": _action_name(action),
            "reason": reason,
            "message": f"Resource pressure warning for {_action_name(action)}: {reason}",
        })
    except Exception:
        pass
