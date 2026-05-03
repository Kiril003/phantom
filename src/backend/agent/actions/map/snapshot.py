"""map.snapshot — record the current viewport / layer state.

Phase 24-B ships the agent-visible contract; the actual PNG capture
of the MapLibre canvas lives on the frontend (24-D will wire it up).
For now the action records the request as a mutation and returns a
deterministic artifact descriptor so chat can refer to "this view"
later.
"""
from __future__ import annotations

import time
from typing import ClassVar, Optional

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import (
    AGENT_SESSION,
    MapArtifact,
    MapMutation,
    broadcast_map_mutation,
    build_map_output,
)


class MapSnapshot(Action):
    """Ask the renderer to snapshot its current view."""

    name: ClassVar[str] = "map.snapshot"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    label: Optional[str] = Field(
        default=None,
        max_length=120,
        description="Human-friendly tag attached to the snapshot.",
    )
    include_layers: bool = Field(default=True)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from geo import get_attribution_store

        active_ids: list[str] = []
        if self.include_layers:
            active_ids = get_attribution_store().active_ids(session_id=AGENT_SESSION)

        snapshot_id = f"snap-{int(t0*1000)}"
        mutation = MapMutation(
            op="snapshot",
            target=snapshot_id,
            payload={
                "snapshot_id": snapshot_id,
                "label": self.label,
                "active_layer_ids": active_ids,
                "task_id": ctx.task_id,
                "step_idx": ctx.step_idx,
            },
        )
        narrative = (
            f"Запросив знімок мапи (#{snapshot_id})."
            if self.label is None else
            f"Запросив знімок мапи: {self.label}."
        )
        await broadcast_map_mutation(mutation, narrative=narrative)
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                artifacts=[
                    MapArtifact(
                        kind="screenshot",
                        label=self.label or snapshot_id,
                        payload={
                            "snapshot_id": snapshot_id,
                            "active_layer_ids": active_ids,
                        },
                    )
                ],
                extras={"snapshot_id": snapshot_id},
            ),
            side_effects=[f"snapshot_requested:{snapshot_id}"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
