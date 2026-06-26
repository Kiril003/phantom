from __future__ import annotations

import pytest
from unittest.mock import MagicMock, AsyncMock
from memory.strategic_memory import retrieve_relevant

@pytest.mark.asyncio
async def test_scorer_trust_gating_filter(monkeypatch):
    # Mock ChromaDB client and collection
    mock_coll = MagicMock()
    mock_coll.count.return_value = 2
    
    # Return two facts:
    # 1. Fact A: disclosure_threshold = 0.8 (sensitive)
    # 2. Fact B: disclosure_threshold = 0.3 (normal)
    mock_coll.query.return_value = {
        "documents": [["Fact A (Sensitive)", "Fact B (Normal)"]],
        "ids": [["id_a", "id_b"]],
        "metadatas": [[
            {
                "user_id": "test_user",
                "disclosure_threshold": 0.8,
                "valid_until": "none",
                "valid_from": "2026-06-19T00:00:00Z",
                "recall_count": 0,
                "sentiment_score": 0.0,
            },
            {
                "user_id": "test_user",
                "disclosure_threshold": 0.3,
                "valid_until": "none",
                "valid_from": "2026-06-19T00:00:00Z",
                "recall_count": 0,
                "sentiment_score": 0.0,
            }
        ]],
        "distances": [[0.1, 0.1]]
    }
    
    mock_client = MagicMock()
    mock_client.get_collection.return_value = mock_coll
    
    import memory.strategic_memory
    monkeypatch.setattr(memory.strategic_memory, "_get_client", lambda: mock_client)

    # 1. Query with low trust level (0.5): only Fact B should be returned
    results = await retrieve_relevant(
        user_id="test_user",
        query="test",
        top_k=2,
        user_trust_level=0.5
    )
    assert len(results) == 1
    assert results[0] == "Fact B (Normal)"

    # 2. Query with high trust level (0.9): both Fact A and Fact B should be returned
    results_high = await retrieve_relevant(
        user_id="test_user",
        query="test", top_k=2,
        user_trust_level=0.9
    )
    assert len(results_high) == 2
    assert "Fact A (Sensitive)" in results_high
    assert "Fact B (Normal)" in results_high

@pytest.mark.asyncio
async def test_scorer_combined_rerank_weights(monkeypatch):
    # Test that the multi-signal score ranks recency & sentiment higher
    mock_coll = MagicMock()
    mock_coll.count.return_value = 2
    
    # Return two facts with identical semantic distance (0.1) but different recency/sentiment:
    # 1. Fact A: valid_from is very old, sentiment is 0.0
    # 2. Fact B: valid_from is brand new, sentiment is 1.0 (positive sentiment bonus)
    mock_coll.query.return_value = {
        "documents": [["Fact A (Old)", "Fact B (New and Positive)"]],
        "ids": [["id_a", "id_b"]],
        "metadatas": [[
            {
                "user_id": "test_user",
                "valid_until": "none",
                "valid_from": "2020-01-01T00:00:00Z", # Very old
                "recall_count": 0,
                "sentiment_score": 0.0,
            },
            {
                "user_id": "test_user",
                "valid_until": "none",
                "valid_from": "2026-06-19T00:00:00Z", # Brand new (recency boost)
                "recall_count": 0,
                "sentiment_score": 1.0, # Sentiment boost
            }
        ]],
        "distances": [[0.1, 0.1]]
    }
    
    mock_client = MagicMock()
    mock_client.get_collection.return_value = mock_coll
    
    import memory.strategic_memory
    monkeypatch.setattr(memory.strategic_memory, "_get_client", lambda: mock_client)

    # Fact B should rank first due to higher recency and sentiment score
    results = await retrieve_relevant(
        user_id="test_user",
        query="test",
        top_k=2,
        user_trust_level=0.5
    )
    assert len(results) == 2
    assert results[0] == "Fact B (New and Positive)"
    assert results[1] == "Fact A (Old)"
