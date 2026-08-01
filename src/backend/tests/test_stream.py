import asyncio
import json
import pytest
from fastapi.testclient import TestClient
from main import app

@pytest.mark.asyncio
async def test_telemetry_websocket():
    client = TestClient(app)
    
    with client.websocket_connect("/ws/telemetry") as websocket:
        # Receive the first batch of data
        data = websocket.receive_text()
        entities = json.loads(data)
        
        # Verify it's a list
        assert isinstance(entities, list)
        
        # Verify we got 1000 items
        assert len(entities) == 1000
        
        # Verify structure of the first item
        entity = entities[0]
        assert "id" in entity
        assert "latitude" in entity
        assert "longitude" in entity
        assert "elevation" in entity
        assert "heading" in entity
        assert "velocity" in entity
        assert "timestamp" in entity
        
        # Verify drone id format
        assert entity["id"].startswith("drone-")
        
        # Receive a second batch to verify streaming works
        data2 = websocket.receive_text()
        entities2 = json.loads(data2)
        assert isinstance(entities2, list)
        assert len(entities2) == 1000
        
        # Verify timestamp advanced
        assert entities2[0]["timestamp"] >= entity["timestamp"]
