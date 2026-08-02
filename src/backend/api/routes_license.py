from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db.models import User
from licensing import activator, enforcement, entitlements
from licensing.verifier import license_status
from security.permissions import require_root

router = APIRouter(prefix="/license", tags=["license"])


class ActivateRequest(BaseModel):
    license_key: str = Field(..., min_length=10, max_length=64)
    device_name: str = Field(default="phantom-os", max_length=80)


class DeactivateRequest(BaseModel):
    license_key: str = Field(..., min_length=10, max_length=64)


def _snapshot() -> dict:
    """Сертифікат і чинні права разом: інтерфейсу треба і те, і те, а два
    запити встигали розійтись у часі й показати рівень від старого ключа."""
    status = license_status()
    return {
        **status.as_dict(),
        "entitlement": entitlements.resolve(status).as_dict(),
        "enforced": enforcement.enforcement_enabled(),
    }


@router.get("/status")
async def api_license_status(user: User = Depends(require_root)) -> dict:
    return _snapshot()


@router.post("/activate")
async def api_license_activate(
    req: ActivateRequest, user: User = Depends(require_root)
) -> dict:
    try:
        await activator.activate(req.license_key, req.device_name)
    except activator.ActivationError as exc:
        raise HTTPException(status_code=exc.status_code or 502, detail=str(exc))
    enforcement.invalidate_cache()
    return _snapshot()


@router.post("/deactivate")
async def api_license_deactivate(
    req: DeactivateRequest, user: User = Depends(require_root)
) -> dict:
    await activator.deactivate(req.license_key)
    enforcement.invalidate_cache()
    return _snapshot()


@router.post("/revalidate")
async def api_license_revalidate(user: User = Depends(require_root)) -> dict:
    result = await activator.revalidate()
    enforcement.invalidate_cache()
    return {"checked": result["checked"], **_snapshot()}
