"""Day-4 Wave-2 V-5 — lifespan G2 parallel warmup helpers (ADR-RTP-001).

Splits the five independent G2 warmup lanes (MiniLM, Chroma eager, Chroma
janitor, CPU sampler, voice preload) so they run concurrently via
``asyncio.gather(return_exceptions=True)`` instead of the historical
strictly-serial five awaits in `main.lifespan`.

Each lane wraps its own exception path and bumps
``phantom_lifespan_g2_failures_total{lane=...}`` on failure so operators
see the regression in /metrics without grepping logs.

Performance budget (per ADR-RTP-001 / FINDINGS.md U8-PERF-C1):
- Today (serial): cold boot 8-15 s.
- Target (this block): G1+G2 ≤ 2000 ms p95.
- The slowest single lane bounds the gate. MiniLM warm ~600 ms warm,
  Chroma eager 600-1500 ms cold, voice preload 800-2000 ms cold; running
  them in parallel drops the wall-clock to whichever single lane is
  the slowest (typically voice on cold flash).

Failure semantics: each lane's `try/except` logs WARN + bumps the
counter. ``return_exceptions=True`` on the gather is defence-in-depth —
if a future refactor lets an exception escape a lane, the gather
returns the exception object instead of raising; we re-log + bump
the counter instead of aborting startup. **No G2 failure ever aborts
the lifespan.** The lifespan downstream stages (state broadcaster,
context loop, agent runtime) take over even if the warmups partially
fail; /readyz already exposes the downstream effects.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from config import config
from observability import lifespan_g2_failures_total

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────── lanes ──


async def _lane_minilm() -> None:
    """G2 lane: MiniLM (sentence-transformers) encoder warmup so the FIRST
    chat message doesn't pay 1-3 s of cold-load latency on the event
    loop's worker thread (Phase 11c.5 Bug 2)."""
    try:
        from memory.strategic_memory import _get_ef

        def _warm() -> None:
            _get_ef()(["warmup"])

        await asyncio.to_thread(_warm)
        logger.info("MiniLM encoder warmed at startup")
    except Exception as exc:  # noqa: BLE001
        logger.warning("MiniLM warmup skipped: %s", exc)
        lifespan_g2_failures_total.inc(lane="minilm")


