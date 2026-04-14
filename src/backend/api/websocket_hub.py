"""
WebSocket Hub — multiplexed channel manager.
One WS connection per client, routed by 'channel' field.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from typing import Any, Callable, Coroutine

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

Channel = str
MessageHandler = Callable[[str, dict[str, Any], "WSClient"], Coroutine[Any, Any, None]]


def _sanitize(obj: Any) -> Any:
    """Replace non-finite floats with None so json.dumps never emits Infinity/NaN."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj


class WSClient:
    def __init__(self, ws: WebSocket, client_id: str, user_id: str | None = None):
        self.ws = ws
        self.client_id = client_id
        self.user_id = user_id
        self._connected = True

    async def send(self, channel: Channel, type_: str, data: dict[str, Any]) -> None:
        if not self._connected:
            return
        try:
            msg = {"channel": channel, "type": type_, "data": data, "ts": int(time.time() * 1000)}
            await self.ws.send_text(json.dumps(_sanitize(msg)))
        except Exception as exc:
            logger.debug("WS send error: %s", exc)
            self._connected = False

    async def close(self) -> None:
        self._connected = False
        try:
            await self.ws.close()
        except Exception:
            pass


class WebSocketHub:
    """Central multiplexer for all WebSocket channels."""

    def __init__(self) -> None:
        self._clients: dict[str, WSClient] = {}
        self._handlers: dict[Channel, list[MessageHandler]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, client_id: str, user_id: str | None = None) -> WSClient:
        await ws.accept()
        client = WSClient(ws, client_id, user_id)
        async with self._lock:
            self._clients[client_id] = client
        logger.info("WS client connected: %s (user=%s)", client_id, user_id)
        return client

    async def disconnect(self, client_id: str) -> None:
        async with self._lock:
            client = self._clients.pop(client_id, None)
        if client:
            await client.close()
            logger.info("WS client disconnected: %s", client_id)

    def on(self, channel: Channel, handler: MessageHandler) -> None:
        self._handlers.setdefault(channel, []).append(handler)

    async def broadcast(
        self,
        channel: Channel,
        type_: str,
        data: dict[str, Any],
        user_id: str | None = None,
    ) -> None:
        """Broadcast to all clients (or to specific user if user_id provided)."""
        async with self._lock:
            targets = list(self._clients.values())

        tasks = []
        for client in targets:
            if user_id is None or client.user_id == user_id:
                tasks.append(client.send(channel, type_, data))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        # Cleanup disconnected
        disconnected = [c.client_id for c in targets if not c._connected]
        for cid in disconnected:
            async with self._lock:
                self._clients.pop(cid, None)

    async def handle_client(self, client: WSClient) -> None:
        """Main receive loop for a connected client."""
        try:
            while True:
                raw = await client.ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                channel = msg.get("channel")
                type_ = msg.get("type", "")
                data = msg.get("data", {})

                if not channel:
                    continue

                handlers = self._handlers.get(channel, [])
                for handler in handlers:
                    try:
                        await handler(type_, data, client)
                    except Exception as exc:
                        logger.error("Channel handler error [%s/%s]: %s", channel, type_, exc)

        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.error("WS receive error: %s", exc)
        finally:
            await self.disconnect(client.client_id)

    @property
    def client_count(self) -> int:
        return len(self._clients)


# Singleton hub
hub = WebSocketHub()
