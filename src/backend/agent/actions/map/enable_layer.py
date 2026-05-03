"""map.enable_layer — activate a layer in the agent's session."""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import AGENT_SESSION, MapMutation, broadcast_map_mutation, build_map_output


class MapEnableLayer(Action):
    """Add `layer_id` to the agent's active layer set."""

    name: ClassVar[str] = "map.enable_layer"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    layer_id: str = Field(..., min_length=1, max_length=64)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from geo import get_attribution_store, get_layer_registry
        from geo.layer_registry import LayerNotFoundError

        registry = get_layer_registry()
        try:
            manifest = registry.get(self.layer_id)
        except LayerNotFoundError:
            return ActionResult(
                ok=False,
                output={
                    "narrative": f"Шару {self.layer_id!r} немає в реєстрі.",
                    "reason": "unknown_layer",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        if manifest.require_root and ctx.extras.get("role") not in ("ROOT", None):
            # ``role`` may be unset (legacy callsites) — only block when
            # we can prove the caller is non-ROOT.
            return ActionResult(
                ok=False,
                output={
                    "narrative": f"Шар {self.layer_id} доступний лише ROOT.",
                    "reason": "require_root",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        store = get_attribution_store()
        activation = store.enable(self.layer_id, session_id=AGENT_SESSION, via="agent")
        mutation = MapMutation(
            op="enable_layer",
            target=self.layer_id,
            payload={
                "layer_id": self.layer_id,
                "name_ua": manifest.name_ua,
                "category": manifest.category.value,
                "attribution": manifest.attribution,
            },
        )
        narrative = f"Увімкнув шар «{manifest.name_ua}»."
        await broadcast_map_mutation(mutation, narrative=narrative)
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                extras={
                    "active_layer_ids": store.active_ids(session_id=AGENT_SESSION),
                    "via": activation.via,
                },
            ),
            side_effects=[f"layer_enabled:{self.layer_id}"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