async def _lane_chroma_eager() -> None:
    """G2 lane: ChromaDB PersistentClient eager open + collection enumerate.
    Audit F-17: without this the FIRST /readyz hit pays a 2-3 s cold
    scan over leaked-collection dirs and K8s pulls a healthy daemon out
    of the LB rotation.

    Audit D-3: migration and eager-init are two independent concerns
    that used to share one try/except — a broken migration import took
    ``init_chroma_eager()`` down with it, which is the exact regression
    this lane exists to prevent. They now run in their own try/except
    blocks so a migration failure can never block eager init (or vice
    versa)."""
    # Step 1/2 — legacy collection migration. Best-effort; never blocks
    # eager init below.
    try:
        from memory.migrate_chroma_v1 import migrate_old_collections
        from db.database import get_session

        async with get_session() as db:
            migration_stats = await migrate_old_collections(db)
        logger.info("ChromaDB migration completed on startup: %s", migration_stats)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ChromaDB migration skipped: %s", exc)
        lifespan_g2_failures_total.inc(lane="chroma_eager")

    # Step 2/2 — eager client open + collection enumerate. Independent
    # of the migration step above by construction.
    try:
        from memory.strategic_memory import init_chroma_eager

        chroma_init = await init_chroma_eager()
        if chroma_init.get("ok") is False:
            logger.warning("Chroma eager init failed: %s", chroma_init.get("error"))
            lifespan_g2_failures_total.inc(lane="chroma_eager")
        else:
            logger.info(
                "Chroma client warmed at startup (%d collections, %d ms)",
                int(chroma_init.get("collections", 0)),
                int(chroma_init.get("elapsed_ms", 0)),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Chroma eager init skipped: %s", exc)
        lifespan_g2_failures_total.inc(lane="chroma_eager")


async def _lane_chroma_janitor() -> None:
    """G2 lane: prune orphaned Chroma collections + their UUID-named
    filesystem dirs. Day-3 D3-A-5 wired the janitor at lifespan; without
    a sweep at boot, test fixtures leak transient `user_*` collections
    monotonically (105 MB → 122 MB / 609 → 705 dirs in 24 h, audit
    measurement). Operator can opt out via `chroma_janitor_at_startup`
    for deploys whose chroma volume is too large for the scan budget."""
    if not config.chroma_janitor_at_startup:
        return
    try:
        from memory.strategic_memory import (
            prune_orphan_collections,
            prune_orphan_dirs,
        )
        from db.database import get_session
        from db.models import User
        from sqlalchemy import select as _select

        async with get_session() as db:
            rows = await db.execute(_select(User.id))
            known_user_ids = {row[0] for row in rows.all()}
        sql_pass = await prune_orphan_collections(known_user_ids)
        fs_pass = await prune_orphan_dirs()
        logger.info(
            "Chroma janitor: SQL deleted=%d kept=%d; FS deleted=%d "
            "freed=%.1f MB",
            len(sql_pass.get("deleted") or []),
            int(sql_pass.get("kept", 0)),
            len(fs_pass.get("deleted_dirs") or []),
            (fs_pass.get("freed_bytes") or 0) / (1024 * 1024),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Chroma janitor at startup skipped: %s", exc)
        lifespan_g2_failures_total.inc(lane="chroma_janitor")


async def _lane_cpu_sampler() -> None:
    """G2 lane: 1 Hz CPU sampler so the chat-tool `get_system_metrics`
    handler reads a cached value instead of blocking on
    ``psutil.cpu_percent(interval=...)`` per call (Day-2 D2-D-cpu /
    PERF-17b). Cheap background task — one psutil read per second."""
    try:
        import system_metrics_sampler
        await system_metrics_sampler.start()
    except Exception as exc:  # noqa: BLE001
        logger.warning("CPU sampler failed to start: %s", exc)
        lifespan_g2_failures_total.inc(lane="cpu_sampler")


async def _lane_voice_preload() -> None:
    """G2 lane: preload voice singletons so the first /ws/voice connect
    doesn't pay 8-10 s of cold model loading on the event-loop's worker
    thread (Phase 12.0 / Phase 11c.5 Bug 2). Voice path lazy-fails on
    cold connect if this lane skipped — first WS hit just waits longer."""
    try:
        from voice.pipeline import preload_voice_models
        from paths import resolve_data_dir
        silero_path = resolve_data_dir("voice_models") / "silero-vad" / "silero_vad.onnx"
        statuses = await asyncio.to_thread(
            preload_voice_models,
            str(silero_path) if silero_path.is_file() else None,
        )
        logger.info("voice models preload: %s", statuses)
    except Exception as exc:  # noqa: BLE001
        logger.warning("voice model preload skipped: %s", exc)
        lifespan_g2_failures_total.inc(lane="voice_preload")


# ─────────────────────────────────────────────────────────────── orchestrator ──



async def _lane_home_tenant() -> None:
    """Кожен користувач мусить мати свій простір.

    SaaS-шар зробив tenant обов'язковим для аналітики, чату й решти
    роутів, але жодного простору ніхто не створює — свіже ядро віддавало
    403 «User does not belong to any tenant» на власний перший екран.
    Питати такого в оператора не можна: простір — це не конфігурація.
    """
    try:
        import uuid
        from db.database import get_session
        from db.models import Tenant, User
        from sqlalchemy import select as _select

        async with get_session() as db:
            orphans = (await db.execute(
                _select(User).where(User.tenant_id.is_(None))
            )).scalars().all()
            if not orphans:
                return
            tenant = (await db.execute(_select(Tenant).limit(1))).scalar_one_or_none()
            if tenant is None:
                tenant = Tenant(
                    id=str(uuid.uuid4()),
                    name="Особистий простір",
                    slug="home",
                    is_active=True,
                )
                db.add(tenant)
                await db.flush()
            for user in orphans:
                user.tenant_id = tenant.id
            await db.commit()
            logger.info("home tenant: %d користувач(ів) прив'язано", len(orphans))
    except Exception as exc:  # noqa: BLE001
        logger.warning("home tenant lane skipped: %s", exc)
        lifespan_g2_failures_total.inc(lane="home_tenant")


_G2_LANES = (
    ("minilm", _lane_minilm),
    ("chroma_eager", _lane_chroma_eager),
    ("chroma_janitor", _lane_chroma_janitor),
    ("cpu_sampler", _lane_cpu_sampler),
    ("voice_preload", _lane_voice_preload),
    ("home_tenant", _lane_home_tenant),
)


async def run_g2_parallel() -> None:
    """Run the five G2 warmup lanes concurrently.

    Per-lane failure is contained inside each lane (WARN + counter bump
    at observation point). ``return_exceptions=True`` is a defence-in-
    depth — if a future refactor lets an exception escape a lane the
    gather returns the exception object instead of raising; we still
    log + bump the counter.

    The wall-clock returned is whichever lane took longest. Operators
    monitoring /metrics see lane health via
    ``phantom_lifespan_g2_failures_total{lane=...}``.
    """
    coros = [lane_fn() for _name, lane_fn in _G2_LANES]
    results = await asyncio.gather(*coros, return_exceptions=True)
    for (name, _fn), result in zip(_G2_LANES, results):
        if isinstance(result, BaseException):
            # Should not normally happen — each lane wraps its own
            # except block. Belt-and-braces for an audit-class refactor.
            logger.warning(
                "lifespan G2 lane %s escaped its own except guard: %s",
                name,
                result,
            )
            lifespan_g2_failures_total.inc(lane=name)
