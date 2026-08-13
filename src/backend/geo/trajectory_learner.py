"""
Phase 25 — Trajectory Pattern Learning.
Identifies anchor points (Home, Work, Frequent) from location history.
"""
import json
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple
from sqlalchemy import select
from db.models import TrajectoryPattern
# `AsyncSessionLocal` is the name db.database actually exports; the old
# `SessionLocal` made this whole module unimportable at runtime.
from db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

class TrajectoryLearner:
    def __init__(self, user_id: str):
        self.user_id = user_id

    async def learn_patterns(self):
        """Analyzes location history and updates learned patterns."""
        # TODO: Query LocationHistory (Track points) from DB
        # For now, this is a stub for the reasoning engine.
        logger.info(f"Learning trajectory patterns for user {self.user_id}")
        
        # Simple heuristic: if we find a cluster of points with high dwell time
        # during the night, it's 'Home'. During day, it's 'Work' or 'Frequent'.
        
        async with AsyncSessionLocal() as db:
            # Check if we already have Home/Work
            result = await db.execute(
                select(TrajectoryPattern).where(TrajectoryPattern.user_id == self.user_id)
            )
            existing = result.scalars().all()
            
            if not existing:
                # Seed some initial patterns if data is available
                # (In a real implementation, we'd run a clustering algorithm here)
                pass

    def _cluster_points(self, points: List[Tuple[float, float, datetime]]) -> List[Dict[str, Any]]:
        """Simple clustering algorithm (grid-based)."""
        # grid size ~ 100m
        grid = {}
        for lat, lon, ts in points:
            key = (round(lat, 4), round(lon, 4))
            if key not in grid:
                grid[key] = []
            grid[key].append(ts)
            
        clusters = []
        for key, times in grid.items():
            if len(times) > 10: # Minimum points to form a cluster
                clusters.append({
                    "lat": key[0],
                    "lon": key[1],
                    "count": len(times),
                    "dwell_hours": self._estimate_dwell(times)
                })
        return clusters

    def _estimate_dwell(self, times: List[datetime]) -> float:
        # Simple estimate of total time spent
        return len(times) * (5 / 60) # assuming 5 min samples
