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
from api.routes_ai import router as ai_router
from api.routes_face import router as face_router
from api.routes_agent import router as agent_router

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
                # Drive OLED eyes with the new state so the face animator
                # transitions within one frame of the FSM decision.
                try:
                    from vision.oled_animator import oled_animator
                    oled_animator.set_system_state(transition.to_state)
                except Exception:
                    pass
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
            try:
                from vision.oled_animator import oled_animator
                oled_animator.set_system_state(transition.to_state)
            except Exception:
                pass
        await hub.broadcast("sensor", "snapshot", {"snapshot": snapshot})

        # Ingest wardriving data when WiFi + GPS fix present
        try:
            from wardriving.collector import wardriving_collector
            stats = await wardriving_collector.process_batch(batch)
            if stats.seen:
                await hub.broadcast("map", "wardriving_update", {
                    "seen": stats.seen,
                    "inserted": stats.inserted,
                    "updated": stats.updated,
                })
        except Exception as exc:
            logger.debug("Wardriving ingest failed (non-critical): %s", exc)

    serial_bridge.on_batch(on_batch)

    # Start in background task — reconnects automatically
    asyncio.create_task(serial_bridge.start(), name="serial_bridge")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle."""
    logger.info("PHANTOM OS starting...")
    await init_db()
    logger.info("Database initialized")

    # Load persisted settings BEFORE any module reads config (serial bridge,
    # AI providers, WS/hostname, loop interval). Order matters: without this
    # the serial bridge and logger would come up with env/default values even
    # if the operator had changed them in Settings UI on a previous session.
    from db.settings_repo import load_all as load_settings_from_db
    try:
        overrides = await load_settings_from_db()
        if overrides:
            config.apply_overrides(overrides)
            logger.info("Settings: applied %d DB overrides", len(overrides))
    except Exception as exc:
        # A broken settings row must not block startup — log and continue with
        # env/defaults.
        logger.error("Settings: failed to load DB overrides: %s", exc)

    # Reconfigure root logger in case log_level or hostname was overridden in
    # DB. Hostname goes into the log prefix so multi-node log streams can be
    # distinguished on a shared journal.
    logging.getLogger().setLevel(getattr(logging, config.log_level))
    new_fmt = logging.Formatter(
        f"%(asctime)s [{config.system_hostname}] [%(levelname)s] %(name)s: %(message)s"
    )
    for h in logging.getLogger().handlers:
        h.setFormatter(new_fmt)

    # Ensure at least one user exists (creates default ROOT 'phantom'/000000)
    from db.database import get_session
    from security.auth import ensure_default_user
    async with get_session() as db:
        await ensure_default_user(db)

    # Register chat WebSocket handlers
    register_chat_ws_handlers()

    # Start serial bridge (non-blocking, will retry on error).
    # Skipped on dev machines via PHANTOM_SERIAL_ENABLED=false.
    if config.serial_enabled:
        await _start_serial_bridge()
    else:
        logger.info("Serial bridge disabled (PHANTOM_SERIAL_ENABLED=false)")

    # Start tick loop for time-driven context updates
    loop_task = asyncio.create_task(_context_loop(), name="context_loop")

    # Start OLED face animator (Phase 08). It self-gates on
    # oled_animation_enabled inside its loop so a setting flip is picked up
    # without restarting the task.
    from vision.oled_animator import oled_animator
    await oled_animator.start()

    # Phase 09.1 — agent cognitive layer
    if config.agent_enabled:
        try:
            from agent.runtime import ensure_workspace
            from agent.audit import mark_orphans_paused
            ensure_workspace()
            orphans = await mark_orphans_paused("uvicorn_restart")
            if orphans:
                logger.info("Agent: marked %d orphaned task(s) as paused", orphans)
        except Exception as exc:
            logger.error("Agent startup hook failed: %s", exc)

    # Phase 09.2 — episodic memory backfill (only when ChromaDB is behind)
    if config.agent_enabled and config.agent_episodic_memory_enabled:
        try:
            from agent.memory.backfill import backfill_if_behind
            stats = await backfill_if_behind()
            if stats:
                logger.info(
                    "Episodic memory: backfilled %d/%d seeds (skipped %d)",
                    stats["written"], stats["seeds_total"], stats["skipped"],
                )
        except Exception as exc:
            logger.warning("Episodic memory backfill skipped: %s", exc)

    # Phase 09.2 — MCP discovery (no servers active by default)
    if config.agent_enabled and config.agent_mcp_servers:
        try:
            from agent.mcp.discovery import discover_all
            counts = await discover_all()
            for sn, n in counts.items():
                logger.info("MCP %s: %d tools registered", sn, n)
        except Exception as exc:
            logger.warning("MCP discovery skipped: %s", exc)

    yield

    loop_task.cancel()
    try:
        await loop_task
    except asyncio.CancelledError:
        pass

    await oled_animator.stop()

    # Phase 09.1 — best-effort agent shutdown: stop running task + close browser
    if config.agent_enabled:
        try:
            from agent.runtime import agent_runtime
            from agent.audit import mark_orphans_paused
            if agent_runtime.current_task is not None:
                await agent_runtime.stop()
            await mark_orphans_paused("uvicorn_shutdown")
        except Exception as exc:
            logger.warning("Agent shutdown hook failed: %s", exc)

    # Phase 09.2 — close any active MCP clients
    if config.agent_enabled and config.agent_mcp_servers:
        try:
            from agent.mcp.discovery import shutdown_all as mcp_shutdown
            await mcp_shutdown()
        except Exception as exc:
            logger.debug("MCP shutdown raised: %s", exc)

    if config.serial_enabled:
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
    app.include_router(ai_router, prefix=prefix)
    app.include_router(face_router, prefix=prefix)
    app.include_router(agent_router, prefix=prefix)

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
        if config.serial_enabled:
            from sensors.serial_bridge import serial_bridge
            esp32_connected = serial_bridge.is_connected
        else:
            esp32_connected = False
        return {
            "status": "ok",
            "version": "0.1.0",
            "hostname": config.system_hostname,
            "ws_clients": hub.client_count,
            "esp32_connected": esp32_connected,
            "serial_enabled": config.serial_enabled,
            # Configured primary provider. Surfaced here so any client that
            # doesn't subscribe to the context-snapshot WS stream (scripts,
            # probes, future monitoring UIs) can see which provider the next
            # chat turn will try first. AIRouter reads this same value
            # dynamically, so it's always the truth.
            "ai_active": config.ai_primary_provider,
            "ai_fallback": config.ai_fallback_provider,
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
