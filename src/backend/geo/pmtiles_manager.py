"""
Phase 24-G — PMTiles manager.
Handles discovery, verification, serving, and deletion of local PMTiles archives.
"""
import os
import json
import gzip
import logging
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

class OfflineRegion(BaseModel):
    id: str
    name: str
    file_path: str
    size_bytes: int
    mtime: float
    layers: List[str] = Field(default_factory=lambda: ["base"])
    min_zoom: int = 0
    max_zoom: int = 14
    bounds: List[float] = Field(default_factory=lambda: [-180.0, -90.0, 180.0, 90.0])

class PMTilesManager:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)
    
    def parse_header_metadata(self, path: str) -> Dict[str, Any]:
        """Attempt to parse PMTiles v3 header metadata JSON if present."""
        meta: Dict[str, Any] = {}
        try:
            with open(path, "rb") as f:
                header = f.read(127)
                if len(header) >= 127 and header[:7] == b"PMTiles":
                    # PMTiles v3 header offsets
                    json_metadata_offset = int.from_bytes(header[8:16], "little")
                    json_metadata_length = int.from_bytes(header[16:24], "little")
                    if json_metadata_offset > 0 and json_metadata_length > 0:
                        f.seek(json_metadata_offset)
                        raw_json = f.read(json_metadata_length)
                        try:
                            meta = json.loads(gzip.decompress(raw_json).decode("utf-8"))
                        except Exception:
                            meta = json.loads(raw_json.decode("utf-8", errors="ignore"))
        except Exception as e:
            logger.debug(f"Could not parse PMTiles header for {path}: {e}")
        return meta

    def list_regions(self) -> List[OfflineRegion]:
        regions = []
        if not os.path.exists(self.data_dir):
            return regions

        for f in os.listdir(self.data_dir):
            if f.endswith(".pmtiles"):
                path = os.path.join(self.data_dir, f)
                try:
                    stat = os.stat(path)
                    meta = self.parse_header_metadata(path)
                    vector_layers = meta.get("vector_layers", [])
                    layer_ids = [l.get("id") for l in vector_layers if isinstance(l, dict) and "id" in l] or ["base"]
                    
                    regions.append(OfflineRegion(
                        id=f.replace(".pmtiles", ""),
                        name=meta.get("name") or f.replace(".pmtiles", "").replace("_", " ").title(),
                        file_path=path,
                        size_bytes=stat.st_size,
                        mtime=stat.st_mtime,
                        layers=layer_ids,
                        min_zoom=int(meta.get("minzoom", 0)),
                        max_zoom=int(meta.get("maxzoom", 14)),
                        bounds=meta.get("bounds", [-180.0, -90.0, 180.0, 90.0]),
                    ))
                except Exception as err:
                    logger.warning(f"Failed to inspect region {f}: {err}")
        return regions

    def _region_path(self, region_id: str) -> Optional[str]:
        """Шлях до регіону — лише якщо він справді лежить у теці сховища.

        `region_id` приходить із URL і йшов просто у `os.path.join`. Поки
        видалення нічого не робило, це було нешкідливо; з живим `os.remove`
        це вже стирання чужих файлів.
        """
        if not region_id or region_id in (".", ".."):
            return None
        if os.sep in region_id or (os.altsep and os.altsep in region_id):
            return None
        base = os.path.realpath(self.data_dir)
        path = os.path.realpath(os.path.join(base, f"{region_id}.pmtiles"))
        if os.path.dirname(path) != base:
            return None
        return path

    def get_region(self, region_id: str) -> Optional[OfflineRegion]:
        path = self._region_path(region_id)
        if path and os.path.exists(path):
            stat = os.stat(path)
            meta = self.parse_header_metadata(path)
            vector_layers = meta.get("vector_layers", [])
            layer_ids = [l.get("id") for l in vector_layers if isinstance(l, dict) and "id" in l] or ["base"]
            return OfflineRegion(
                id=region_id,
                name=meta.get("name") or region_id.replace("_", " ").title(),
                file_path=path,
                size_bytes=stat.st_size,
                mtime=stat.st_mtime,
                layers=layer_ids,
                min_zoom=int(meta.get("minzoom", 0)),
                max_zoom=int(meta.get("maxzoom", 14)),
                bounds=meta.get("bounds", [-180.0, -90.0, 180.0, 90.0]),
            )
        return None

    def delete_region(self, region_id: str) -> bool:
        """Permanently delete a local PMTiles region file."""
        path = self._region_path(region_id)
        if path and os.path.exists(path):
            try:
                os.remove(path)
                logger.info(f"Deleted offline PMTiles region: {region_id}")
                return True
            except OSError as e:
                logger.error(f"Failed to delete region {region_id}: {e}")
                return False
        return False

