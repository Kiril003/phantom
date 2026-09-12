"""Day-4 Wave-2 — Block V-5: lifespan G2 parallel warmup
(ADR-RTP-001, `docs/architecture/desktop-shell.md`).

Closes audit U8-PERF-C1 ("cold boot 8-15 s; lanes are independent and
should run via asyncio.gather").

Coverage:

1. ``run_g2_parallel`` actually runs lanes concurrently, not serially.
   Mock all five lanes to sleep 0.3 s → wall-clock < 0.8 s (parallel)
   instead of ≥ 1.5 s (serial × 5).
2. Lane failure is contained: patch one lane to raise → ``run_g2_parallel``
   completes without raising AND the per-lane counter
   ``phantom_lifespan_g2_failures_total{lane=...}`` bumps.
3. Chroma janitor lane is gated by ``config.chroma_janitor_at_startup``
   — when False, the lane is a no-op (preserves Day-3 D3-A-5 opt-out).
4. main.py's lifespan body imports + invokes ``run_g2_parallel`` (we no
   longer have five sequential ``await``s for the G2 bodies).
5. The ``phantom_lifespan_g2_failures_total`` Counter is registered
   (so ``/metrics`` will surface it on bump).
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

import pytest


# ─────────────────────────────────────────── parallelism: wall-clock budget ──


@pytest.mark.asyncio
async def test_g2_lanes_run_in_parallel(monkeypatch):
    """Five lanes × 300 ms each = 1.5 s if sequential. Parallel ≤ 0.8 s.

    The headroom (0.5 s) tolerates loop scheduling overhead + the
    test runner's own cost without flaking on a busy CI host."""
    import lifespan_warmup as lw

    sleep_s = 0.3

    async def _fake_lane(name: str) -> None:
        await asyncio.sleep(sleep_s)

    # Patch all five lanes inside the orchestrator's lane table so the
    # real strategic_memory / Chroma / system_metrics_sampler / voice
    # heavy paths don't run.
    monkeypatch.setattr(
        lw,
        "_G2_LANES",
        (
            ("minilm", lambda: _fake_lane("minilm")),
            ("chroma_eager", lambda: _fake_lane("chroma_eager")),
            ("chroma_janitor", lambda: _fake_lane("chroma_janitor")),
            ("cpu_sampler", lambda: _fake_lane("cpu_sampler")),
            ("voice_preload", lambda: _fake_lane("voice_preload")),
        ),
    )

    t0 = time.perf_counter()
    await lw.run_g2_parallel()
    elapsed = time.perf_counter() - t0

    assert elapsed < 0.8, (
        f"V-5 regression: G2 lanes ran serially (elapsed={elapsed:.3f}s). "
        f"Five lanes × 0.3 s should parallelise to ~0.3 s; got {elapsed:.3f}s. "
        "asyncio.gather wiring broke."
    )
    assert elapsed >= sleep_s * 0.9, (
        f"V-5 sanity: elapsed {elapsed:.3f}s < single-lane sleep — fakes "
        "didn't run? Check monkeypatch path."
    )


