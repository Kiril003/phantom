"""
PHANTOM OS — Phase 18 productisation: observability primitives.

Self-contained — no extra runtime deps. Provides:

* `Counter` / `Gauge` — minimal Prometheus-style metric primitives. Render
  via :func:`render_metrics` to the standard text exposition format.
* `correlation_id_middleware` — FastAPI HTTP middleware that ensures every
  request carries an `X-Correlation-Id`, generating one if absent and
  echoing it on the response. The id is also bound to a contextvar so
  the logging filter `CorrelationFilter` can attach it to every log record
  produced inside the request.
* `_register_observability(app)` — wires `/healthz`, `/readyz`, `/metrics`
  routes onto the FastAPI app. Liveness `/healthz` is dependency-free.
  Readiness `/readyz` probes DB + chroma + AI provider; failures return
  503 so a load balancer can drain the instance without taking it down.

The hand-rolled exposition is intentional: a Prometheus-client dep would
be the obvious choice but the audit budget rejects "broad pip install
everything" without justification. The text format is well-defined and
small enough to render in a screenful of code.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
import time
from typing import Any, Callable, Iterable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse

logger = logging.getLogger(__name__)

# ── Process-start anchor ──────────────────────────────────────────────────────

_PROCESS_STARTED_AT: float = time.time()
_VERSION: str = "0.18.2-fixup"


# ── Correlation-id plumbing ───────────────────────────────────────────────────

_correlation_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "phantom_correlation_id", default=None
)


def get_correlation_id() -> str | None:
    return _correlation_id.get()


async def correlation_id_middleware(request: Request, call_next: Callable):
    incoming = request.headers.get("x-correlation-id")
    cid = incoming.strip() if (incoming and len(incoming.strip()) <= 64) else _short_uuid()
    token = _correlation_id.set(cid)
    try:
        response = await call_next(request)
    finally:
        _correlation_id.reset(token)
    response.headers.setdefault("X-Correlation-Id", cid)
    return response


async def http_requests_counter_middleware(request: Request, call_next: Callable):
    """Phase 18 E-5 — bump phantom_http_requests_total per request, bucketed
    by HTTP method and route prefix (e.g. ``/api/v1/chat`` rather than the
    full templated path) so cardinality stays bounded under user IDs / UUIDs."""
    response = await call_next(request)
    try:
        path = request.url.path or "/"
        # Collapse to the first two segments — keeps cardinality flat
        # under e.g. /api/v1/chat/sessions/<uuid>/messages.
        parts = [p for p in path.split("/", 4) if p]
        bucket = "/" + "/".join(parts[:3]) if parts else "/"
        http_requests_total.inc(
            method=request.method,
            route=bucket,
            status=str(response.status_code)[:3],
        )
    except Exception as exc:  # noqa: BLE001 — middleware never raises
        logger.debug("http_requests_counter_middleware: %s", exc)
    return response


def _short_uuid() -> str:
    import uuid
    return uuid.uuid4().hex[:16]


class CorrelationFilter(logging.Filter):
    """Attach the current correlation id to every log record. Safe to
    install on the root logger — outside an HTTP request the value is
    `-` (single dash) so log formatters can stay deterministic."""

    def filter(self, record: logging.LogRecord) -> bool:  # type: ignore[override]
        record.correlation_id = get_correlation_id() or "-"
        return True


# ── Day-2 (audit-2026-04-29 Tier E) — structured JSON log formatter ──────────
#
# The audit asked for "structlog JSON renderer wired on top of existing
# CorrelationFilter". A full structlog adoption would touch every
# logging call site; the pragmatic alternative is a stdlib-only JSON
# `logging.Formatter` that ALSO honours CorrelationFilter (so existing
# `logger.info(...)` calls flip to JSON without any code change) and a
# config knob to opt in. Operators on a journal/Loki pipeline get
# parsable output; local-dev keeps the human-readable default.


class JsonFormatter(logging.Formatter):
    """Render LogRecord as a single-line JSON object.

    Fields:
      - ``ts``: ISO-8601 UTC timestamp (millisecond precision).
      - ``level``: standard level name (INFO/WARNING/...).
      - ``logger``: dotted logger name.
      - ``message``: rendered (interpolated) message string.
      - ``correlation_id``: present when CorrelationFilter is installed
        (otherwise omitted so a raw `logger.warning` call from a
        startup hook doesn't carry a misleading "-").
      - ``exc``: traceback text on `logger.exception(...)` calls.
      - extra structured fields the caller passed via the `extra={}`
        kwarg are merged in (only JSON-serialisable types — others are
        coerced via `str()`).

    Designed to be cheap: no `json.dumps` configuration tax — uses
    ``ensure_ascii=False`` so Cyrillic / Ukrainian content lands intact
    in the operator's grep window.
    """

    # The set of attributes the stdlib LogRecord constructor sets. Any
    # *other* attribute on the record is treated as an `extra={}` field
    # the caller wants surfaced in JSON.
    _STD_ATTRS = frozenset({
        "name", "msg", "args", "levelname", "levelno", "pathname",
        "filename", "module", "exc_info", "exc_text", "stack_info",
        "lineno", "funcName", "created", "msecs", "relativeCreated",
        "thread", "threadName", "processName", "process", "message",
        "asctime", "taskName",
    })

    def format(self, record: logging.LogRecord) -> str:
        import json
        from datetime import datetime, timezone as _tz

        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=_tz.utc)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        cid = getattr(record, "correlation_id", None)
        if cid is not None and cid != "-":
            payload["correlation_id"] = cid
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)

        for key, value in record.__dict__.items():
            if key in self._STD_ATTRS or key.startswith("_"):
                continue
            if key in payload:  # don't clobber the canonical fields
                continue
            # `correlation_id` is handled by the canonical-fields block
            # above; the `-` placeholder MUST stay out of the JSON row.
            if key == "correlation_id":
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except (TypeError, ValueError):
                payload[key] = str(value)

        return json.dumps(payload, ensure_ascii=False, default=str)


def install_json_logging(level: str | int = logging.INFO) -> None:
    """Replace every root-logger handler's formatter with JsonFormatter.

    Idempotent — calling twice doesn't double-install. Adds a
    CorrelationFilter on the root logger if one isn't already attached
    so JSON rows always carry the per-request correlation id when the
    middleware has it.
    """
    root = logging.getLogger()
    if isinstance(level, str):
        level = getattr(logging, level.upper(), logging.INFO)
    root.setLevel(level)
    fmt = JsonFormatter()
    for handler in root.handlers:
        handler.setFormatter(fmt)
    if not any(isinstance(f, CorrelationFilter) for f in root.filters):
        root.addFilter(CorrelationFilter())


# ── Metric primitives ─────────────────────────────────────────────────────────


def _format_labels(labels: dict[str, str] | None) -> str:
    if not labels:
        return ""
    items = ",".join(
        f'{k}="{_escape(str(v))}"' for k, v in sorted(labels.items())
    )
    return "{" + items + "}"


def _escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


class Counter:
    """Monotonic counter — labelled, all-time-cumulative. Negative deltas
    are clamped to zero so a buggy caller can't decrement."""

    def __init__(self, name: str, help_text: str) -> None:
        self.name = name
        self.help = help_text
        self._values: dict[tuple[tuple[str, str], ...], float] = {}

    def inc(self, value: float = 1.0, **labels: str) -> None:
        if value < 0:
            return
        key = tuple(sorted(labels.items()))
        self._values[key] = self._values.get(key, 0.0) + value

    def render(self) -> Iterable[str]:
        yield f"# HELP {self.name} {self.help}"
        yield f"# TYPE {self.name} counter"
        if not self._values:
            yield f"{self.name} 0"
            return
        for key, value in self._values.items():
            label_dict = dict(key)
            yield f"{self.name}{_format_labels(label_dict)} {value}"


class Gauge:
    """Live gauge — value pulled from a getter at render time. Useful for
    "current ws clients" / "uptime seconds" without caller bookkeeping."""

    def __init__(self, name: str, help_text: str, getter: Callable[[], float]) -> None:
        self.name = name
        self.help = help_text
        self.getter = getter

    def render(self) -> Iterable[str]:
        try:
            value = float(self.getter())
        except Exception:  # noqa: BLE001
            value = 0.0
        yield f"# HELP {self.name} {self.help}"
        yield f"# TYPE {self.name} gauge"
        yield f"{self.name} {value}"


# ── Registry ──────────────────────────────────────────────────────────────────


_REGISTRY: list[Any] = []


def _register(metric: Any) -> Any:
    _REGISTRY.append(metric)
    return metric


# ── Concrete metrics ──────────────────────────────────────────────────────────


chat_messages_total: Counter = _register(
    Counter("phantom_chat_messages_total", "Total chat messages produced (by role).")
)
voice_stt_total: Counter = _register(
    Counter("phantom_voice_stt_total", "Total STT invocations (by engine).")
)
voice_tts_total: Counter = _register(
    Counter("phantom_voice_tts_total", "Total TTS invocations.")
)
ai_provider_used_total: Counter = _register(
    Counter(
        "phantom_ai_provider_used_total",
        "AI provider invocations by name.",
    )
)
ai_router_fallthrough_total: Counter = _register(
    Counter(
        "phantom_ai_router_fallthrough_total",
        "Times AIRouter fell through primary→fallback.",
    )
)
http_requests_total: Counter = _register(
    Counter(
        "phantom_http_requests_total",
        "HTTP requests handled, by method and route prefix.",
    )
)
# Day-3 Q (audit-2026-04-30 Phase 17b): chat tool-use loop dispatch
# count, labelled by tool name AND ok-flag so a dashboard can split
# success-vs-error per tool. Operators reading this counter get a
# real-time view of which chat-tool surfaces the LLM exercises and
# how often each fails.
chat_tool_calls_total: Counter = _register(
    Counter(
        "phantom_chat_tool_calls_total",
        "Chat tool-use dispatch count by tool name and success.",
    )
)


def _uptime_seconds() -> float:
    return max(0.0, time.time() - _PROCESS_STARTED_AT)


def _ws_clients() -> float:
    try:
        from api.websocket_hub import hub
        return float(hub.client_count)
    except Exception:  # noqa: BLE001
        return 0.0


_register(Gauge("phantom_uptime_seconds", "Process uptime in seconds.", _uptime_seconds))
_register(Gauge("phantom_ws_clients", "Connected WebSocket clients.", _ws_clients))


def render_metrics() -> str:
    """Render every registered metric to the Prometheus text exposition
    format, plus a single-cell `phantom_build_info` so dashboards can
    template by version."""
    lines: list[str] = [
        "# HELP phantom_build_info Static build info (one timeseries per build).",
        "# TYPE phantom_build_info gauge",
        f'phantom_build_info{{version="{_VERSION}"}} 1',
    ]
    for metric in _REGISTRY:
        lines.extend(metric.render())
    return "\n".join(lines) + "\n"


# ── Readyz probes ─────────────────────────────────────────────────────────────


async def _probe_db() -> tuple[bool, str]:
    try:
        from sqlalchemy import text
        from db.database import get_session
        async with get_session() as db:
            await db.execute(text("SELECT 1"))
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, f"db: {type(exc).__name__}"


async def _probe_chroma() -> tuple[bool, str]:
    """Day-2 D2-A6 / G-1: do NOT call `list_collections()` per probe.

    Day-3 D3-A-6 follow-up: the original Day-2 probe trusted the
    `client_initialized()` cached flag and never re-validated the
    backing client at probe time. After a runtime collapse (chroma
    backing file deleted, persistent client process crashed, FS
    permissions changed) the flag stays True forever and `/readyz`
    keeps reporting healthy. Now the probe issues a `client.heartbeat()`
    — a single nanosecond-timestamp call that touches the client
    without any per-collection scan. Cheap, but catches corruption.
    """
    try:
        from memory.strategic_memory import client_initialized, _get_client
        if not client_initialized():
            # Lifespan has not yet completed `init_chroma_eager` (or it
            # failed). Surface as not-ready so the LB pulls us out of
            # rotation rather than serving cold-scan latency to clients.
            return False, "chroma: not_initialized"
        client = _get_client()
        # `heartbeat()` is the chromadb persistent-client probe — a
        # single ns-timestamp roundtrip, no collection enumeration.
        # Run it on the worker thread because some chromadb backends
        # take a sqlite read-lock under the hood.
        await asyncio.to_thread(client.heartbeat)
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, f"chroma: {type(exc).__name__}"


def _probe_ai_provider() -> tuple[bool, str]:
    try:
        from config import config
        from ai.provider import ai_router
        # AIRouter knows whether the configured primary is currently
        # quota-exhausted or cooling. We treat "primary cooling but
        # fallback live" as ready — readiness is operational, not perfect.
        primary = config.ai_primary_provider
        fallback = config.ai_fallback_provider
        if ai_router._is_provider_available(primary):
            return True, f"primary:{primary}"
        if fallback != "none" and ai_router._is_provider_available(fallback):
            return True, f"fallback:{fallback}"
        return False, "ai: no provider available"
    except Exception as exc:  # noqa: BLE001
        return False, f"ai: {type(exc).__name__}"


# ── Route registration ────────────────────────────────────────────────────────


def _register_observability(app: FastAPI) -> None:
    @app.get("/healthz", include_in_schema=False)
    async def _healthz() -> dict:
        # Liveness: process is up. No deps. Used by container orchestrators
        # to decide whether to restart the pod.
        return {
            "status": "ok",
            "version": _VERSION,
            "uptime_s": int(_uptime_seconds()),
        }

    @app.get("/readyz", include_in_schema=False)
    async def _readyz() -> Any:
        # Readiness: DB, chroma, AI provider all reachable. A 503 here
        # signals the LB to stop routing new traffic without restarting.
        checks: dict[str, dict[str, Any]] = {}
        db_ok, db_detail = await _probe_db()
        checks["db"] = {"ok": db_ok, "detail": db_detail}
        chroma_ok, chroma_detail = await _probe_chroma()
        checks["chroma"] = {"ok": chroma_ok, "detail": chroma_detail}
        ai_ok, ai_detail = _probe_ai_provider()
        checks["ai"] = {"ok": ai_ok, "detail": ai_detail}
        all_ok = all(c["ok"] for c in checks.values())
        body: dict[str, Any] = {"status": "ready" if all_ok else "not_ready", "checks": checks}
        return JSONResponse(content=body, status_code=200 if all_ok else 503)

    @app.get("/metrics", include_in_schema=False)
    async def _metrics() -> PlainTextResponse:
        return PlainTextResponse(
            content=render_metrics(),
            media_type="text/plain; version=0.0.4",
        )


__all__ = [
    "Counter",
    "Gauge",
    "CorrelationFilter",
    "_register_observability",
    "ai_provider_used_total",
    "ai_router_fallthrough_total",
    "chat_messages_total",
    "chat_tool_calls_total",
    "correlation_id_middleware",
    "get_correlation_id",
    "http_requests_counter_middleware",
    "http_requests_total",
    "render_metrics",
    "voice_stt_total",
    "voice_tts_total",
]
