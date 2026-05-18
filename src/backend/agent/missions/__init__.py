"""
agent.missions — Block C-1 long-horizon mission/phase persistence.

Public API re-exported here so callers do:

    from agent.missions import create_mission, get_mission, ...

The store module holds all async CRUD helpers; the ledger module owns
the append-only Markdown file writer/reader. Neither touches loop.py,
runtime.py, or any planner — that wiring is Block C-2.
"""
from agent.missions.store import (
    create_mission,
    get_mission,
    list_missions,
    update_mission_status,
    create_phase,
    get_phase,
    list_phases,
    update_phase_status,
    mark_artifact_produced,
)
from agent.missions.ledger import LedgerWriter, LedgerReader

__all__ = [
    # store
    "create_mission",
    "get_mission",
    "list_missions",
    "update_mission_status",
    "create_phase",
    "get_phase",
    "list_phases",
    "update_phase_status",
    "mark_artifact_produced",
    # ledger
    "LedgerWriter",
    "LedgerReader",
]
