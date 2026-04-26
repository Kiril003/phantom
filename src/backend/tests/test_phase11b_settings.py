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


class TestPhase11c5AlwaysOnWriteLock:
    """Phase 11c.5 — the always-on feature was disabled after real-user
    testing on 2026-04-26 surfaced unresolved bugs (see
    docs/phase-11c.5/known-issues.md). The PUT handler must reject any
    attempt to set ``voice_always_on_enabled`` to True with HTTP 400 so
    the feature stays off even if an older client tries to flip it."""

    @pytest.mark.asyncio
    async def test_set_voice_always_on_to_true_is_rejected(self) -> None:
        with pytest.raises(HTTPException) as excinfo:
            await set_setting(
                key="voice_always_on_enabled",
                req=SetValueRequest(value=True),
                user=None,  # type: ignore[arg-type]
            )
        assert excinfo.value.status_code == 400
        detail = excinfo.value.detail
        assert isinstance(detail, dict)
        assert detail.get("error") == "feature_disabled"
        assert "Phase 11c.5" in detail.get("message", "")

    @pytest.mark.asyncio
    async def test_set_voice_always_on_to_false_is_not_rejected_by_lock(
        self,
    ) -> None:
        """The write-lock must only fire on True. A False write should pass
        the lock (it may still fail later for other reasons — auth, DB —
        but those are out of scope here; the lock itself must let it
        through)."""
        # The handler will fail later (no User → AttributeError) but the
        # write-lock MUST NOT be the failure mode. We assert that no
        # HTTPException with status 400 / feature_disabled bubbles up.
        try:
            await set_setting(
                key="voice_always_on_enabled",
                req=SetValueRequest(value=False),
                user=None,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            assert not (
                exc.status_code == 400
                and isinstance(exc.detail, dict)
                and exc.detail.get("error") == "feature_disabled"
            ), "write-lock fired on False — it must only fire on True"
        except Exception:
            # Any other failure (auth, DB, side-effect) is fine for this
            # test — we only care that the write-lock didn't fire.
            pass
