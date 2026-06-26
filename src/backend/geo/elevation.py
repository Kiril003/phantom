"""
Phase 24-O — Elevation service.
Provides elevation data for coordinates and profiles for routes.
"""
import logging
import math
from typing import List, Tuple
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class ElevationSample(BaseModel):
    distance_m: float
    elevation_m: float

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points on the earth in meters."""
    R = 6371000  # Radius of earth in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

class ElevationService:
    async def get_elevation(self, lat: float, lon: float) -> float:
        """Fetch elevation for a single point.
        Currently returns a baseline + pseudo-random noise until DEM is integrated.
        """
        # Baseline elevation in UA (approx 150m) + noise based on coordinates
        return 150.0 + (math.sin(lat * 100) + math.cos(lon * 100)) * 50.0

    async def get_profile(self, points: List[Tuple[float, float]]) -> List[ElevationSample]:
        """Compute elevation profile along a path."""
        profile = []
        total_dist = 0.0
        
        for i in range(len(points)):
            lat, lon = points[i]
            if i > 0:
                prev_lat, prev_lon = points[i-1]
                total_dist += haversine_m(prev_lat, prev_lon, lat, lon)
            
            elev = await self.get_elevation(lat, lon)
            profile.append(ElevationSample(distance_m=round(total_dist, 1), elevation_m=round(elev, 1)))
            
        return profile

_service: ElevationService | None = None

def get_elevation_service() -> ElevationService:
    global _service
    if _service is None:
        _service = ElevationService()
    return _service
