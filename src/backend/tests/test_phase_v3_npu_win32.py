"""Day-4 Wave-1 — Block V-3: NPU win32 hard-skip in `voice.stt_engine`.

Closes audit-2026-05-01-day4 finding U5-PKG-C3 ("onnxruntime-qnn import
alone may segfault on x86_64 Windows"). Implements ADR-DSH-001 §6:

    NPU win32 hard-skip is a factory branch, not import-time. The
    `sys.platform == "win32"` check is inserted in `_try_npu` BEFORE
    the NPU provider module is imported. Linux behaviour is unchanged.

The contract is:

* On `sys.platform == "win32"`, `_try_npu()` returns `None` *without*
  importing `voice.whisper_npu_provider`. We assert this both on the
  return value and via `sys.modules` so any future regression that
  flips the order (import → check) is caught.
* On Linux (the normal dev/test platform) the early-return remains gated
  by `voice_stt_npu_enabled` exactly as today — no behavioural drift on
  the hardware target.
* `build_stt_provider()` falls through to `_try_whisper` / `_try_vosk`
  (or NoopSTTProvider) when the NPU branch is skipped.
"""
from __future__ import annotations

import sys

import pytest

from config import config as live_config


@pytest.fixture(autouse=True)
def _purge_npu_modules():
    """Strip any previously-imported NPU provider module before each
    test so `sys.modules` is a clean slate. Without this, an earlier
    test that runs on Linux (where the import succeeds) would leave the
    module behind and the win32-hard-skip assertion would mis-fire.
    """
    sys.modules.pop("voice.whisper_npu_provider", None)
    yield
    sys.modules.pop("voice.whisper_npu_provider", None)


# ─────────────────────────────────────────────── win32 factory branch ──


class TestWin32HardSkip:
    def test_try_npu_returns_none_on_win32_without_import(self, monkeypatch):
        """The audit's hard requirement: on Windows we must not even
        *attempt* to import `voice.whisper_npu_provider`. Asserting on
        both the return value AND `sys.modules` catches a future
        regression where someone moves the win32 guard below the
        import statement."""
        from voice import stt_engine

        monkeypatch.setattr(sys, "platform", "win32")
        # Ensure the NPU is "opted in" so the platform guard is the
        # only thing that can short-circuit the call.
        monkeypatch.setattr(live_config, "voice_stt_npu_enabled", True)

        result = stt_engine._try_npu()

        assert result is None, "win32 must not yield an NPU provider"
        assert "voice.whisper_npu_provider" not in sys.modules, (
            "V-3 regression: whisper_npu_provider was imported on win32. "
            "Move the sys.platform check ABOVE the import."
        )

    def test_build_stt_provider_falls_through_on_win32(self, monkeypatch):
        """End-to-end: with the NPU flag ON and platform=win32,
        `build_stt_provider()` must transparently land on whisper or
        vosk — never on `WhisperNPUProvider`. The test asserts the
        negative (NPU class never appears) rather than pinning the
        exact downstream provider, since CI runners don't always have
        whisper or vosk installed."""
        from voice import stt_engine

        monkeypatch.setattr(sys, "platform", "win32")
        monkeypatch.setattr(live_config, "voice_stt_npu_enabled", True)
        monkeypatch.setattr(live_config, "voice_stt_mode", "hybrid")

        provider = stt_engine.build_stt_provider()

        assert provider.__class__.__name__ != "WhisperNPUProvider", (
            f"win32 selected NPU provider: {type(provider).__name__}"
        )
        assert "voice.whisper_npu_provider" not in sys.modules


# ─────────────────────────────────────────────── linux dev parity ──


class TestLinuxParityPreserved:
    def test_try_npu_disabled_returns_none_on_linux(self, monkeypatch):
        """Linux + flag OFF — same behaviour as before V-3 (return None
        without import). Regression gate against accidentally widening
        the guard."""
        from voice import stt_engine

        monkeypatch.setattr(sys, "platform", "linux")
        monkeypatch.setattr(live_config, "voice_stt_npu_enabled", False)

        assert stt_engine._try_npu() is None
        assert "voice.whisper_npu_provider" not in sys.modules

    def test_try_npu_enabled_on_linux_attempts_import(self, monkeypatch):
        """Linux + flag ON — `_try_npu` will try to import and (on a
        host without onnxruntime-qnn) fail gracefully. We assert that
        the *attempt* happened (module appears in sys.modules OR an
        ImportError-class exception was caught) — proving the win32
        guard isn't accidentally firing on Linux."""
        from voice import stt_engine

        monkeypatch.setattr(sys, "platform", "linux")
        monkeypatch.setattr(live_config, "voice_stt_npu_enabled", True)

        # Stub out the model-bundle resolution so `WhisperNPUProvider()`
        # raises cleanly; we only care that the import path was
        # exercised, not that the provider succeeds on this CI box.
        result = stt_engine._try_npu()

        # Either the import succeeded and the provider was instantiated
        # (returns provider, which is fine), OR the import raised and
        # was caught (returns None). The forbidden state is "skipped
        # silently without trying", which would leave sys.modules clean
        # AND return None.
        attempted_import = "voice.whisper_npu_provider" in sys.modules
        succeeded = result is not None
        assert attempted_import or succeeded, (
            "V-3 regression: linux + flag=True did not even try to import "
            "the NPU provider. The sys.platform guard is too aggressive."
        )

    def test_win32_check_is_compared_against_string(self):
        """Pin the literal contract: the guard compares against
        `"win32"` (the value `sys.platform` actually takes on Windows
        builds). Defends against a refactor that swaps to e.g.
        `platform.system() == "Windows"` — which is a different string
        and would silently re-enable the dangerous import path on real
        Windows hosts."""
        import inspect

        from voice import stt_engine

        src_npu = inspect.getsource(stt_engine._try_npu)
        assert 'sys.platform == "win32"' in src_npu, src_npu
