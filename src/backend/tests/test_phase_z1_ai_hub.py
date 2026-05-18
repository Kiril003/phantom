"""Day-4 Wave-2 Z-1 — AIHub class + ProviderCapability + locality-first
pick (ADR-HUB-001..003).

Coverage:

1. ProviderCapability is a frozen dataclass with the 7 ADR fields.
2. AIHub.register raises ValueError on bad inputs (empty provider,
   negative latency, non-ProviderCapability arg).
3. register is idempotent: registering (gemini, chat) twice keeps
   one row keyed on (provider, task_class).
4. pick(task_class) prefers locality=local when prefer='auto'.
5. pick(task_class) within a locality bucket picks the lowest
   latency_ms_p50.
6. pick(prefer='local') filters to local-only.
7. pick(prefer='remote') filters to remote-only.
8. pick raises NoCapabilityError when no row matches OR when all
   matches are unavailable.
9. route_state ring records each pick with `changed` flag set on
   the FIRST observation of a new provider for a task_class.
10. route_state is bounded (limit clamps).
11. dispatch raises NotImplementedError (Day-4 stub; Z-3 fills in).
12. register_default_capabilities populates Gemini+Ollama for
    chat/chat_subtask and they're pickable.
13. The lazy singleton `ai_hub` re-uses the same instance across
    `from ai.hub import ai_hub` imports.
"""
from __future__ import annotations

import pytest


# ────────────────────────────────────────────── ProviderCapability ──


class TestProviderCapabilityShape:
    def test_frozen_dataclass(self):
        from ai.hub import ProviderCapability

        cap = ProviderCapability(
            provider="gemini",
            task_class="chat",
            modality="text",
            latency_ms_p50=900.0,
            quality_tier="balanced",
            locality="remote",
            available=True,
        )
        with pytest.raises(Exception):
            cap.available = False  # type: ignore[misc]

    def test_field_set_matches_adr(self):
        from dataclasses import fields
        from ai.hub import ProviderCapability

        names = {f.name for f in fields(ProviderCapability)}
        assert names == {
            "provider",
            "task_class",
            "modality",
            "latency_ms_p50",
            "quality_tier",
            "locality",
            "available",
        }


# ────────────────────────────────────────────────────── register ──


class TestAIHubRegister:
    @pytest.fixture
    def hub(self):
        from ai.hub import AIHub

        return AIHub()

    def test_rejects_non_capability(self, hub):
        with pytest.raises(ValueError):
            hub.register({"provider": "gemini"})  # type: ignore[arg-type]

    def test_rejects_empty_provider(self, hub):
        from ai.hub import ProviderCapability

        with pytest.raises(ValueError):
            hub.register(
                ProviderCapability(
                    provider="",
                    task_class="chat",
                    modality="text",
                    latency_ms_p50=900.0,
                    quality_tier="balanced",
                    locality="remote",
                    available=True,
                )
            )

    def test_rejects_negative_latency(self, hub):
        from ai.hub import ProviderCapability

        with pytest.raises(ValueError):
            hub.register(
                ProviderCapability(
                    provider="gemini",
                    task_class="chat",
                    modality="text",
                    latency_ms_p50=-1.0,
                    quality_tier="balanced",
                    locality="remote",
                    available=True,
                )
            )

    def test_register_is_idempotent(self, hub):
        from ai.hub import ProviderCapability

        cap1 = ProviderCapability(
            provider="gemini",
            task_class="chat",
            modality="text",
            latency_ms_p50=900.0,
            quality_tier="balanced",
            locality="remote",
            available=True,
        )
        cap2 = ProviderCapability(
            provider="gemini",
            task_class="chat",
            modality="text",
            latency_ms_p50=750.0,  # updated p50
            quality_tier="balanced",
            locality="remote",
            available=True,
        )
        hub.register(cap1)
        hub.register(cap2)
        rows = hub.list_providers()
        # One row, latest p50 retained.
        assert len(rows) == 1
        assert rows[0].latency_ms_p50 == 750.0


# ──────────────────────────────────────────────────────── pick ──


