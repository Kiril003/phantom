"""License gate middleware — active only when PHANTOM_LICENSE_ENFORCE=1.

Dev boards and source checkouts run unrestricted; the flag is baked into the
paid distribution (image/installer), so the gate never surprises a developer.
Unlicensed requests get 403 {"detail": "license_required"} so the frontend
can route to the activation screen; auth and license routes stay open so the
user can actually activate.
"""

import os
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from licensing.verifier import LicenseStatus, license_status

ALLOWED_PREFIXES = (
    "/api/v1/auth",
    "/api/v1/license",
    "/health",
    "/docs",
    "/openapi.json",
    "/redoc",
)
_CACHE_TTL_S = 10.0
_cache: tuple[float, LicenseStatus] | None = None


def enforcement_enabled() -> bool:
    return os.environ.get("PHANTOM_LICENSE_ENFORCE") == "1"


def _cached_status() -> LicenseStatus:
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[0] < _CACHE_TTL_S:
        return _cache[1]
    status = license_status()
    _cache = (now, status)
    return status


def invalidate_cache() -> None:
    global _cache
    _cache = None


def install_enforcement(app: FastAPI) -> None:
    @app.middleware("http")
    async def _phantom_license_gate(request: Request, call_next):
        if not enforcement_enabled() or request.method == "OPTIONS":
            return await call_next(request)
        path = request.url.path
        if not path.startswith("/api/") or path.startswith(ALLOWED_PREFIXES):
            return await call_next(request)
        status = _cached_status()
        if status.valid:
            return await call_next(request)
        return JSONResponse(
            status_code=403,
            content={"detail": "license_required", "reason": status.reason},
        )
