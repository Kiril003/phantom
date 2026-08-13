"""Ворота прав — вмикаються лише за PHANTOM_LICENSE_ENFORCE=1.

Тут була груба заслінка: без ліцензії кожен /api/ повертав 403. Під чинною
моделлю це неправильно. Вільний рівень — повноцінний продукт, а не демо: чат,
мапа, навігація, тривоги, сховище і голос працюють завжди. Тому ворота стоять
лише на кількох гілках, що належать платним рівням, і повертають 402 з назвою
права — щоб інтерфейс пояснив людині, ЩО саме закрито, а не викидав її на
екран активації посеред роботи.

Розробницькі складання і збірки з коду не гатяться: прапорець зашивається в
платний дистрибутив.
"""
from __future__ import annotations

import os
import re

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from licensing import entitlements

#: Гілка API → право, без якого вона закрита. Усе, чого тут немає, вільне.
#:
#: Кожен рядок мусить збігатися з маршрутом, який СПРАВДІ змонтовано. Тут
#: раніше стояли два, що не збігалися ні з чим, і ворота на неіснуючій адресі
#: виглядають як захист, не будучи ним:
#:
#:   /api/v1/map/offline/terrain — такого маршруту немає. `routes_geo_offline`
#:   тримає /map/offline лише з /regions, /regions/{id} і /tiles/{id}.pmtiles.
#:   Рельєф на комп'ютері малює MapLibre у браузері, тягнучи плитки terrarium
#:   просто з AWS, — запит не проходить через наш процес узагалі. Тому
#:   `map.terrain3d` СЕРВЕРНО НЕ ЗАКРИВАЄТЬСЯ, і вдавати протилежне не варто:
#:   ворота на нього мають стояти в клієнті або ніде.
#:
#:   /api/v1/analytics — це панель орендаря з єдиним /overview; вивантаження в
#:   ній немає. Справжнє живе нижче, серед маршрутів місії.
GATED_PREFIXES: tuple[tuple[str, str], ...] = (
    ("/api/v1/pair", "bridge.pair"),
)

#: Те саме, але для маршрутів зі змінним сегментом — префікс їх не ловить.
GATED_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^/api/v1/agent/mission/[^/]+/export/?$"), "export.reports"),
)


def enforcement_enabled() -> bool:
    return os.environ.get("PHANTOM_LICENSE_ENFORCE") == "1"


def invalidate_cache() -> None:
    entitlements.invalidate()


def _gate_for(path: str) -> str | None:
    for prefix, feature in GATED_PREFIXES:
        if path.startswith(prefix):
            return feature
    for pattern, feature in GATED_PATTERNS:
        if pattern.match(path):
            return feature
    return None


def _payload(feature: str, ent: entitlements.Entitlement) -> dict:
    return {
        "detail": "upgrade_required",
        "feature": feature,
        "needs_tier": entitlements.next_tier_for(feature),
        "tier": ent.tier,
        "reason": ent.reason,
    }


def require_feature(feature: str):
    """Залежність для окремого маршруту, коли гілки замало."""

    async def _dep() -> entitlements.Entitlement:
        ent = entitlements.cached()
        if not enforcement_enabled() or ent.has(feature):
            return ent
        raise HTTPException(status_code=402, detail=_payload(feature, ent))

    return Depends(_dep)


def install_enforcement(app: FastAPI) -> None:
    @app.middleware("http")
    async def _phantom_feature_gate(request: Request, call_next):
        if not enforcement_enabled() or request.method == "OPTIONS":
            return await call_next(request)
        feature = _gate_for(request.url.path)
        if feature is None:
            return await call_next(request)
        ent = entitlements.cached()
        if ent.has(feature):
            return await call_next(request)
        return JSONResponse(status_code=402, content=_payload(feature, ent))
