"""
Phase 11b — settings surface tests.

Verifies that the four new always-on config fields are:
  * exposed via the voice group in CATEGORY_SPEC,
  * labelled in LABEL_OVERRIDES,
  * NOT in UNIMPLEMENTED_KEYS (since Phase 11b wires them end-to-end).

Also verifies Phase 11b removed voice_wake_word_enabled + voice_wake_words
from UNIMPLEMENTED_KEYS (they were [soon]-marked; always-on ships them).
"""
from __future__ import annotations

import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase11b-settings")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from api.routes_settings import (  # noqa: E402
    LABEL_OVERRIDES,
    CATEGORY_SPEC,
    UNIMPLEMENTED_KEYS,
    SetValueRequest,
    set_setting,
)


NEW_KEYS = [
    "voice_always_on_enabled",
    "voice_wake_confidence_min",
    "voice_continuation_window_s",
    "voice_mic_duck_on_tts",
]


def _voice_group() -> dict:
    for group in CATEGORY_SPEC:
        if group["id"] == "voice":
            return group
    pytest.fail("voice settings group missing from CATEGORY_SPEC")


class TestAlwaysOnSettingsExposure:
    @pytest.mark.parametrize("key", NEW_KEYS)
    def test_key_in_voice_group(self, key: str) -> None:
        assert key in _voice_group()["keys"], (
            f"{key} must be listed in the voice settings group so the "
            "SettingsPanel can render it"
        )

    @pytest.mark.parametrize("key", NEW_KEYS)
    def test_key_has_label(self, key: str) -> None:
        assert key in LABEL_OVERRIDES, (
            f"{key} needs a LABEL_OVERRIDES entry so the UA label doesn't "
            "fall back to the raw snake_case name"
        )

    @pytest.mark.parametrize("key", NEW_KEYS)
    def test_key_is_not_marked_unimplemented(self, key: str) -> None:
        assert key not in UNIMPLEMENTED_KEYS, (
            f"{key} ships in Phase 11b — [soon] badge is wrong here"
        )


class TestWakeWordSettingsGraduated:
    """Phase 11b wires the wake word too, so these keys should drop out
    of UNIMPLEMENTED_KEYS."""

    @pytest.mark.parametrize(
        "key", ["voice_wake_word_enabled", "voice_wake_words"]
    )
    def test_wake_keys_graduated(self, key: str) -> None:
        assert key not in UNIMPLEMENTED_KEYS, (
            f"{key} was marked [soon] through Phase 07/10; Phase 11b ships "
            "the real always-on implementation so the label should not "
            "carry the [soon] badge any more"
        )


class TestPhase12VoiceModeSettings:
    """Phase 12.0 — replaces the 11c.5 write-lock on voice_always_on_enabled.
    Three new keys (voice_mode / voice_wake_phrase / voice_silence_timeout_ms)
    drive the orchestrator. The legacy key persists as a deprecated alias
    so existing rows don't break startup."""

    PHASE_12_KEYS = [
        "voice_mode",
        "voice_wake_phrase",
        "voice_silence_timeout_ms",
    ]

    @pytest.mark.parametrize("key", PHASE_12_KEYS)
    def test_key_in_voice_group(self, key: str) -> None:
        assert key in _voice_group()["keys"], (
            f"{key} must be listed in the voice group so SettingsPanel can "
            "render the new mode-selection UI"
        )

    @pytest.mark.parametrize("key", PHASE_12_KEYS)
    def test_key_has_label(self, key: str) -> None:
        assert key in LABEL_OVERRIDES, (
            f"{key} needs a Ukrainian label override"
        )

    @pytest.mark.parametrize("key", PHASE_12_KEYS)
    def test_key_is_not_marked_unimplemented(self, key: str) -> None:
        assert key not in UNIMPLEMENTED_KEYS, (
            f"{key} ships wired in Phase 12.0 — [soon] badge is wrong"
        )

    def test_voice_mode_default_is_off(self) -> None:
        # Phase 12.4 — read the field default off the class, not the
        # process-wide ``config`` singleton. Other tests in the suite
        # mutate the singleton (monkeypatch.setattr against a
        # pydantic-settings instance with validate_assignment=True can
        # leave the override in place after teardown), and what we
        # actually want to pin here is the *default*, not the live
        # value.
        from config import PhantomConfig
        assert PhantomConfig.model_fields["voice_mode"].default == "off", (
            "voice_mode must default to 'off' so push-to-talk is the only "
            "active path until the user opts in"
        )

    def test_voice_wake_phrase_has_default(self) -> None:
        from config import PhantomConfig
        default = PhantomConfig.model_fields["voice_wake_phrase"].default
        assert isinstance(default, str)
        assert len(default.strip()) > 0

    def test_voice_silence_timeout_default(self) -> None:
        # Phase 12.4 — default lowered 1500 → 800 ms for conversational
        # responsiveness. Range stays [500, 5000].
        from config import PhantomConfig
        assert PhantomConfig.model_fields["voice_silence_timeout_ms"].default == 800


