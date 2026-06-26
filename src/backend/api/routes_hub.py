"""Day-4 Wave-2 Z-2 — `/api/v1/hub/*` HTTP surface (ADR-HUB-005).

Two GET endpoints:

  GET /api/v1/hub/providers
    Snapshot of every registered ProviderCapability with the
    `available_now` field re-checked at request time. The Day-4 stub
    just echoes `available` from the registry; Z-3 (Day-5) will
    overlay live ai_router cooling state so the operator sees the
    *current* readiness, not the registration-time value.

  GET /api/v1/hub/route_state?limit=N
    Last N decisions from the in-memory ring (max 200). Operators use
    it to spot a route flip-flop after a config change.

Both routes are operator-facing diagnostics. They require auth like
the rest of /api/v1; the dependency is mirrored from routes_auth so
the wiring stays consistent.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ai.hub import (
    ProviderCapability,
    get_ai_hub,
    register_default_capabilities,
)
from db.database import get_session
from db.models import User
from security.auth import get_current_user

router = APIRouter(prefix="/hub", tags=["hub"])


class ProviderRow(BaseModel):
    """Wire shape mirrors `ai.hub.ProviderCapability` exactly so the
    frontend type contract can mirror it 1:1."""

    provider: str
    task_class: str
    modality: str
    latency_ms_p50: float
    quality_tier: str
    locality: str
    available: bool


class HubProvidersResponse(BaseModel):
    providers: list[ProviderRow]
    total: int = Field(..., ge=0)


class HubRouteStateResponse(BaseModel):
    decisions: list[dict[str, Any]]
    total: int = Field(..., ge=0)


def _serialise_capability(cap: ProviderCapability) -> ProviderRow:
    return ProviderRow(
        provider=cap.provider,
        task_class=cap.task_class,
        modality=cap.modality,
        latency_ms_p50=cap.latency_ms_p50,
        quality_tier=cap.quality_tier,
        locality=cap.locality,
        available=cap.available,
    )


def _ensure_default_registrations() -> None:
    """First-call seed: if the registry is empty (e.g. fresh process,
    no lifespan hook called register_default_capabilities yet), populate
    the Day-4 default 4 rows so the UI never sees an empty list. This
    is idempotent — `AIHub.register` overwrites on (provider, task_class)
    keys."""
    hub = get_ai_hub()
    if not hub.list_providers():
        register_default_capabilities(hub=hub)


@router.get("/providers", response_model=HubProvidersResponse)
async def list_providers(
    _user: User = Depends(get_current_user),
) -> HubProvidersResponse:
    """Operator-facing diagnostic. Lists every ProviderCapability
    currently registered with the AIHub."""
    _ensure_default_registrations()
    hub = get_ai_hub()
    from ai.provider import ai_router

    rows = []
    for cap in hub.list_providers():
        available_now = cap.available
        if cap.task_class in ("chat", "chat_subtask"):
            available_now = ai_router._is_provider_available(cap.provider)
        
        row = ProviderRow(
            provider=cap.provider,
            task_class=cap.task_class,
            modality=cap.modality,
            latency_ms_p50=cap.latency_ms_p50,
            quality_tier=cap.quality_tier,
            locality=cap.locality,
            available=available_now,
        )
        rows.append(row)

    return HubProvidersResponse(providers=rows, total=len(rows))


@router.get("/route_state", response_model=HubRouteStateResponse)
async def get_route_state(
    limit: int = Query(50, ge=1, le=200),
    _user: User = Depends(get_current_user),
) -> HubRouteStateResponse:
    """Last N AIHub.pick decisions from the in-memory ring.

    Day-4 ring is process-local — operators with persistent decision
    history needs subscribe to the /metrics counters (Z-3 will wire
    a `phantom_ai_hub_route_decision_total` Counter alongside the
    existing observability primitives).
    """
    hub = get_ai_hub()
    decisions = hub.route_state(limit=limit)
    return HubRouteStateResponse(decisions=decisions, total=len(decisions))


# Force the imports to be referenced so linters don't strip them; the
# session import is reserved for Z-3's dispatch path which records
# audit rows in `agent_audit_trail` per ADR-HUB-006.
_ = get_session
