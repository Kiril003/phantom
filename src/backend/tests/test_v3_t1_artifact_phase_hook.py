"""T1 — on_phase hook in build_artifact.

Asserts:
- callback fired in order: draft → critiquing → polishing → done
- absent callback ⇒ byte-identical to pre-hook behaviour (regression)
- callback exceptions are swallowed (never break the build)
- phases and html previews match expectations at each point
"""
from __future__ import annotations
import pytest


DOC = "<!doctype html><html><body><canvas id=c></canvas></body></html>"
BETTER = "<!doctype html><html><body><main>better</main></body></html>"


@pytest.mark.asyncio
async def test_on_phase_fires_in_order_draft_critiquing_done(monkeypatch):
    from ai import artifact_studio
    from ai.artifact_studio import Brief

    calls: list[tuple[str, str | None]] = []
    call_count = 0

    async def fake_raw(*, system_prompt, user_message, model, max_output_tokens,
                       temperature=0.7):
        nonlocal call_count
        call_count += 1
        return DOC if call_count == 1 else "OK"

    monkeypatch.setattr(artifact_studio.ai_router, "generate_raw", fake_raw)

    async def cb(phase: str, preview: str | None) -> None:
        calls.append((phase, preview))

    title, html = await artifact_studio.build_artifact(
        Brief(title="T", request="r", hint=""), user_id="u", on_phase=cb
    )
    assert title == "T"
    assert html.strip() == DOC

    phases = [p for p, _ in calls]
    # With max_revisions=2: draft → critiquing → (OK → stop) → done
    assert phases[0] == "draft"
    assert "critiquing" in phases
    assert phases[-1] == "done"
    # draft preview is the html
    assert calls[0][1] is not None and "<!doctype" in calls[0][1]
    # done preview is final html
    assert calls[-1][1] is not None and "<!doctype" in calls[-1][1]


@pytest.mark.asyncio
async def test_on_phase_polishing_fires_after_rewrite(monkeypatch):
    from ai import artifact_studio
    from ai.artifact_studio import Brief

    calls: list[tuple[str, str | None]] = []
    call_count = 0

    async def fake_raw(*, system_prompt, user_message, model, max_output_tokens,
                       temperature=0.7):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return DOC      # draft
        if call_count == 2:
            return BETTER   # critique rewrites (not "OK")
        return "OK"         # second critique: stop

    monkeypatch.setattr(artifact_studio.ai_router, "generate_raw", fake_raw)

    async def cb(phase: str, preview: str | None) -> None:
        calls.append((phase, preview))

    _t, html = await artifact_studio.build_artifact(
        Brief(title="T", request="r", hint=""), user_id="u", on_phase=cb
    )
    phases = [p for p, _ in calls]
    assert "draft" in phases
    assert "critiquing" in phases
    assert "polishing" in phases
    assert phases[-1] == "done"
    # polishing preview must be the improved html
    polishing_preview = next(v for p, v in calls if p == "polishing")
    assert polishing_preview is not None and "better" in polishing_preview


@pytest.mark.asyncio
async def test_absent_callback_behaviour_unchanged(monkeypatch):
    """No on_phase ⇒ exact same (title, html) return — regression guard."""
    from ai import artifact_studio
    from ai.artifact_studio import Brief

    call_count = 0

    async def fake_raw(*, system_prompt, user_message, model, max_output_tokens,
                       temperature=0.7):
        nonlocal call_count
        call_count += 1
        return DOC if call_count == 1 else "OK"

    monkeypatch.setattr(artifact_studio.ai_router, "generate_raw", fake_raw)

    title, html = await artifact_studio.build_artifact(
        Brief(title="Pulse", request="r", hint=""), user_id="u"
        # no on_phase kwarg
    )
    assert title == "Pulse"
    assert html.strip() == DOC


@pytest.mark.asyncio
async def test_callback_exception_does_not_abort_build(monkeypatch):
    from ai import artifact_studio
    from ai.artifact_studio import Brief

    call_count = 0

    async def fake_raw(*, system_prompt, user_message, model, max_output_tokens,
                       temperature=0.7):
        nonlocal call_count
        call_count += 1
        return DOC if call_count == 1 else "OK"

    monkeypatch.setattr(artifact_studio.ai_router, "generate_raw", fake_raw)

    async def boom(phase: str, preview: str | None) -> None:
        raise RuntimeError("callback exploded")

    title, html = await artifact_studio.build_artifact(
        Brief(title="T", request="r", hint=""), user_id="u", on_phase=boom
    )
    # Must still return normally despite callback blowing up
    assert title == "T"
    assert html.strip() == DOC
