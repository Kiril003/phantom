"""Day-4 Wave-2 W-4 — dynamic-source picker resolvers (ADR-XC-007 +
`docs/architecture/chat-liveness.md` §402).

The frontend `<DynamicPicker source="..." />` (chat-input cluster, W-3
ModelCard consumer) calls `GET /api/v1/dynamic_source/{source}` to get a
list of `{value, label, meta?}` options. This module owns the closed
enum of sources and the per-source resolvers.

Sources (closed enum — adding a 6th requires (a) extending
`DynamicSource` Literal here, (b) extending the matching TS union in
`src/shared/types/chat.ts`, (c) adding a resolver, (d) ADR amendment):

  ollama_models   — list of locally-installed Ollama models
  voice_voices    — list of available Piper/installed TTS voices
  mms_languages   — list of MMS NPU language codes
  serial_ports    — list of /dev/tty* candidates the daemon can see
  tts_speakers    — list of TTS speaker presets (subset of voices for
                    the chat-input ModelCard "next reply voice" slot)

All resolvers are *defensive*: a missing dep, a downed sub-service, or
a permission denial returns an EMPTY option list rather than raising.
The `<DynamicPicker>` shows its placeholder until non-empty resolves.

Each resolver caps option count + the route adds a tight per-source
ttl-cache to avoid hammering Ollama/serial scans on every keystroke
(ttl_s parameter; default 5 s for cheap sources, 30 s for expensive).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable, Literal

from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dynamic_source", tags=["dynamic_source"])


# ─────────────────────────────────────────── closed enum + Pydantic mirror ──


# Mirrors `DynamicPickerSource` in `src/shared/types/chat.ts`.
DynamicSource = Literal[
    "ollama_models",
    "voice_voices",
    "mms_languages",
    "serial_ports",
    "tts_speakers",
]


class DynamicPickerOption(BaseModel):
    """Wire-compat with the TS `DynamicPickerOption`."""

    value: str
    label: str
    meta: dict[str, Any] | None = None


class DynamicPickerResponse(BaseModel):
    """Standard envelope for every resolver response."""

    source: DynamicSource
    options: list[DynamicPickerOption] = Field(default_factory=list)
    fetched_at: float
    ttl_s: float


# ─────────────────────────────────────────────────────── per-source caches ──


# tiny ttl cache; one slot per source.
_CACHE: dict[str, tuple[float, DynamicPickerResponse]] = {}


def _cache_get(source: str, ttl_s: float) -> DynamicPickerResponse | None:
    entry = _CACHE.get(source)
    if not entry:
        return None
    cached_at, resp = entry
    if (time.time() - cached_at) > ttl_s:
        return None
    return resp


def _cache_set(source: str, resp: DynamicPickerResponse) -> None:
    _CACHE[source] = (time.time(), resp)


def _clear_cache_for_tests() -> None:
    """Test helper — wipe the ttl cache so each resolver test starts fresh."""
    _CACHE.clear()


# ───────────────────────────────────────────────────────────── resolvers ──


async def _resolve_ollama_models() -> list[DynamicPickerOption]:
    """List locally-installed Ollama models. Returns empty if Ollama
    isn't reachable or `ollama` package isn't installed (the daemon
    runs fine without the local fallback)."""
    try:
        from ai.ollama_provider import list_local_models
    except Exception as exc:  # noqa: BLE001
        logger.debug("ollama_models resolver: import failed: %s", exc)
        return []
    try:
        models = await list_local_models()
    except Exception as exc:  # noqa: BLE001
        logger.debug("ollama_models resolver: list_local_models failed: %s", exc)
        return []
    options: list[DynamicPickerOption] = []
    for m in models or []:
        if not isinstance(m, dict):
            continue
        name = m.get("name") or m.get("model")
        if not isinstance(name, str) or not name:
            continue
        size = m.get("size")
        meta: dict[str, Any] = {"provider": "ollama"}
        if isinstance(size, (int, float)) and size > 0:
            meta["size_mb"] = round(float(size) / (1024 * 1024), 1)
        options.append(
            DynamicPickerOption(value=name, label=name, meta=meta)
        )
    # Cap to a reasonable view — operators with 50+ pulled models still
    # get pickable UI without overwhelming the drawer.
    return options[:50]


async def _resolve_voice_voices() -> list[DynamicPickerOption]:
    """List available installed TTS voices. Reads from the existing voice
    API so the same names that show in Settings show in the chat picker."""
    try:
        from voice.tts_engine import list_available_voices
    except Exception as exc:  # noqa: BLE001
        logger.debug("voice_voices resolver: import failed: %s", exc)
        return []
    try:
        voices = await asyncio.to_thread(list_available_voices)
    except Exception as exc:  # noqa: BLE001
        logger.debug("voice_voices resolver: list_available_voices failed: %s", exc)
        return []
    return [
        DynamicPickerOption(value=str(v), label=str(v), meta={"lang": "uk"})
        for v in (voices or [])
        if isinstance(v, str) and v
    ][:30]


async def _resolve_mms_languages() -> list[DynamicPickerOption]:
    """Static-ish list of MMS NPU language codes. Expensive to enumerate
    from the bundle dir for every keystroke; ship the closed list the
    audit pinned in `voice_stt_mms_lang` Literal."""
    # The MMS provider supports ~100 languages; we surface the
    # operator-relevant subset here. ADR-XC-007 keeps the list small.
    BUILTINS: list[tuple[str, str]] = [
        ("ukr", "Ukrainian"),
        ("eng", "English"),
        ("rus", "Russian"),
        ("pol", "Polish"),
        ("deu", "German"),
        ("fra", "French"),
        ("spa", "Spanish"),
        ("ita", "Italian"),
        ("por", "Portuguese"),
        ("tur", "Turkish"),
    ]
    return [
        DynamicPickerOption(
            value=code, label=label, meta={"lang": code}
        )
        for code, label in BUILTINS
    ]


async def _resolve_serial_ports() -> list[DynamicPickerOption]:
    """List candidate serial ports for the ESP32 bridge. Defensive — if
    pyserial isn't installed (unlikely on the device but possible in
    dev / CI) returns empty rather than raising."""
    try:
        from serial.tools import list_ports
    except Exception as exc:  # noqa: BLE001
        logger.debug("serial_ports resolver: import failed: %s", exc)
        return []
    try:
        ports = await asyncio.to_thread(list_ports.comports)
    except Exception as exc:  # noqa: BLE001
        logger.debug("serial_ports resolver: comports failed: %s", exc)
        return []
    options: list[DynamicPickerOption] = []
    for p in ports or []:
        device = getattr(p, "device", None)
        description = getattr(p, "description", None)
        if not device:
            continue
        meta: dict[str, Any] = {}
        if description and description != "n/a":
            meta["provider"] = str(description)
        options.append(
            DynamicPickerOption(
                value=str(device),
                label=f"{device}"
                + (f" ({description})" if description and description != "n/a" else ""),
                meta=meta or None,
            )
        )
    return options[:20]


async def _resolve_tts_speakers() -> list[DynamicPickerOption]:
    """Subset of voice_voices filtered to TTS-only speakers. Today the
    voice list IS the TTS speaker list; preserved as a separate source
    so the chat-input ModelCard "next reply voice" slot can diverge
    from the Settings voice list (e.g., per-user persona voice in Day-5)
    without breaking either consumer."""
    return await _resolve_voice_voices()


_RESOLVERS: dict[str, tuple[Callable[[], Awaitable[list[DynamicPickerOption]]], float]] = {
    "ollama_models": (_resolve_ollama_models, 30.0),
    "voice_voices": (_resolve_voice_voices, 60.0),
    "mms_languages": (_resolve_mms_languages, 3600.0),
    "serial_ports": (_resolve_serial_ports, 5.0),
    "tts_speakers": (_resolve_tts_speakers, 60.0),
}


# ──────────────────────────────────────────────────────────────── route ──


@router.get("/{source}", response_model=DynamicPickerResponse)
async def get_dynamic_source(
    source: DynamicSource = Path(
        ...,
        description=(
            "One of: ollama_models | voice_voices | mms_languages | "
            "serial_ports | tts_speakers"
        ),
    ),
) -> DynamicPickerResponse:
    """Resolve the per-source option list. Failed resolvers return an
    empty list rather than 500 — the picker shows its placeholder."""
    resolver_entry = _RESOLVERS.get(source)
    if resolver_entry is None:
        # FastAPI's path-validation should already reject unknown source
        # values per the Literal; this branch is belt-and-braces.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown dynamic_source: {source!r}",
        )
    resolver, ttl_s = resolver_entry

    cached = _cache_get(source, ttl_s)
    if cached is not None:
        return cached

    options: list[DynamicPickerOption]
    try:
        options = await resolver()
    except Exception as exc:  # noqa: BLE001
        # Belt-and-braces — every resolver already wraps. If a refactor
        # ever lets an exception escape, the picker's placeholder is the
        # graceful fallback.
        logger.warning("dynamic_source %s resolver raised: %s", source, exc)
        options = []
    resp = DynamicPickerResponse(
        source=source,
        options=options,
        fetched_at=time.time(),
        ttl_s=ttl_s,
    )
    _cache_set(source, resp)
    return resp
