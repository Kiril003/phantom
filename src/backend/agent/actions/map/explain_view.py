"""map.explain_view — narrate the current viewport via the AI provider.

Cached by viewport-hash through the existing :class:`geo.MapCache` so
repeated calls don't burn LLM tokens. The cache key combines the
bbox, the active layer set, and the language so a translation toggle
re-derives.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import ClassVar, Optional

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import AGENT_SESSION, MapMutation, broadcast_map_mutation, build_map_output


def _viewport_key(bbox: list[float], active: list[str], lang: str) -> str:
    raw = json.dumps(
        {"bbox": [round(v, 4) for v in bbox], "active": sorted(active), "lang": lang},
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


class MapExplainView(Action):
    """Ask Gemini/Ollama to summarise what the operator is looking at."""

    name: ClassVar[str] = "map.explain_view"
    # Outbound LLM call — LOW so the planner counts tokens; not SAFE.
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    bbox: list[float] = Field(
        ...,
        min_length=4,
        max_length=4,
        description="[lat_min, lon_min, lat_max, lon_max].",
    )
    language: str = Field(default="uk", max_length=5)
    extra_hint: Optional[str] = Field(
        default=None,
        max_length=240,
        description="Extra context the operator wants the AI to weigh.",
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        # Validate bbox shape early — Pydantic only checks length.
        lat_min, lon_min, lat_max, lon_max = self.bbox
        if not (-90.0 <= lat_min <= lat_max <= 90.0 and -180.0 <= lon_min <= lon_max <= 180.0):
            return ActionResult(
                ok=False,
                output={
                    "narrative": "Невалідний bbox.",
                    "reason": "bad_bbox",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        from geo import get_attribution_store, get_map_cache

        active = get_attribution_store().active_ids(session_id=AGENT_SESSION)
        cache = get_map_cache()
        key = _viewport_key(self.bbox, active, self.language)

        async def _produce() -> dict:
            try:
                from ai.provider import get_ai_provider  # type: ignore[attr-defined]
                provider = get_ai_provider()
            except Exception as exc:
                return {
                    "narrative": (
                        "AI-провайдер недоступний — описати огляд не зможу."
                    ),
                    "reason": "no_provider",
                    "error": str(exc),
                }
            prompt = (
                "Стисло опиши, що цікавого у даному квадраті мапи "
                f"[{lat_min:.4f},{lon_min:.4f}]–[{lat_max:.4f},{lon_max:.4f}] "
                f"враховуючи активні шари: {', '.join(active) or 'базовий'}. "
                + (f"Підказка користувача: {self.extra_hint}. " if self.extra_hint else "")
                + f"Відповідь {self.language}, до 3 речень."
            )
            try:
                text = await provider.complete(prompt)  # type: ignore[attr-defined]
                return {"narrative": str(text).strip(), "active": active}
            except Exception as exc:
                return {
                    "narrative": "AI не зміг описати огляд.",
                    "reason": "provider_error",
                    "error": str(exc),
                }

        try:
            cached = await cache.get_or_fetch(
                "explain_view",
                key,
                _produce,
                ttl_s=600.0,
            )
        except Exception as exc:
            cached = {"narrative": "Помилка під час опису огляду.", "error": str(exc)}

        narrative = cached.get("narrative") or "Без коментарів."
        mutation = MapMutation(
            op="narrate",
            target="explain_view",
            payload={"bbox": self.bbox, "active": active, "key": key},
        )
        await broadcast_map_mutation(mutation, narrative=narrative)
        return ActionResult(
            ok="error" not in cached,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                extras={"cache_key": key, "active_layer_ids": active},
            ),
            side_effects=[],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