@pytest.mark.asyncio
async def test_deferred_lanes_do_not_hold_the_start(monkeypatch):
    """Прогрів не має права тримати вікно зачиненим.

    Заміряно 12.09.2026 на артефакті `b5463b2a`: `voice_preload` 13,3 с,
    `tts_preload` 12,0 с, `minilm` 3,8 с — і все це ПЕРШ ніж людині дозволять
    сказати перше слово. Власник назвав такий старт «нереально повільним», і
    мав рацію: жодна з цих смуг не робить нічого, чого людина просила в першу
    мить. Усі три лише гріють кеш — це записано в їхніх власних докстрінгах.

    Тут доводиться саме те, що мало б бути очевидним і не було: повільна
    ВІДКЛАДЕНА смуга не додає до часу старту ані секунди.
    """
    import lifespan_warmup as lw

    # conftest ставить PHANTOM_SKIP_G2_WARMUP=1 на всю добірку — під ним
    # чисті прогріви взагалі не потрапляють у перелік, і тест доводив би
    # порожнечу. Тут перевіряється ЗВИЧАЙНИЙ шлях продукту.
    monkeypatch.setenv("PHANTOM_SKIP_G2_WARMUP", "0")

    slow, quick = 1.5, 0.05
    finished: list[str] = []

    def _lane(name: str, delay: float):
        async def _run() -> None:
            await asyncio.sleep(delay)
            finished.append(name)
        return _run

    monkeypatch.setattr(
        lw,
        "_G2_LANES",
        (
            ("voice_preload", _lane("voice_preload", slow)),
            ("tts_preload", _lane("tts_preload", slow)),
            ("minilm", _lane("minilm", slow)),
            ("cpu_sampler", _lane("cpu_sampler", quick)),
            ("home_tenant", _lane("home_tenant", quick)),
        ),
    )

    t0 = time.perf_counter()
    await lw.run_g2_parallel()
    elapsed = time.perf_counter() - t0

    assert elapsed < slow / 2, (
        f"старт чекав на прогрів: {elapsed:.2f} с при відкладених смугах по "
        f"{slow} с. Саме так народжуються 34 секунди до першого вікна."
    )
    assert sorted(finished) == ["cpu_sampler", "home_tenant"], (
        f"смуги з побічними діями мусять завершитись ДО повернення "
        f"(маємо {finished!r}) — вони не прогрів, від них залежить вузол"
    )

    # А тепер головне: відкладене таки МУСИТЬ статись, а не зникнути.
    # `asyncio.create_task` без сильного посилання дає збирачеві сміття право
    # прибрати задачу посеред роботи, і «пішло у фон» тихо означає «не буде».
    assert lw._background_lanes, "фонові смуги не втримані — їх збере GC"
    # Чекаємо на САМІ задачі, а не на годинник. Сон із вгаданим запасом —
    # це наступний мигтючий тест: він не описує систему, він описує, наскільки
    # зайнята машина. Тут бар'єр точний за побудовою.
    await asyncio.gather(*list(lw._background_lanes))
    assert sorted(finished) == ["cpu_sampler", "home_tenant", "minilm",
                                "tts_preload", "voice_preload"], (
        f"фоновий прогрів не завершився: {finished!r}"
    )


@pytest.mark.asyncio
async def test_minilm_does_not_load_torch_to_learn_a_file_is_missing(monkeypatch):
    """3,8 секунди, щоб сказати «моделі немає».

    Шлях до тієї відповіді вів через `strategic_memory._get_ef` →
    `build_embedding_function` → chromadb → sentence-transformers → torch.
    Тобто ціну імпорту платив КОЖЕН старт, а відповідь була про відсутній
    файл. Зонд, що відповідає за мілісекунди, уже існував — `model_state`.
    """
    import lifespan_warmup as lw

    monkeypatch.setattr(
        lw, "config", type("C", (), {"embedding_model": "intfloat/e5-small-v2"})()
    )
    import memory.embedding_fn as ef
    monkeypatch.setattr(
        ef, "model_state",
        lambda name: {"present": False, "download_allowed": False,
                      "reason": "модель не встановлена"},
    )

    def _explode():  # pragma: no cover — має не викликатись
        raise AssertionError(
            "смуга полізла у важкий шлях, хоч моделі на диску немає — "
            "це знову імпорт torch заради відповіді про файл"
        )

    import memory.strategic_memory as sm
    monkeypatch.setattr(sm, "_get_ef", lambda: _explode())

    t0 = time.perf_counter()
    await lw._lane_minilm()
    assert time.perf_counter() - t0 < 0.5


# ───────────────────────────────────────────────────── failure containment ──


@pytest.mark.asyncio
async def test_g2_lane_failure_logged_not_fatal(monkeypatch, caplog):
    """A lane raising must NOT abort startup. Counter bumps,
    ``run_g2_parallel`` returns normally, downstream lifespan continues."""
    import lifespan_warmup as lw
    from observability import lifespan_g2_failures_total

    async def _ok_lane() -> None:
        return None

    async def _bad_lane() -> None:
        raise RuntimeError("simulated chroma eager init failure (V-5 test)")

    monkeypatch.setattr(
        lw,
        "_G2_LANES",
        (
            ("minilm", _ok_lane),
            ("chroma_eager", _bad_lane),
            ("chroma_janitor", _ok_lane),
            ("cpu_sampler", _ok_lane),
            ("voice_preload", _ok_lane),
        ),
    )

    # Snapshot counter before to make the assertion delta-aware (other
    # tests may have already bumped it earlier in the session).
    before = _counter_value(lifespan_g2_failures_total, lane="chroma_eager")

    with caplog.at_level(logging.WARNING):
        # Must not raise.
        await lw.run_g2_parallel()

    after = _counter_value(lifespan_g2_failures_total, lane="chroma_eager")
    assert after - before == 1, (
        f"V-5 LEAK: lifespan_g2_failures_total{{lane='chroma_eager'}} "
        f"did not bump (delta={after - before}). Lane escape guard "
        "in run_g2_parallel broken."
    )

    # The escape-guard log message includes the lane name.
    assert any(
        "chroma_eager" in rec.message and "escape" in rec.message.lower()
        for rec in caplog.records
    ), (
        "V-5: expected an 'escape its own except guard' WARN naming "
        "the failed lane — operator-facing audit signal missing."
    )


