"""
PHANTOM OS — Earcon Manager.
Triggers short audio indicators (success, blocked, thought stashed, etc.)
by broadcasting WebSocket events to the operator UI.
"""
from __future__ import annotations

import logging
import base64
import os
from typing import Optional

logger = logging.getLogger(__name__)

# Map of standard earcon names to file names
EARCON_FILES = {
    "success": "success.wav",
    "blocked": "blocked.wav",
    "thought_parked": "thought_parked.wav",
    "thought_released": "thought_released.wav",
}

async def play_earcon(name: str) -> None:
    """
    Broadcasts an earcon event over the agent.stream WebSocket.
    If the physical WAV file is found in the assets/sounds/ directory,
    it can also encode and send the base64 audio data.
    """
    logger.info("Playing earcon: %s", name)

    payload = {
        "event": "earcon",
        "name": name,
        "audio_b64": None,
    }

    # Attempt to load physical WAV file if it exists
    filename = EARCON_FILES.get(name)
    if filename:
        # Check standard paths: current directory / assets / sounds
        for base_dir in [
            "assets/sounds",
            "../assets/sounds",
            "src/backend/assets/sounds",
        ]:
            full_path = os.path.join(base_dir, filename)
            if os.path.exists(full_path):
                try:
                    with open(full_path, "rb") as f:
                        wav_bytes = f.read()
                    payload["audio_b64"] = base64.b64encode(wav_bytes).decode("ascii")
                    payload["media_type"] = "audio/wav"
                    logger.debug("Loaded physical audio bytes for earcon %s from %s", name, full_path)
                    break
                except Exception as exc:
                    logger.warning("Failed to read earcon file %s: %s", full_path, exc)

    # Deliver to operator surface over WS
    try:
        from api.websocket_hub import hub
        await hub.broadcast("agent.stream", "earcon", payload)
    except Exception as exc:
        logger.warning("Failed to broadcast earcon %s over WS: %s", name, exc)
