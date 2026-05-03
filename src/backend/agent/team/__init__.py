"""Phase 26-A — Agent team / sub-agent fan-out.

Public surface:
    spawn_subagent(parent_state, goal, role, ...) → child_task_id
    await_subagent(child_task_id, timeout_s)      → SubagentReport
    SubagentReport (dataclass)

Internal: bypasses the foreground/background slot machinery in
runtime.AgentRuntime so a parent task can fan out N parallel
specialist sub-agents without competing for the operator's slot.
A global asyncio.Semaphore (agent_max_team_concurrency) caps how
many sub-agents may run in flight across the whole runtime.
"""
from __future__ import annotations

from .picker import (
    TeamMemberRequest,
    TeamPlan,
    heuristic_pick,
    pick_specialists,
)
from .spawn import (
    SubagentReport,
    SubagentSpawnError,
    DelegationDepthExceeded,
    TeamConcurrencyExceeded,
    await_subagent,
    spawn_subagent,
    team_semaphore,
    notify_subagent_completed,
)
from .specialists import (
    Specialist,
    all_specialists,
    departments,
    get_specialist,
    specialist_catalog,
    specialists_by_department,
)

__all__ = [
    "spawn_subagent",
    "await_subagent",
    "notify_subagent_completed",
    "SubagentReport",
    "SubagentSpawnError",
    "DelegationDepthExceeded",
    "TeamConcurrencyExceeded",
    "team_semaphore",
    # Phase 26-B
    "Specialist",
    "all_specialists",
    "departments",
    "get_specialist",
    "specialists_by_department",
    "specialist_catalog",
    "TeamMemberRequest",
    "TeamPlan",
    "pick_specialists",
    "heuristic_pick",
]