class TestPhase12VoiceModeValidation:
    """voice_mode is a Literal — Pydantic must reject anything else.
    voice_silence_timeout_ms is bounded [500, 5000] by the model validator.
    voice_wake_phrase must be non-empty and ≤ 50 chars."""

    def test_voice_mode_rejects_invalid_value(self) -> None:
        from config import PhantomConfig
        with pytest.raises(Exception):
            PhantomConfig(voice_mode="garbage")  # type: ignore[arg-type]

    @pytest.mark.parametrize("mode", ["off", "continuous", "wake_word"])
    def test_voice_mode_accepts_all_three(self, mode: str) -> None:
        from config import PhantomConfig
        cfg = PhantomConfig(voice_mode=mode)  # type: ignore[arg-type]
        assert cfg.voice_mode == mode

    def test_silence_timeout_below_min_rejected(self) -> None:
        from config import PhantomConfig
        with pytest.raises(Exception):
            PhantomConfig(voice_silence_timeout_ms=400)

    def test_silence_timeout_above_max_rejected(self) -> None:
        from config import PhantomConfig
        with pytest.raises(Exception):
            PhantomConfig(voice_silence_timeout_ms=6000)

    @pytest.mark.parametrize("ms", [500, 1500, 3000, 5000])
    def test_silence_timeout_in_range_accepted(self, ms: int) -> None:
        from config import PhantomConfig
        cfg = PhantomConfig(voice_silence_timeout_ms=ms)
        assert cfg.voice_silence_timeout_ms == ms

    def test_wake_phrase_empty_rejected(self) -> None:
        from config import PhantomConfig
        with pytest.raises(Exception):
            PhantomConfig(voice_wake_phrase="")

    def test_wake_phrase_too_long_rejected(self) -> None:
        from config import PhantomConfig
        with pytest.raises(Exception):
            PhantomConfig(voice_wake_phrase="x" * 51)


class TestPhase12LegacyAliasUnlocked:
    """The 11c.5 write-lock on voice_always_on_enabled=True is gone — the
    field is now a deprecated alias that still persists but is ignored at
    runtime. PUT-ing it must not raise feature_disabled any more."""

    @pytest.mark.asyncio
    async def test_set_voice_always_on_no_longer_blocked_by_feature_lock(
        self,
    ) -> None:
        """The write must not fail with the 11c.5 feature_disabled error.
        It may still fail downstream (auth/db) — only the lock matters."""
        try:
            await set_setting(
                key="voice_always_on_enabled",
                req=SetValueRequest(value=True),
                user=None,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            assert not (
                exc.status_code == 400
                and isinstance(exc.detail, dict)
                and exc.detail.get("error") == "feature_disabled"
            ), (
                "Phase 11c.5 feature_disabled lock must be removed in 12.0 "
                "— voice_always_on_enabled is a deprecated alias, not a gate"
            )
        except Exception:
            # Any other failure is fine — only the lock matters here.
            pass
