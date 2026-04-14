"""
PHANTOM OS — FastAPI Application Factory
"""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import config
from db.database import close_db, init_db
from api.websocket_hub import hub
from api.routes_auth import router as auth_router
from api.routes_chat import router as chat_router
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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle."""
    logger.info("PHANTOM OS starting...")
    await init_db()
    logger.info("Database initialized")
    yield
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
    async def _ws(ws: WebSocket, token: str | None = None) -> None:  # noqa: RUF029
        client_id = str(uuid.uuid4())
        # Auth enforced in Phase 02; token stored for future validation
        _ = token
        user_id: str | None = None

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
        return {
            "status": "ok",
            "version": "0.1.0",
            "ws_clients": hub.client_count,
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
