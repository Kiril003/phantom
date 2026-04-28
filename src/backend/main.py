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
from api.routes_voice_stream import register_voice_ws
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
            # Phase 9.4b — resolve localization BEFORE building the snapshot
            # so the emitted context carries fresh provenance. Cheap: the
            # resolver only pays network cost when its caches are stale.
            try:
                await context_engine.resolve_localization()
            except Exception as exc:
                logger.debug("Localization tick raised (non-critical): %s", exc)
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

    # Phase 11b.1 — reconcile the ContextEngine's cached ai_provider with the
    # just-loaded config. Without this, the very first WS broadcast can ship
    # the env-default provider (typically "ollama") even though the user has
    # persisted "gemini" in Settings, causing a visible flicker in StatusBar
    # before the next 500 ms reconcile tick fixes it.
    try:
        from core.context_engine import context_engine
        context_engine.set_ai_provider(config.ai_primary_provider)
    except Exception as exc:
        logger.debug("context_engine: initial ai_provider sync skipped: %s", exc)

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

    # Warm the MiniLM encoder so the first chat message doesn't pay cold-load latency.
    try:
        from memory.strategic_memory import _get_ef
        def _warm() -> None:
            _get_ef()(["warmup"])
        await asyncio.to_thread(_warm)
        logger.info("MiniLM encoder warmed at startup")
    except Exception as exc:
        logger.warning("MiniLM warmup skipped: %s", exc)

    # Phase 12.0 — preload voice singletons so the first /ws/voice connect
    # doesn't pay 8-10 s of cold model loading on the event-loop's worker
    # thread. 11c.5 Bug 2.
    try:
        from pathlib import Path as _Path
        from voice.pipeline import preload_voice_models
        silero_path = (
            _Path(__file__).resolve().parent
            / "voice" / "models" / "silero-vad" / "silero_vad.onnx"
        )
        statuses = await asyncio.to_thread(
            preload_voice_models, str(silero_path) if silero_path.is_file() else None
        )
        logger.info("voice models preload: %s", statuses)
    except Exception as exc:
        logger.warning("voice model preload skipped: %s", exc)

    # Register chat WebSocket handlers
    register_chat_ws_handlers()

    # Start serial bridge (non-blocking, will retry on error).
    # Skipped on dev machines via PHANTOM_SERIAL_ENABLED=false.
    if config.serial_enabled:
        await _start_serial_bridge()
    else:
        logger.info("Serial bridge disabled (PHANTOM_SERIAL_ENABLED=false)")

    # Phase 9.4b — wire the default LocalizationSource chain before the
    # context loop starts so the first tick can already publish provenance.
    try:
        from agent.localization.lifecycle import wire_default_sources
        wire_default_sources()
    except Exception as exc:
        logger.warning("Localization source wiring failed: %s", exc)

    # Phase 9.4b — LocationHistory writer + reverse-geocode enricher.
    history_writer_obj = None
    history_enricher_obj = None
    if config.agent_location_history_enabled:
        try:
            from agent.localization.history_writer import get_writer, get_enricher
            history_writer_obj = get_writer()
            await history_writer_obj.start()
            history_enricher_obj = get_enricher()
            await history_enricher_obj.start()
            logger.info("LocationHistory writer + enricher started")
        except Exception as exc:
            logger.warning("LocationHistory setup failed: %s", exc)

    # Start tick loop for time-driven context updates
    loop_task = asyncio.create_task(_context_loop(), name="context_loop")

    # Start OLED face animator (Phase 08). It self-gates on
    # oled_animation_enabled inside its loop so a setting flip is picked up
    # without restarting the task.
    from vision.oled_animator import oled_animator
    await oled_animator.start()

    # Phase 09.1 — agent cognitive layer
    emotion_stop_event: asyncio.Event | None = None
    emotion_task: asyncio.Task | None = None
    # Phase 9.3b — proactive loop + standing orders runner (both start lazily
    # when their respective config flag is truthy).
    proactive_loop_obj = None
    standing_orders_runner_obj = None
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

        # Phase 9.3a — emotion decay loop drifts the foreground task's
        # EmotionVector toward baseline every `agent_emotion_decay_interval_s`.
        if config.agent_emotion_enabled:
            try:
                from agent.runtime import agent_runtime
                from agent.emotion import decay_loop
                emotion_stop_event = asyncio.Event()
                emotion_task = asyncio.create_task(
                    decay_loop(agent_runtime, emotion_stop_event),
                    name="agent_emotion_decay",
                )
            except Exception as exc:
                logger.warning("Emotion decay loop failed to start: %s", exc)

        # Phase 9.3b — proactive loop. Always construct the singleton (hooks
        # rely on get_loop() returning non-None to push triggers); start the
        # actual background task only when enabled.
        try:
            from agent.runtime import agent_runtime
            from agent.proactive import ProactiveLoop, set_loop
            proactive_loop_obj = ProactiveLoop(agent_runtime)
            set_loop(proactive_loop_obj)
            if config.agent_proactive_enabled:
                await proactive_loop_obj.start()
                logger.info("Proactive loop started (initiative active)")
            else:
                logger.info(
                    "Proactive loop singleton constructed; background task "
                    "disabled (agent_proactive_enabled=False). Flip the flag "
                    "via Settings UI or sqlite to enable."
                )
        except Exception as exc:
            logger.warning("Proactive loop setup failed: %s", exc)

        # Phase 9.3b — standing orders runner.
        if config.agent_standing_orders_enabled:
            try:
                from agent.standing_orders.runner import StandingOrderRunner
                standing_orders_runner_obj = StandingOrderRunner(agent_runtime)
                await standing_orders_runner_obj.start()
                logger.info("Standing orders runner started")
            except Exception as exc:
                logger.warning("Standing orders runner setup failed: %s", exc)

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

    # Phase 9.3a — stop emotion decay loop cleanly.
    if emotion_task is not None:
        if emotion_stop_event is not None:
            emotion_stop_event.set()
        emotion_task.cancel()
        try:
            await emotion_task
        except (asyncio.CancelledError, Exception):
            pass

    # Phase 9.3b — stop proactive loop + standing orders runner.
    if proactive_loop_obj is not None:
        try:
            await proactive_loop_obj.stop()
        except Exception as exc:
            logger.debug("Proactive loop shutdown raised: %s", exc)
        try:
            from agent.proactive import set_loop as _clear_loop
            _clear_loop(None)
        except Exception:
            pass
    if standing_orders_runner_obj is not None:
        try:
            await standing_orders_runner_obj.stop()
        except Exception as exc:
            logger.debug("Standing orders runner shutdown raised: %s", exc)

    # Phase 09.2 — close any active MCP clients
    if config.agent_enabled and config.agent_mcp_servers:
        try:
            from agent.mcp.discovery import shutdown_all as mcp_shutdown
            await mcp_shutdown()
        except Exception as exc:
            logger.debug("MCP shutdown raised: %s", exc)

    # Phase 9.4b — stop LocationHistory writer + enricher cleanly.
    if history_writer_obj is not None:
        try:
            await history_writer_obj.stop()
        except Exception as exc:
            logger.debug("LocationHistory writer shutdown raised: %s", exc)
    if history_enricher_obj is not None:
        try:
            await history_enricher_obj.stop()
        except Exception as exc:
            logger.debug("LocationHistory enricher shutdown raised: %s", exc)

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

    # CORS — audit-2026-04-28 F-12: drop wildcard methods/headers in favour of
    # an explicit allow-list. Combined with `samesite="lax"` cookies and
    # `allow_credentials=True`, the wildcard previously let any allow-listed
    # origin drive arbitrary state-changing requests with the user's session.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allow_headers=[
            "authorization",
            "content-type",
            "x-error-code",
            "x-correlation-id",
            "x-requested-with",
        ],
    )

    # Audit-2026-04-28 F-13 — baseline security headers on every response.
    # Defence-in-depth for the embedded UI on the device today and a hard
    # requirement before any cloud / multi-tenant exposure.
    @app.middleware("http")
    async def _phantom_security_headers(request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "connect-src 'self' ws: wss: http: https:; "
            "img-src 'self' data: blob: https:; "
            "media-src 'self' blob: data:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline'; "
            "font-src 'self' data:",
        )
        response.headers.setdefault("Permissions-Policy", "interest-cohort=()")
        return response

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
    register_voice_ws(app)
    _register_health(app)

    # Phase 18 (audit-2026-04-28 Block E) — productisation observability:
    # /healthz liveness, /readyz readiness, /metrics Prometheus exposition,
    # correlation-id middleware + http_requests_total counter middleware
    # on every response.
    from observability import (
        _register_observability,
        correlation_id_middleware,
        http_requests_counter_middleware,
    )
    app.middleware("http")(correlation_id_middleware)
    app.middleware("http")(http_requests_counter_middleware)
    _register_observability(app)

    # Phase 18 — serve the built frontend bundle when the operator deploys
    # via the multi-stage Dockerfile. The path is the build target the
    # frontend stage of that Dockerfile produces; on dev it doesn't exist
    # so we silently skip. Mounted last so /api/v1, /healthz, /readyz,
    # /metrics, /ws, and /docs all win route resolution.
    import os as _os
    from fastapi.staticfiles import StaticFiles  # noqa: PLC0415
    _dist_path = _os.environ.get("PHANTOM_FRONTEND_DIST", "/app/dist")
    if _os.path.isdir(_dist_path):
        app.mount(
            "/",
            StaticFiles(directory=_dist_path, html=True),
            name="frontend",
        )

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
