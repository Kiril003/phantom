"""Що цей ПК здатен спекти — поміряно, а не припущено."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from security.auth import TokenPayload, require_auth

router = APIRouter(prefix="/bake", tags=["bake"])


@router.get("/capability")
async def bake_capability(_token: TokenPayload = Depends(require_auth)) -> dict[str, Any]:
    """Стеля цієї машини: місто → область → країна.

    Диск міряється там, де пакети справді лежатимуть; памʼять — доступна, не
    встановлена; docker — спробою достукатись до демона. Те, що поміряти не
    вдалось, знімає обсяг, а не додає його.
    """
    from geo.bake_capability import probe_bake_capability

    return await probe_bake_capability()
