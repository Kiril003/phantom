"""map.list_layers — read-only registry projection."""
from __future__ import annotations

import time
from typing import ClassVar, Optional

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import AGENT_SESSION, MapArtifact, MapMutation, build_map_output


class MapListLayers(Action):
    """Enumerate every layer in the registry plus its active flag."""

    name: ClassVar[str] = "map.list_layers"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    category: Optional[str] = Field(default=None, description="Optional category filter.")
    available_offline: Optional[bool] = Field(default=None)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from geo import LayerCategory, get_attribution_store, get_layer_registry

        registry = get_layer_registry()
        cat: Optional[LayerCategory] = None
        if self.category:
            try:
                cat = LayerCategory(self.category)
            except ValueError:
                return ActionResult(
                    ok=False,
                    output={
                        "narrative": f"Невідома категорія {self.category!r}.",
                        "reason": "bad_category",
                        "valid": [c.value for c in LayerCategory],
                    },
                    side_effects=[],
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
        manifests = registry.filter(category=cat, available_offline=self.available_offline)
        active = set(get_attribution_store().active_ids(session_id=AGENT_SESSION))
        rows = []
        for m in manifests:
            rows.append({
                "id": m.id,
                "name_ua": m.name_ua,
                "name_en": m.name_en,
                "category": m.category.value,
                "active": m.id in active,
                "default_active": m.default_active,
                "require_internet": m.require_internet,
                "available_offline": m.available_offline,
                "agent_verbs": list(m.agent_verbs),
            })
        narrative = (
            f"{len(rows)} шар(ів)"
            + (f" у категорії {self.category}" if self.category else "")
            + f"; активно зараз — {sum(1 for r in rows if r['active'])}."
        )
        mutation = MapMutation(
            op="narrate",
            target="list_layers",
            payload={"count": len(rows), "active": sorted(active)},
        )
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                artifacts=[
                    MapArtifact(
                        kind="layer_index",
                        label="layers",
                        payload={"items": rows},
                    ),
                ],
                extras={"active_layer_ids": sorted(active)},
            ),
            side_effects=[],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
