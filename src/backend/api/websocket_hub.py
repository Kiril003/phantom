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
    def __init__(
        self,
        ws: WebSocket,
        client_id: str,
        user_id: str | None = None,
        profile_id: str | None = None,
    ):
        self.ws = ws
        self.client_id = client_id
        self.user_id = user_id
        # Хто саме на дроті. Панель паринга показує «на зв'язку» лише тоді,
        # коли з'єднання справді тримає цей пристрій, а не будь-хто з
        # користувачів. None — це робочий стіл.
        self.device_id: str | None = None
        # Phase 1-B (companion-v2) — companion phones subscribe under a
        # specific Profile. Desktop clients leave this None and fall
        # through the legacy user-scope filter unchanged. See
        # `WebSocketHub.broadcast` for the precedence rules.
        self.profile_id = profile_id
        self._connected = True
        # Phase 19-6 (Mobile Companion design §6) — channel subscription
        # filter. `None` = receive every channel (the desktop default,
        # backward-compatible with all callers that predate this field).
        # A `set[str]` = receive ONLY the listed channels. The phone
        # opts into this to skip high-volume traffic like `agent.stream`
        # raw step logs while still getting `sensor` + `state` + `pair`.
        self.channels: set[str] | None = None

    def wants(self, channel: Channel) -> bool:
        """Should this client receive a broadcast on `channel`?

        Returns True for legacy clients (`channels is None`) so existing
        desktop subscribers keep behaving the way they used to. Mobile
        clients narrow the set via the `subscribe` control message.
        """
        if self.channels is None:
            return True
        return channel in self.channels

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

    async def connect(
        self,
        ws: WebSocket,
        client_id: str,
        user_id: str | None = None,
        profile_id: str | None = None,
        subprotocol: str | None = None,
    ) -> WSClient:
        # `subprotocol` треба підтвердити дослівно: браузер рве зʼєднання,
        # якщо сервер не обрав жодного із запропонованих ним. None — це
        # старий шлях (`?token=` або зовсім без токена).
        await ws.accept(subprotocol=subprotocol)
        client = WSClient(ws, client_id, user_id, profile_id)
        async with self._lock:
            self._clients[client_id] = client
        logger.info(
            "WS client connected: %s (user=%s profile=%s)",
            client_id,
            user_id,
            profile_id,
        )
        return client

    async def disconnect(self, client_id: str) -> None:
        async with self._lock:
            client = self._clients.pop(client_id, None)
        if client:
            # Phase 32-VISION: stop vision stream if client was subscribed
            if client.channels and "vision" in client.channels:
                from api.vision_streamer import streamer
                await streamer.stop()
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
        profile_id: str | None = None,
    ) -> None:
        """Broadcast to all clients, optionally narrowed by user / profile.

        Filter precedence (most-specific filter wins):
          • ``profile_id`` set → only clients whose own ``profile_id``
            matches receive. Companion-v2 phones use this to keep
            persona-scoped traffic out of sibling profiles on the same
            device tree (Phase 1-B).
          • ``user_id`` set → all clients of that user receive,
            regardless of profile. This is the legacy desktop scope
            and stays byte-equivalent to the pre-Phase-1-B behaviour.
          • Both unset → fan out to every connected client.
        """
        # Day-4 V-6 (ADR-RTP-002): WS broadcast fan-out latency histogram.
        # Observed end-to-end: lock-snapshot + per-client send gather +
        # disconnected cleanup. Closes audit U8-PERF-M1.
        import time as _time
        _t0 = _time.monotonic()
        async with self._lock:
            targets = list(self._clients.values())

        tasks = []
        for client in targets:
            if profile_id is not None and client.profile_id != profile_id:
                continue
            if user_id is not None and client.user_id != user_id:
                continue
            # Phase 19-6 — respect per-client channel subscription. The
            # `wants` predicate returns True for legacy clients, so this
            # is a no-op for the desktop fan-out that's been running
            # unchanged since phase-2.
            if not client.wants(channel):
                continue
            tasks.append(client.send(channel, type_, data))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        # Cleanup disconnected
        disconnected = [c.client_id for c in targets if not c._connected]
        for cid in disconnected:
            async with self._lock:
                self._clients.pop(cid, None)
        try:
            from observability import ws_broadcast_latency_ms
            ws_broadcast_latency_ms.observe(
                (_time.monotonic() - _t0) * 1000.0
            )
        except Exception:  # noqa: BLE001
            # Observability never blocks the broadcast.
            pass

    async def handle_client(self, client: WSClient) -> None:
        """Main receive loop for a connected client."""
        try:
            while True:
                raw = await client.ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                # Phase 19-6 — control messages live OUT-OF-BAND of the
                # channel routing system. They look like
                # `{"control": "subscribe", "channels": [...]}` and
                # never invoke channel handlers. The phone uses this to
                # opt into a narrow set of channels (saves battery +
                # bandwidth); desktop clients can ignore the protocol
                # entirely and receive everything as before.
                control = msg.get("control")
                if control:
                    await self._handle_control(client, control, msg)
                    continue

                channel = msg.get("channel")
                type_ = msg.get("type", "")
                data = msg.get("data", {})

                logger.debug("WS incoming: channel=%s type=%s data=%r", channel, type_, data)

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

    async def _handle_control(
        self,
        client: WSClient,
        control: str,
        msg: dict[str, Any],
    ) -> None:
        """Phase 19-6 — apply a `subscribe` / `unsubscribe` control msg.

        Protocol (per docs/MOBILE_COMPANION.md §6):

            client → server: {"control": "subscribe",   "channels": [...]}
            client → server: {"control": "unsubscribe", "channels": [...]}
            client → server: {"control": "subscribe_all"}    # back to default

        On success the server echoes a `_meta/subscribed` message back
        on the special `_meta` channel so the client can confirm. We
        deliberately bypass the `wants` filter for this echo (it lives
        outside the channel routing) — otherwise a client that just
        subscribed to nothing could never see its own ack.
        """
        channels = msg.get("channels") or []
        if not isinstance(channels, list):
            channels = []
        # Coerce to clean str set, drop empties.
        wanted: set[str] = {c for c in channels if isinstance(c, str) and c}

        if control == "subscribe":
            current = client.channels if client.channels is not None else set()
            client.channels = current | wanted
            if "vision" in wanted:
                from api.vision_streamer import streamer
                await streamer.start()
        elif control == "unsubscribe":
            if client.channels is not None:
                client.channels = client.channels - wanted
            if "vision" in wanted:
                from api.vision_streamer import streamer
                await streamer.stop()
        elif control == "subscribe_all":
            client.channels = None
        else:
            return  # unknown control verb — ignore silently

        # Echo current subscription back so the client UI can render
        # "now listening to: ..." without having to track local state.
        try:
            payload = {
                "channels": (
                    sorted(client.channels) if client.channels is not None else None
                ),
            }
            await client.ws.send_text(
                json.dumps(
                    {
                        "channel": "_meta",
                        "type": "subscribed",
                        "data": payload,
                        "ts": int(time.time() * 1000),
                    }
                )
            )
        except Exception as exc:
            logger.debug("WS control ack error: %s", exc)
            client._connected = False

    @property
    def client_count(self) -> int:
        return len(self._clients)

    def online_device_ids(self) -> set[str]:
        return {c.device_id for c in self._clients.values() if c.device_id}


# Singleton hub
hub = WebSocketHub()


# ── Phase 24-B — `map.*` channel convenience helpers ──────────────────────


async def broadcast_map_mutation(
    op: str,
    payload: dict[str, Any],
    *,
    user_id: str | None = None,
) -> None:
    """Push a map-state delta on the canonical ``"map"`` channel.

    Thin wrapper so action code doesn't have to remember the channel
    name. Used by every mutating verb in
    `agent.actions.map.*` so the desktop HUD stays in lock-step with
    the agent's intent without polling the registry.
    """
    await hub.broadcast("map", op, payload, user_id=user_id)
