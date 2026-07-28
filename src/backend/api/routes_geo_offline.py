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

from fastapi import Request, Response
from fastapi.responses import StreamingResponse
import os

@router.get("/tiles/{region_id}.pmtiles")
async def serve_pmtiles_file(region_id: str, request: Request):
    """Serve a local PMTiles file with HTTP Range request support."""
    region = _mgr.get_region(region_id)
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")
    
    file_path = region.file_path
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File missing")
    
    file_size = os.path.getsize(file_path)
    
    range_header = request.headers.get("Range")
    if range_header:
        # PMTiles typically sends ranges like 'bytes=0-16383'
        try:
            byte_range = range_header.replace("bytes=", "").split("-")
            start = int(byte_range[0])
            end = int(byte_range[1]) if byte_range[1] else file_size - 1
            if start >= file_size or end >= file_size:
                return Response(status_code=416)  # Range Not Satisfiable
            
            chunk_size = end - start + 1
            
            def file_chunk_generator():
                with open(file_path, "rb") as f:
                    f.seek(start)
                    yield f.read(chunk_size)
            
            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": "application/octet-stream",
            }
            return StreamingResponse(file_chunk_generator(), status_code=206, headers=headers)
        except Exception as e:
            logger.error(f"Error serving PMTiles range: {e}")
            raise HTTPException(status_code=400, detail="Invalid Range header")
    else:
        # No range requested, return the whole file
        def full_file_generator():
            with open(file_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk
                    
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": "application/octet-stream",
        }
        return StreamingResponse(full_file_generator(), status_code=200, headers=headers)
