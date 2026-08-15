"""map.snapshot — record the current viewport / layer state.

PNG capture of the MapLibre canvas has never been wired end-to-end:
no frontend code renders `map.getCanvas().toDataURL()`, and this
action has no way to know the live camera position (center/zoom),
which only exists client-side. What it CAN honestly do — and what it
does — is record the layers the agent itself has enabled server-side
and hand that off as a mutation; the frontend bridge (
``useMapAgentBridge.ts``) attaches the browser's own live camera
state to it and keeps the pair as a referenceable bookmark
(``mapStore.lastSnapshot``, ``hasImage: false``). The narrative below
says exactly that — no image, a state bookmark — instead of implying
a picture now exists.
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
        # Honest, not "requested a photo that never arrives": this saves a
        # bookmark (active layers + whatever camera state the browser adds
        # on receipt), not an image. Say so — a snapshot verb that implies
        # a picture and never produces one is the exact silent-success
        # defect this action used to be.
        narrative = (
            f"Зберіг стан мапи (#{snapshot_id}): {len(active_ids)} активних шарів. "
            "Зображення не знімається — цю можливість ще не підключено."
            if self.label is None else
            f"Зберіг стан мапи «{self.label}» (#{snapshot_id}): {len(active_ids)} активних шарів. "
            "Зображення не знімається — цю можливість ще не підключено."
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
