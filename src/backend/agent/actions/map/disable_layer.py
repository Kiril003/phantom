"""map.disable_layer — deactivate a layer in the agent's session."""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import AGENT_SESSION, MapMutation, broadcast_map_mutation, build_map_output


class MapDisableLayer(Action):
    """Remove `layer_id` from the agent's active layer set."""

    name: ClassVar[str] = "map.disable_layer"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    layer_id: str = Field(..., min_length=1, max_length=64)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from geo import get_attribution_store, get_layer_registry

        registry = get_layer_registry()
        if not registry.has(self.layer_id):
            return ActionResult(
                ok=False,
                output={
                    "narrative": f"Шару {self.layer_id!r} немає в реєстрі.",
                    "reason": "unknown_layer",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        store = get_attribution_store()
        was_active = store.disable(self.layer_id, session_id=AGENT_SESSION)
        manifest = registry.get(self.layer_id)
        mutation = MapMutation(
            op="disable_layer",
            target=self.layer_id,
            payload={"layer_id": self.layer_id},
        )
        narrative = (
            f"Вимкнув шар «{manifest.name_ua}»."
            if was_active else
            f"Шар «{manifest.name_ua}» і так не був активний."
        )
        await broadcast_map_mutation(mutation, narrative=narrative)
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                extras={
                    "was_active": was_active,
                    "active_layer_ids": store.active_ids(session_id=AGENT_SESSION),
                },
            ),
            side_effects=[f"layer_disabled:{self.layer_id}"] if was_active else [],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
