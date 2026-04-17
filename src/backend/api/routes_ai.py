"""
AI introspection routes — model discovery + connectivity tests.

GET  /ai/models        Proxy the Ollama /api/tags endpoint so the Settings
                        panel can offer a dropdown of installed models.
POST /ai/test          Round-trip a trivial "ping" through a single provider
                        so operators can sanity-check credentials + network.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from config import config
from security.auth import get_current_user
from db.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


class OllamaModel(BaseModel):
    name: str
    size: int | None = None
    parameter_size: str | None = None
    quantization: str | None = None
    family: str | None = None


class ModelsResponse(BaseModel):
    ok: bool
    host: str
    models: list[OllamaModel]
    error: str | None = None


class TestRequest(BaseModel):
    provider: Literal["ollama", "gemini"]


class TestResponse(BaseModel):
    ok: bool
    provider: str
    latency_ms: int
    reply_preview: str | None = None
    error: str | None = None


@router.get("/models", response_model=ModelsResponse)
async def list_ollama_models(
    _user: User = Depends(get_current_user),
) -> ModelsResponse:
    """
    Return locally installed Ollama models by proxying /api/tags.
    Never raises: an offline Ollama → `ok=false` with human-readable error.
    Frontend uses ok=false to switch the Settings field into a text input.
    """
    host = config.ai_ollama_host.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(f"{host}/api/tags")
            res.raise_for_status()
            payload = res.json()
    except Exception as exc:
        return ModelsResponse(ok=False, host=host, models=[], error=str(exc))

    raw_models = payload.get("models") or []
    models: list[OllamaModel] = []
    for m in raw_models:
        details = m.get("details") or {}
        models.append(
            OllamaModel(
                name=m.get("name") or m.get("model") or "?",
                size=m.get("size"),
                parameter_size=details.get("parameter_size"),
                quantization=details.get("quantization_level"),
                family=details.get("family"),
            )
        )
    models.sort(key=lambda x: x.name)
    return ModelsResponse(ok=True, host=host, models=models)


@router.post("/test", response_model=TestResponse)
async def test_provider(
    req: TestRequest,
    _user: User = Depends(get_current_user),
) -> TestResponse:
    """
    Mini round-trip through the specified provider. Short cap (4 tokens) keeps
    this cheap and fast on big cloud models as well as slow local ones.
    """
    from ai.gemini_provider import GeminiProvider
    from ai.ollama_provider import OllamaProvider

    providers = {"ollama": OllamaProvider(), "gemini": GeminiProvider()}
    provider = providers[req.provider]

    # Local 3B/8B Ollama models can take ~15s cold-start on Radxa ARM CPUs,
    # so the sanity-check timeout has to accommodate the first invocation.
    TEST_TIMEOUT_S = 30.0
    t0 = time.monotonic()
    try:
        # health_check returns a trivial round-trip and swallows its own errors,
        # so we wrap with timeout and capture raw exceptions ourselves.
        ok = await asyncio.wait_for(provider.health_check(), timeout=TEST_TIMEOUT_S)
        latency = int((time.monotonic() - t0) * 1000)
    except asyncio.TimeoutError:
        return TestResponse(
            ok=False,
            provider=req.provider,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=f"Timeout (>{int(TEST_TIMEOUT_S)}s)",
        )
    except Exception as exc:
        return TestResponse(
            ok=False,
            provider=req.provider,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=f"{type(exc).__name__}: {exc}",
        )

    if not ok:
        return TestResponse(
            ok=False,
            provider=req.provider,
            latency_ms=latency,
            error="Provider returned a non-success health response",
        )

    return TestResponse(
        ok=True,
        provider=req.provider,
        latency_ms=latency,
        reply_preview="pong",
    )
