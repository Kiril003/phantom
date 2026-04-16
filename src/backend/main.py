"""
PHANTOM OS — FastAPI Application Factory
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import config
from db.database import close_db, init_db
from api.websocket_hub import hub
from api.routes_auth import router as auth_router, users_router
from api.routes_chat import router as chat_router, register_ws_handlers as register_chat_ws_handlers
from api.routes_context import router as context_router
from api.routes_settings import router as settings_router
from api.routes_map import router as map_router
from api.routes_linux import router as linux_router
from api.routes_tools import router as tools_router
from api.routes_voice import router as voice_router

logging.basicConfig(
    level=getattr(logging, config.log_level),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

_last_batch_ts: float = 0.0


async def _context_loop() -> None:
    """
    Main engine loop — runs every 500ms.
    Drives ContextEngine tick, StateMachine evaluation, DecisionTree,
    and WebSocket broadcasts when serial bridge is not connected.
    """
    from core.context_engine import context_engine
    from core.state_machine import state_machine
    from core.decision_tree import decision_tree

    interval = config.sensor_batch_interval_ms / 1000.0
    while True:
        try:
            # Skip tick if a live sensor batch was processed recently
            if time.monotonic() - _last_batch_ts < 0.4:
                await asyncio.sleep(interval)
                continue
            snapshot = await context_engine.tick()
            transition = state_machine.evaluate(snapshot)
            if transition:
                context_engine.set_state(transition.to_state)
                await hub.broadcast("state", "transition", {
                    "from": transition.from_state,
                    "to": transition.to_state,
                    "trigger": transition.trigger,
                    "timestamp": transition.timestamp,
                    "auto": transition.auto,
                })
            decision_tree.evaluate(snapshot)
            await hub.broadcast("sensor", "snapshot", {"snapshot": snapshot})
        except Exception as exc:
            logger.error("Context loop error: %s", exc)
        await asyncio.sleep(interval)


async def _start_serial_bridge() -> None:
    """Start serial bridge if port is available."""
    from sensors.serial_bridge import serial_bridge
    from core.context_engine import context_engine
    from core.state_machine import state_machine

    from sensors.sensor_parser import SensorBatch as _SensorBatch

    async def on_batch(batch: _SensorBatch) -> None:
        global _last_batch_ts
        _last_batch_ts = time.monotonic()
        snapshot = await context_engine.update(batch)
        transition = state_machine.evaluate(snapshot)
        if transition:
            context_engine.set_state(transition.to_state)
            await hub.broadcast("state", "transition", {
                "from": transition.from_state,
                "to": transition.to_state,
                "trigger": transition.trigger,
                "timestamp": transition.timestamp,
                "auto": transition.auto,
            })
        await hub.broadcast("sensor", "snapshot", {"snapshot": snapshot})

    serial_bridge.on_batch(on_batch)

    # Start in background task — reconnects automatically
    asyncio.create_task(serial_bridge.start(), name="serial_bridge")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle."""
    logger.info("PHANTOM OS starting...")
    await init_db()
    logger.info("Database initialized")

    # Ensure at least one user exists (creates default ROOT 'phantom'/000000)
    from db.database import get_session
    from security.auth import ensure_default_user
    async with get_session() as db:
        await ensure_default_user(db)

    # Register chat WebSocket handlers
    register_chat_ws_handlers()

    # Start serial bridge (non-blocking, will retry on error)
    await _start_serial_bridge()

    # Start tick loop for time-driven context updates
    loop_task = asyncio.create_task(_context_loop(), name="context_loop")

    yield

    loop_task.cancel()
    try:
        await loop_task
    except asyncio.CancelledError:
        pass

    from sensors.serial_bridge import serial_bridge
    await serial_bridge.stop()
    await close_db()
    logger.info("PHANTOM OS stopped")


def create_app() -> FastAPI:
    app = FastAPI(
        title="PHANTOM OS API",
        version="0.1.0",
        description="PHANTOM OS Backend — AI-powered autonomous assistant",
        lifespan=lifespan,
        docs_url="/docs" if config.debug else None,
        redoc_url="/redoc" if config.debug else None,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # API routers
    prefix = "/api/v1"
    app.include_router(auth_router, prefix=prefix)
    app.include_router(users_router, prefix=prefix)
    app.include_router(chat_router, prefix=prefix)
    app.include_router(context_router, prefix=prefix)
    app.include_router(settings_router, prefix=prefix)
    app.include_router(map_router, prefix=prefix)
    app.include_router(linux_router, prefix=prefix)
    app.include_router(tools_router, prefix=prefix)
    app.include_router(voice_router, prefix=prefix)

    _register_ws(app)
    _register_health(app)

    return app


def _register_ws(app: FastAPI) -> None:
    @app.websocket("/ws")
    async def _ws(ws: WebSocket, token: str | None = None) -> None:
        client_id = str(uuid.uuid4())
        user_id: str | None = None

        # Validate JWT if provided (non-blocking: unauthenticated WS gets sensor data only)
        if token:
            try:
                from security.jwt_manager import verify_token
                payload = verify_token(token)
                user_id = payload.user_id
            except Exception:
                pass  # Accept connection but mark as unauthenticated

        client = await hub.connect(ws, client_id, user_id)
        try:
            await hub.handle_client(client)
        except WebSocketDisconnect:
            pass
        finally:
            await hub.disconnect(client_id)


def _register_health(app: FastAPI) -> None:
    @app.get("/health")
    async def _health() -> dict:
        from sensors.serial_bridge import serial_bridge
        return {
            "status": "ok",
            "version": "0.1.0",
            "ws_clients": hub.client_count,
            "esp32_connected": serial_bridge.is_connected,
        }


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        reload=config.debug,
        log_level=config.log_level.lower(),
    )