class TestAIHubPick:
    @pytest.fixture
    def hub(self):
        from ai.hub import AIHub, ProviderCapability

        h = AIHub()
        h.register(
            ProviderCapability(
                provider="gemini",
                task_class="chat",
                modality="text",
                latency_ms_p50=900.0,
                quality_tier="balanced",
                locality="remote",
                available=True,
            )
        )
        h.register(
            ProviderCapability(
                provider="ollama",
                task_class="chat",
                modality="text",
                latency_ms_p50=1800.0,
                quality_tier="fast",
                locality="local",
                available=True,
            )
        )
        h.register(
            ProviderCapability(
                provider="ollama-fast",
                task_class="chat",
                modality="text",
                latency_ms_p50=1200.0,
                quality_tier="fast",
                locality="local",
                available=True,
            )
        )
        return h

    def test_auto_prefers_local(self, hub):
        h = hub.pick("chat")
        assert h.capability.locality == "local"

    def test_local_bucket_picks_lowest_latency(self, hub):
        # ollama-fast (1200) beats ollama (1800).
        h = hub.pick("chat", prefer="local")
        assert h.capability.provider == "ollama-fast"

    def test_explicit_remote_picks_gemini(self, hub):
        h = hub.pick("chat", prefer="remote")
        assert h.capability.provider == "gemini"

    def test_no_capability_raises(self, hub):
        from ai.hub import NoCapabilityError

        with pytest.raises(NoCapabilityError):
            hub.pick("vision")  # nothing registered for vision

    def test_unavailable_capability_filtered(self, hub):
        from ai.hub import AIHub, NoCapabilityError, ProviderCapability

        h = AIHub()
        h.register(
            ProviderCapability(
                provider="gemini",
                task_class="chat",
                modality="text",
                latency_ms_p50=900.0,
                quality_tier="balanced",
                locality="remote",
                available=False,  # cooling
            )
        )
        with pytest.raises(NoCapabilityError):
            h.pick("chat")


# ─────────────────────────────────────────────── decision ring ──


class TestAIHubRouteState:
    def test_first_pick_marks_changed_true(self):
        from ai.hub import AIHub, ProviderCapability

        h = AIHub()
        h.register(
            ProviderCapability(
                provider="gemini",
                task_class="chat",
                modality="text",
                latency_ms_p50=900.0,
                quality_tier="balanced",
                locality="remote",
                available=True,
            )
        )
        h.pick("chat")
        rs = h.route_state()
        assert rs[-1]["provider"] == "gemini"
        assert rs[-1]["changed"] is True
        assert rs[-1]["previous_provider"] is None

    def test_repeated_pick_marks_changed_false(self):
        from ai.hub import AIHub, ProviderCapability

        h = AIHub()
        h.register(
            ProviderCapability(
                provider="gemini",
                task_class="chat",
                modality="text",
                latency_ms_p50=900.0,
                quality_tier="balanced",
                locality="remote",
                available=True,
            )
        )
        h.pick("chat")
        h.pick("chat")
        rs = h.route_state()
        assert rs[-1]["changed"] is False, (
            "Z-1: a repeated pick of the same provider must report "
            "changed=False so the route_decision_total counter only "
            "fires on real flips."
        )

    def test_route_state_limit_clamped(self):
        from ai.hub import AIHub

        h = AIHub()
        # No registrations → no picks; ring is empty; limit clamping
        # still works without raising.
        assert h.route_state(limit=5) == []
        assert h.route_state(limit=-1) == []
        assert h.route_state(limit=10000) == []


# ─────────────────────────────────────────────────── dispatch stub ──


class TestAIHubDispatchStub:
    @pytest.mark.asyncio
    async def test_dispatch_raises_not_implemented(self):
        from ai.hub import AIHub, ProviderCapability

        h = AIHub()
        # Register something so pick() doesn't raise NoCapabilityError
        h.register(
            ProviderCapability(
                provider="stub",
                task_class="vision",
                modality="image",
                latency_ms_p50=100.0,
                quality_tier="balanced",
                locality="local",
                available=True,
            )
        )
        with pytest.raises(NotImplementedError):
            await h.dispatch("vision", {})


# ─────────────────────────────────────────────────── singleton ──


class TestSingletonAndDefaults:
    def test_get_ai_hub_returns_same_instance(self):
        from ai.hub import get_ai_hub

        a = get_ai_hub()
        b = get_ai_hub()
        assert a is b

    def test_register_default_capabilities_populates_gemini_and_ollama(self):
        from ai.hub import (
            AIHub,
            register_default_capabilities,
        )

        h = AIHub()
        register_default_capabilities(hub=h)
        rows = h.list_providers()
        providers = {r.provider for r in rows}
        assert {"gemini", "ollama"} <= providers
        # Every default registration is for chat or chat_subtask.
        for r in rows:
            assert r.task_class in ("chat", "chat_subtask")
            assert r.available is True
