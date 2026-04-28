"""Day-3 audit-2026-04-30 — Block P commit P-3.

Closes F-02 + F-03: the duplicated inline state-transition broadcast
at `main.py:69-75 + 105-111` is replaced with a single
`event_bus.emit("state.transition", ...)` call at each context-loop
site. The `dispatch.state_broadcaster` subscriber (P-1) wires once
at lifespan startup and ships the WS payload + OLED side effect.
"""

from __future__ import annotations

import asyncio


# ── Subscriber actually wired at lifespan ─────────────────────────────────────


class TestDispatchSubscriberWired:
    def test_lifespan_attaches_state_transition_subscriber(self):
        """After app startup, an `event_bus.emit("state.transition", ...)`
        call MUST land at the registered handler. Without the wiring
        the event is fire-and-forget and the WS hub never sees it."""
        from fastapi.testclient import TestClient
        from core.event_bus import event_bus
        from dispatch.state_broadcaster import StateBroadcaster

        from main import create_app
        app = create_app()
        with TestClient(app):
            # Lifespan startup has fired by the time we're inside.
            handlers = event_bus._handlers.get(StateBroadcaster.EVENT, [])
            assert handlers, (
                "P-3 regression: dispatch.state_broadcaster not "
                "registered at lifespan — the new emit() at main.py "
                "context-loop sites would be a no-op."
            )

    def test_emit_drives_ws_broadcast_via_subscriber(self):
        """End-to-end: emit a `StateTransitionEvent` after lifespan
        opens, the registered subscriber should ship to the WS hub.
        We patch `hub.broadcast` to capture the call."""
        from fastapi.testclient import TestClient
        from core.event_bus import event_bus
        from dispatch.state_broadcaster import (
            StateBroadcaster, StateTransitionEvent,
        )

        captured: list[tuple[str, str, dict]] = []

        async def _capturing_broadcast(topic: str, kind: str, body: dict) -> None:
            captured.append((topic, kind, body))

        # Patch the WS hub's broadcast BEFORE the app comes up so the
        # subscriber registered at lifespan binds the patched callable.
        # The subscriber holds a closure over `hub.broadcast`, so we
        # can't swap mid-flight; rebuild a fresh app under monkeypatch.
        import api.websocket_hub as wh
        original = wh.hub.broadcast
        wh.hub.broadcast = _capturing_broadcast
        try:
            from main import create_app
            app = create_app()
            with TestClient(app):
                # Drive an event; subscriber should ship a WS frame.
                async def _drive() -> None:
                    await event_bus.emit_async(
                        StateBroadcaster.EVENT,
                        StateTransitionEvent(
                            from_state="A", to_state="B",
                            trigger="test_p3", timestamp=1.0, auto=True,
                        ),
                    )
                asyncio.run(_drive())
        finally:
            wh.hub.broadcast = original

        # Filter only the test's emission — lifespan + readyz might
        # broadcast other things during startup.
        ours = [c for c in captured if c[2].get("trigger") == "test_p3"]
        assert ours, captured
        topic, kind, body = ours[0]
        assert topic == "state" and kind == "transition"
        assert body == {
            "from": "A", "to": "B", "trigger": "test_p3",
            "timestamp": 1.0, "auto": True,
        }


# ── No more inline duplicated broadcast literals ─────────────────────────────


class TestInlineBroadcastDeleted:
    def test_main_py_no_inline_state_transition_payload(self):
        """The two literal `hub.broadcast("state", "transition", {...})`
        sites at the old line numbers MUST be gone — collapsed into
        the single subscriber. A regression here would re-introduce
        the F-02/F-03 dup."""
        from pathlib import Path
        repo = Path(__file__).resolve().parents[3]
        text = (repo / "src" / "backend" / "main.py").read_text()
        # Count remaining inline state-transition broadcasts. Allow
        # zero — the subscriber owns it now.
        assert text.count('hub.broadcast("state", "transition"') == 0, (
            "P-3 regression: inline state-transition broadcast still "
            "present in main.py."
        )
        # And the new emit pattern is in place at both context-loop
        # sites — count the literal `"state.transition"` emit token to
        # confirm. There are exactly two emit sites (background loop +
        # active-batch loop). The subscriber side reads via
        # `StateBroadcaster.EVENT` (class attribute), not the literal.
        assert text.count('"state.transition"') >= 2, (
            f"P-3 regression: state.transition emit pattern missing "
            f"from one or both context-loop sites — found "
            f"{text.count('\"state.transition\"')} instances, expected "
            f"≥ 2."
        )
