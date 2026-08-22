"""Публічна точка зустрічі. Ключів не має, вміст не бачить — лише зшиває сокети."""
from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import os
import secrets

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from starlette.websockets import WebSocketState

from hub import (
    HANDSHAKE_TIMEOUT_S,
    RelayError,
    hub,
    verify_node_hello,
)

logging.basicConfig(
    level=os.environ.get("RELAY_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("relay")

NODE_PING_INTERVAL_S = float(os.environ.get("RELAY_NODE_PING_INTERVAL_S", "25"))

app = FastAPI(title="PHANTOM Relay", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/relay/health")
async def health() -> dict:
    # Тільки числа: скільки скриньок і листів. Хто з ким листується — не наша справа.
    return {
        "ok": True,
        "nodes": hub.node_count,
        "sessions": hub.session_count,
        "mailboxes": hub.mailbox_count,
        "letters": hub.letter_count,
    }


class MailboxBody(BaseModel):
    frame: str = ""
    from_node_id: str = ""
    reply_address: str | None = None


@app.post("/relay/mailbox/{node_id}", status_code=202)
async def mailbox(node_id: str, body: MailboxBody, request: Request) -> dict:
    """Без авторизації свідомо: пише чужа людина, токена цього ретранслятора в неї немає.

    Автентичність дає шифрування самого кадру, якого ми не бачимо і бачити не маємо.
    """
    try:
        await hub.post_letter(
            node_id=node_id,
            frame=body.frame,
            from_node_id=body.from_node_id,
            reply_address=body.reply_address,
            sender_ip=_peer_ip(request),
        )
    except RelayError as exc:
        raise HTTPException(status_code=exc.code, detail=str(exc)) from exc
    # Відповідь однакова, чи адресат на місці, чи його скринька чекатиме добу:
    # присутність — чужі метадані, не нам їх розголошувати.
    return {"ok": True}


async def _close(ws: WebSocket, code: int, reason: str = "") -> None:
    if ws.client_state is WebSocketState.DISCONNECTED:
        return
    with contextlib.suppress(Exception):
        await ws.close(code=code, reason=reason)


def _peer_ip(conn: WebSocket | Request) -> str:
    forwarded = conn.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return conn.client.host if conn.client else "unknown"


@app.websocket("/relay/node")
async def relay_node(ws: WebSocket) -> None:
    await ws.accept()
    nonce = secrets.token_bytes(32)
    await ws.send_json(
        {"t": "challenge", "v": 1, "nonce": base64.b64encode(nonce).decode("ascii")}
    )
    try:
        hello = await asyncio.wait_for(ws.receive_json(), HANDSHAKE_TIMEOUT_S)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        await _close(ws, 4400, "no hello")
        return

    try:
        node_id = verify_node_hello(nonce, hello.get("pub", ""), hello.get("sig", ""))
        previous = await hub.register_node(node_id, ws)
    except RelayError as exc:
        logger.info("вузол відхилено: %s", exc)
        await _close(ws, exc.code, str(exc))
        return

    if previous is not None:
        await _close(previous, 4409, "replaced")
    await ws.send_json({"t": "ready", "node_id": node_id})
    logger.info("вузол на місці: %s (усього %d)", node_id, hub.node_count)

    ping = asyncio.create_task(_ping_loop(node_id, ws))
    try:
        handed = await hub.flush_mailbox(node_id, ws)
        if handed:
            logger.info("зі скриньки віддано листів: %d", handed)
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        ping.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await ping
        await hub.unregister_node(node_id, ws)
        logger.info("вузол пішов: %s (лишилось %d)", node_id, hub.node_count)


async def _ping_loop(node_id: str, ws: WebSocket) -> None:
    while True:
        await asyncio.sleep(NODE_PING_INTERVAL_S)
        try:
            await hub.notify_ping(node_id, ws)
        except Exception:
            return


@app.websocket("/relay/node/session")
async def relay_node_session(ws: WebSocket, ticket: str = Query(default="")) -> None:
    await ws.accept()
    try:
        claimed = await hub.claim_ticket(ticket)
    except RelayError as exc:
        await _close(ws, exc.code, str(exc))
        return
    if claimed.node_socket.done():
        await _close(ws, 4409, "ticket already used")
        return
    claimed.node_socket.set_result(ws)
    await claimed.finished.wait()
    await _close(ws, 1000, "done")


@app.websocket("/relay/client")
async def relay_client(ws: WebSocket, node_id: str = Query(default="")) -> None:
    await ws.accept()
    ip = _peer_ip(ws)
    try:
        ticket = await hub.open_ticket(node_id, ip)
    except RelayError as exc:
        await _close(ws, exc.code, str(exc))
        return

    try:
        await hub.notify_open(node_id, ticket.ticket)
        node_ws = await asyncio.wait_for(
            asyncio.shield(ticket.node_socket), HANDSHAKE_TIMEOUT_S
        )
    except RelayError as exc:
        # Спершу звільнити місце, потім прощатись: інакше той, хто вже почув
        # «до побачення», ще якусь мить бачить нашу сесію живою.
        await hub.close_ticket(ticket)
        await _close(ws, exc.code, str(exc))
        return
    except Exception as exc:
        logger.info("вузол %s не передзвонив: %s", node_id, exc)
        await hub.close_ticket(ticket)
        await _close(ws, 4504, "node did not dial back")
        return

    try:
        await _splice(ws, node_ws)
    finally:
        await hub.close_ticket(ticket)
        await _close(ws, 1000, "done")


async def _splice(left: WebSocket, right: WebSocket) -> None:
    up = asyncio.create_task(_pump(left, right))
    down = asyncio.create_task(_pump(right, left))
    done, pending = await asyncio.wait(
        {up, down}, return_when=asyncio.FIRST_COMPLETED
    )
    for task in pending:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


async def _pump(src: WebSocket, dst: WebSocket) -> None:
    try:
        while True:
            message = await src.receive()
            if message["type"] != "websocket.receive":
                return
            payload = message.get("bytes")
            if payload is not None:
                await dst.send_bytes(payload)
                continue
            text = message.get("text")
            if text is not None:
                await dst.send_text(text)
    except (WebSocketDisconnect, RuntimeError):
        return