# ──────────────────────────────────────────────────── chroma janitor gating ──


@pytest.mark.asyncio
async def test_chroma_janitor_lane_skipped_when_disabled(monkeypatch):
    """Operator opt-out preserved: setting
    ``config.chroma_janitor_at_startup = False`` → lane returns
    without doing work and without bumping the failure counter."""
    import lifespan_warmup as lw
    from config import config
    from observability import lifespan_g2_failures_total

    prev = config.chroma_janitor_at_startup
    config.chroma_janitor_at_startup = False
    before = _counter_value(lifespan_g2_failures_total, lane="chroma_janitor")
    try:
        # Should be a no-op — no SQLAlchemy session opened, no Chroma
        # imports triggered.
        await lw._lane_chroma_janitor()
    finally:
        config.chroma_janitor_at_startup = prev

    after = _counter_value(lifespan_g2_failures_total, lane="chroma_janitor")
    assert after == before, (
        "V-5: chroma_janitor lane should be a pure no-op when the "
        "config flag is False; counter must not bump."
    )


# ────────────────────────────────────────────────────────── main.py wiring ──


def test_main_py_invokes_run_g2_parallel():
    """The five inline G2 blocks have to be GONE from main.py — replaced
    by ``await run_g2_parallel()``. If a future refactor accidentally
    re-inlines a warmup, this test catches it."""
    main_py = (
        Path(__file__).resolve().parents[1] / "main.py"
    )
    body = main_py.read_text(encoding="utf-8")
    assert "from lifespan_warmup import run_g2_parallel" in body, (
        "V-5: main.py must import run_g2_parallel from lifespan_warmup"
    )
    assert "await run_g2_parallel()" in body, (
        "V-5 regression: main.py's lifespan must call run_g2_parallel(). "
        "If you re-inlined a warmup lane, refactor it back into a lane "
        "in lifespan_warmup.py — five sequential awaits cost 8-15 s on "
        "cold boot and break the V-5 budget."
    )


def test_main_py_no_inline_minilm_warmup_remains():
    """Belt-and-braces: assert the OLD inline patterns are gone. If they
    coexist with run_g2_parallel(), we'd double-run on every boot."""
    main_py = (
        Path(__file__).resolve().parents[1] / "main.py"
    )
    body = main_py.read_text(encoding="utf-8")
    # The classic inline phrase from the previous lifespan body.
    assert "MiniLM encoder warmed at startup" not in body, (
        "V-5 regression: inline MiniLM warmup body still present in "
        "main.py. The lane was extracted into lifespan_warmup._lane_minilm; "
        "the in-line copy must be removed to avoid double-warmup."
    )
    assert "voice models preload" not in body, (
        "V-5 regression: inline voice preload body still present in main.py"
    )


# ───────────────────────────────────────────────────────── counter contract ──


def test_lifespan_g2_failures_counter_registered():
    """The Counter must be in observability._REGISTRY so its values
    surface in /metrics."""
    from observability import _REGISTRY, lifespan_g2_failures_total

    assert lifespan_g2_failures_total in _REGISTRY, (
        "V-5: phantom_lifespan_g2_failures_total not registered with "
        "_REGISTRY — /metrics will not expose it."
    )
    # Render must include the metric name and HELP / TYPE lines per
    # the existing Counter.render contract.
    rendered = "\n".join(lifespan_g2_failures_total.render())
    assert "phantom_lifespan_g2_failures_total" in rendered
    assert "# TYPE phantom_lifespan_g2_failures_total counter" in rendered


# ────────────────────────────────────────────────────────────── helpers ──


def _counter_value(counter, **labels) -> float:
    """Read a labelled Counter value through its public render lines.

    Counter.render yields Prometheus text-format lines; for the labelled
    case the line looks like::

        phantom_lifespan_g2_failures_total{lane="chroma_eager"} 3

    We grep for the label fragment + parse the trailing float.
    """
    rendered = list(counter.render())
    label_frag = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
    for line in rendered:
        if line.startswith("#"):
            continue
        if label_frag and label_frag not in line:
            continue
        # Last whitespace-separated token is the numeric value.
        try:
            return float(line.rsplit(" ", 1)[-1])
        except ValueError:
            continue
    return 0.0
