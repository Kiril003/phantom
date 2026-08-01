import asyncio
import random
import time
from typing import List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter()

class TelemetryEntity(BaseModel):
    id: str
    latitude: float
    longitude: float
    elevation: float
    heading: float
    velocity: float
    timestamp: float

def generate_initial_entities(num_entities: int = 1000) -> List[TelemetryEntity]:
    entities = []
    for i in range(num_entities):
        entities.append(TelemetryEntity(
            id=f"drone-{i:04d}",
            latitude=37.7749 + (random.random() - 0.5) * 0.1,
            longitude=-122.4194 + (random.random() - 0.5) * 0.1,
            elevation=100.0 + random.random() * 50.0,
            heading=random.random() * 360.0,
            velocity=5.0 + random.random() * 15.0,
            timestamp=time.time()
        ))
    return entities

def update_entities(entities: List[TelemetryEntity]):
    current_time = time.time()
    for entity in entities:
        # Slowly drift
        entity.latitude += (random.random() - 0.5) * 0.0001
        entity.longitude += (random.random() - 0.5) * 0.0001
        entity.elevation += (random.random() - 0.5) * 0.5
        
        # Keep elevation > 0
        if entity.elevation < 0:
            entity.elevation = 0.0
            
        entity.heading = (entity.heading + (random.random() - 0.5) * 10.0) % 360.0
        entity.timestamp = current_time

@router.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket):
    await websocket.accept()
    
    entities = generate_initial_entities(1000)
    
    try:
        while True:
            update_entities(entities)
            
            # Send batch as JSON
            data = [entity.model_dump() for entity in entities]
            
            await websocket.send_json(data)
            
            # 10 times per second = 100ms
            await asyncio.sleep(0.1)
            
    except WebSocketDisconnect:
        # Client disconnected normally
        pass
    except Exception as e:
        print(f"Telemetry websocket error: {e}")
