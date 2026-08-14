"""
Phase 24-O — Elevation service.
Provides elevation data for coordinates and profiles for routes.
"""
import logging
import math
from typing import List, Protocol, Tuple
from pydantic import BaseModel

logger = logging.getLogger(__name__)

#: Тут стояло `150.0 + (sin(lat*100) + cos(lon*100)) * 50.0` — вигаданий рельєф,
#: що виходив назовні як вимір. Хибна висота в тактичному продукті гірша за її
#: відсутність: за нею планують перехід через хребет, якого немає.
ELEVATION_UNAVAILABLE = (
    "Даних про висоту немає: DEM не встановлено / "
    "No elevation data: DEM not installed"
)


class ElevationUnavailable(RuntimeError):
    """Джерела висот немає — відповіді не буде."""

    def __init__(self, message: str = ELEVATION_UNAVAILABLE) -> None:
        super().__init__(message)


class ElevationSample(BaseModel):
    distance_m: float
    elevation_m: float


class ElevationSource(Protocol):
    """Реальний DEM. Мусить кидати ElevationUnavailable там, де тайла немає."""

    async def sample(self, lat: float, lon: float) -> float: ...


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points on the earth in meters."""
    R = 6371000  # Radius of earth in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class ElevationService:
    def __init__(self, source: ElevationSource | None = None) -> None:
        self._source = source

    @property
    def available(self) -> bool:
        return self._source is not None

    async def get_elevation(self, lat: float, lon: float) -> float:
        """Fetch elevation for a single point."""
        if self._source is None:
            raise ElevationUnavailable()
        return await self._source.sample(lat, lon)

    async def get_profile(self, points: List[Tuple[float, float]]) -> List[ElevationSample]:
        """Compute elevation profile along a path."""
        if self._source is None:
            raise ElevationUnavailable()

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
