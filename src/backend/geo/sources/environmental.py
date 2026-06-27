"""
Phase 24-P — Environmental sources (AQI, FIRMS).
"""
import logging
from typing import List, Any
import httpx

logger = logging.getLogger(__name__)

class EnvironmentalAdapter:
    def __init__(self, waqi_token: str = None, firms_key: str = None):
        self.waqi_token = waqi_token
        self.firms_key = firms_key

    async def fetch_aqi(self, lat: float, lon: float) -> dict:
        """Fetch AQI from WAQI API."""
        if not self.waqi_token:
            return {}
        url = f"https://api.waqi.info/feed/geo:{lat};{lon}/?token={self.waqi_token}"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url)
            return resp.json()

    @staticmethod
    def parse_open_meteo_aqi(payload: dict) -> "float | None":
        """Extract US AQI from an Open-Meteo air-quality response."""
        try:
            val = (payload or {}).get("current", {}).get("us_aqi")
            return float(val) if val is not None else None
        except (TypeError, ValueError):
            return None

    async def fetch_us_aqi(self, lat: float, lon: float, *, timeout_s: float = 6.0) -> "float | None":
        """Fetch the current US AQI by location from Open-Meteo (keyless, free).
        Returns None on any failure — air quality is best-effort context."""
        url = ("https://air-quality-api.open-meteo.com/v1/air-quality"
               f"?latitude={lat}&longitude={lon}&current=us_aqi")
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                return self.parse_open_meteo_aqi(resp.json())
        except Exception as exc:
            logger.debug("Open-Meteo AQI fetch failed: %s", exc)
            return None

    async def fetch_fires(self, bbox: List[float]) -> List[dict]:
        """Fetch active fires from NASA FIRMS."""
        # TODO: Implement NASA FIRMS API call
        return []
