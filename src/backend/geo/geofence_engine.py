"""
Phase 24-I — Geofence engine.
Checks location snapshots against registered geofences.
"""
import json
import logging
from typing import List, Dict, Any, Optional
from shapely.geometry import Point, Polygon
from db.models import Geofence

logger = logging.getLogger(__name__)

class GeofenceEngine:
    @staticmethod
    def is_inside(lat: float, lon: float, geofence: Geofence) -> bool:
        geom = json.loads(geofence.geometry_json)
        p = Point(lon, lat)
        
        if geofence.kind == "circle":
            center_lat = geom.get("lat")
            center_lon = geom.get("lon")
            radius_m = geom.get("radius_m", 100)
            
            # Simple Haversine or distance check
            # For brevity in this phase, using a simple approx distance
            # (1 deg lat ~ 111km)
            dist_deg = ((lat - center_lat)**2 + (lon - center_lon)**2)**0.5
            dist_m = dist_deg * 111000
            return dist_m <= radius_m
            
        elif geofence.kind == "polygon":
            points = geom.get("points", [])
            if len(points) < 3:
                return False
            poly = Polygon(points)
            return poly.contains(p)
            
        return False

    async def process_location(self, user_id: str, lat: float, lon: float, db_session):
        # TODO: Implement stateful tracking to detect enter/exit transitions
        pass
