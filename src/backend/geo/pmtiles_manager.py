"""
Phase 24-G — PMTiles manager.
Handles discovery, verification, and serving of local PMTiles archives.
"""
import os
import sqlite3
import logging
from typing import List, Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class OfflineRegion(BaseModel):
    id: str
    name: str
    file_path: str
    size_bytes: int
    mtime: float
    layers: List[str]

class PMTilesManager:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)
    
    def list_regions(self) -> List[OfflineRegion]:
        regions = []
        for f in os.listdir(self.data_dir):
            if f.endswith(".pmtiles"):
                path = os.path.join(self.data_dir, f)
                stat = os.stat(path)
                regions.append(OfflineRegion(
                    id=f.replace(".pmtiles", ""),
                    name=f.replace(".pmtiles", "").replace("_", " ").title(),
                    file_path=path,
                    size_bytes=stat.st_size,
                    mtime=stat.st_mtime,
                    layers=["base"] # TODO: extract from metadata
                ))
        return regions

    def get_region(self, region_id: str) -> Optional[OfflineRegion]:
        path = os.path.join(self.data_dir, f"{region_id}.pmtiles")
        if os.path.exists(path):
            stat = os.stat(path)
            return OfflineRegion(
                id=region_id,
                name=region_id.replace("_", " ").title(),
                file_path=path,
                size_bytes=stat.st_size,
                mtime=stat.st_mtime,
                layers=["base"]
            )
        return None
