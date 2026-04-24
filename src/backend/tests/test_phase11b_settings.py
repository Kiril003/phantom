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

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase11b-settings")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")

from api.routes_settings import (  # noqa: E402
    LABEL_OVERRIDES,
    CATEGORY_SPEC,
    UNIMPLEMENTED_KEYS,
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
