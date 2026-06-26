"""
Phase 24-G — Map Offline Region routes.
"""
from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from security.auth import require_auth
from security.jwt_manager import TokenPayload
from geo.pmtiles_manager import PMTilesManager, OfflineRegion
from paths import resolve_data_dir

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/map/offline", tags=["map", "offline"])

# Initialize manager with default path
_mgr = PMTilesManager(str(resolve_data_dir("geo/offline")))

class OfflineRegionsResponse(BaseModel):
    regions: List[OfflineRegion]
    total: int
    capacity_bytes: int
    used_bytes: int

@router.get("/regions", response_model=OfflineRegionsResponse)
async def list_offline_regions(
    auth: TokenPayload = Depends(require_auth)
):
    """List all locally available PMTiles regions."""
    regions = _mgr.list_regions()
    used = sum(r.size_bytes for r in regions)
    # Assume 256GB SSD budget as per spec, minus some safety margin
    capacity = 200 * 1024 * 1024 * 1024 
    
    return OfflineRegionsResponse(
        regions=regions,
        total=len(regions),
        capacity_bytes=capacity,
        used_bytes=used
    )

@router.get("/regions/{region_id}", response_model=OfflineRegion)
async def get_offline_region(
    region_id: str,
    auth: TokenPayload = Depends(require_auth)
):
    """Get details for a specific offline region."""
    region = _mgr.get_region(region_id)
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")
    return region

@router.delete("/regions/{region_id}")
async def delete_offline_region(
    region_id: str,
    auth: TokenPayload = Depends(require_auth)
):
    """Delete a local PMTiles region."""
    # TODO: implement actual deletion in PMTilesManager
    return {"ok": True, "message": f"Region {region_id} deletion requested"}
