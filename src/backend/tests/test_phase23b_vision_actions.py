"""Phase 23-B — vision.see_screen agent action.

Covers:
* credentials gate (ai_gemini_api_key empty / ai_gemini_model empty)
* screen-capture failure path (ScreenCaptureError → ok=False)
* successful capture → mocked Gemini → structured output
* include_image_b64=True surfaces base64 PNG
* registry exposes the action with SAFE risk
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from agent.actions.base import ActionContext
from agent.actions.vision import SeeScreen


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def _ctx() -> ActionContext:
    return ActionContext(
        task_id="t-23b", step_idx=0, workspace_dir="/tmp", runtime=None,
    )


@dataclass
class _FakeFrame:
    """Stand-in for vision.screen_capture.ScreenFrame."""

    png_bytes: bytes = b"\x89PNG\r\n\x1a\nfake"
    width: int = 1024
    height: int = 600
    region: tuple[int, int, int, int] | None = None
    strategy: str = "fake"
    captured_at: float = 1700000000.0


@dataclass
class _FakeCaptureError:
    """Stand-in for vision.screen_capture.ScreenCaptureError."""

    error: str = "no backend"
    tried: list[str] = field(default_factory=lambda: ["mss", "grim"])


# -----------------------------------------------------------------------------
# Credentials gate
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_see_screen_skips_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "ai_gemini_api_key", "")
    monkeypatch.setattr(cfg, "ai_gemini_model", "gemini-2.5-flash-lite")

    result = await SeeScreen().execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "no_api_key"


@pytest.mark.asyncio
async def test_see_screen_skips_without_model(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "ai_gemini_api_key", "key-123")
    monkeypatch.setattr(cfg, "ai_gemini_model", "")

    result = await SeeScreen().execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "no_model"


# -----------------------------------------------------------------------------
# Capture failure path
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_see_screen_capture_error_returns_not_ok(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "ai_gemini_api_key", "key-123")
    monkeypatch.setattr(cfg, "ai_gemini_model", "gemini-2.5-flash-lite")

    from vision import screen_capture as cap_mod

    async def fake_capture(*, region=None, timeout_s: float = 5.0):
        return cap_mod.ScreenCaptureError(
            error="no display",
            tried=["mss", "grim", "scrot", "import"],
        )

    monkeypatch.setattr(cap_mod, "capture", fake_capture)

    result = await SeeScreen().execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "capture_failed"
    assert result.output.get("error") == "no display"
    assert "mss" in result.output.get("tried", [])


# -----------------------------------------------------------------------------
# Happy path
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_see_screen_returns_structured_description(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "ai_gemini_api_key", "key-123")
    monkeypatch.setattr(cfg, "ai_gemini_model", "gemini-2.5-flash-lite")

    from vision import screen_capture as cap_mod
    from agent.actions import vision as vision_mod

    captured_args: dict = {}

    async def fake_capture(*, region=None, timeout_s: float = 5.0):
        return cap_mod.ScreenFrame(
            png_bytes=b"FAKE-PNG-BYTES",
            width=1024, height=600, region=region,
            strategy="mss", captured_at=1700000000.0,
        )

    async def fake_vision(image_bytes, prompt, *, model, api_key):
        captured_args["image_bytes"] = image_bytes
        captured_args["prompt"] = prompt
        captured_args["model"] = model
        captured_args["api_key"] = api_key
        return {
            "summary": "Settings panel open on Voice category.",
            "people_present": [],
            "objects": ["browser window", "clock"],
            "lighting": "indoor daylight",
            "notable_text": ["Voice", "STT mode"],
        }

    monkeypatch.setattr(cap_mod, "capture", fake_capture)
    monkeypatch.setattr(vision_mod, "_call_gemini_vision", fake_vision)

    result = await SeeScreen(focus="What is the operator looking at?").execute(_ctx())

    assert result.ok is True
    assert result.output is not None
    desc = result.output["description"]
    assert desc["summary"].startswith("Settings panel")
    assert desc["objects"] == ["browser window", "clock"]
    assert desc["notable_text"] == ["Voice", "STT mode"]
    assert result.output["frame"]["strategy"] == "mss"
    assert result.output["model"] == "gemini-2.5-flash-lite"
    # Side-effect should summarise the perception.
    assert any("saw screen" in s for s in result.side_effects)
    # The custom focus question must be passed to Gemini, not the default.
    assert "operator looking at" in captured_args["prompt"]


@pytest.mark.asyncio
async def test_see_screen_uses_default_focus_when_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "ai_gemini_api_key", "key-123")
    monkeypatch.setattr(cfg, "ai_gemini_model", "gemini-2.5-flash-lite")

    from vision import screen_capture as cap_mod
    from agent.actions import vision as vision_mod

    async def fake_capture(*, region=None, timeout_s: float = 5.0):
        return cap_mod.ScreenFrame(
            png_bytes=b"x", width=10, height=10, region=region,
            strategy="mss", captured_at=0.0,
        )

    seen = {}

    async def fake_vision(image_bytes, prompt, *, model, api_key):
        seen["prompt"] = prompt
        return {
            "summary": "", "people_present": [], "objects": [],
            "lighting": "", "notable_text": [],
        }

    monkeypatch.setattr(cap_mod, "capture", fake_capture)
    monkeypatch.setattr(vision_mod, "_call_gemini_vision", fake_vision)

    result = await SeeScreen().execute(_ctx())

    assert result.ok is True
    # Default focus mentions "autonomous agent"
    assert "autonomous agent" in seen["prompt"]


@pytest.mark.asyncio
async def test_see_screen_include_image_b64(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "ai_gemini_api_key", "key-123")
    monkeypatch.setattr(cfg, "ai_gemini_model", "gemini-2.5-flash-lite")

    from vision import screen_capture as cap_mod
    from agent.actions import vision as vision_mod

    async def fake_capture(*, region=None, timeout_s: float = 5.0):
        return cap_mod.ScreenFrame(
            png_bytes=b"PNG-BYTES",
            width=10, height=10, region=region,
            strategy="mss", captured_at=0.0,
        )

    async def fake_vision(image_bytes, prompt, *, model, api_key):
        return {
            "summary": "ok", "people_present": [], "objects": [],
            "lighting": "", "notable_text": [],
        }

    monkeypatch.setattr(cap_mod, "capture", fake_capture)
    monkeypatch.setattr(vision_mod, "_call_gemini_vision", fake_vision)

    result = await SeeScreen(include_image_b64=True).execute(_ctx())

    assert result.ok is True
    assert result.output is not None
    assert "image_b64" in result.output
    assert result.output["image_mime"] == "image/png"
    # Base64 encoding should be lossless round-trip
    import base64
    assert base64.b64decode(result.output["image_b64"]) == b"PNG-BYTES"


@pytest.mark.asyncio
async def test_see_screen_vision_call_failure_returns_not_ok(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from config import config as cfg
    monkeypatch.setattr(cfg, "ai_gemini_api_key", "key-123")
    monkeypatch.setattr(cfg, "ai_gemini_model", "gemini-2.5-flash-lite")

    from vision import screen_capture as cap_mod
    from agent.actions import vision as vision_mod

    async def fake_capture(*, region=None, timeout_s: float = 5.0):
        return cap_mod.ScreenFrame(
            png_bytes=b"x", width=10, height=10, region=region,
            strategy="mss", captured_at=0.0,
        )

    async def boom(image_bytes, prompt, *, model, api_key):
        raise RuntimeError("quota exceeded")

    monkeypatch.setattr(cap_mod, "capture", fake_capture)
    monkeypatch.setattr(vision_mod, "_call_gemini_vision", boom)

    result = await SeeScreen().execute(_ctx())

    assert result.ok is False
    assert result.output is not None
    assert result.output.get("reason") == "vision_call_failed"
    assert "quota" in result.output.get("error", "")


# -----------------------------------------------------------------------------
# Registry
# -----------------------------------------------------------------------------


def test_registry_exposes_see_screen() -> None:
    from agent.actions.registry import registry

    names = registry.names()
    assert "vision.see_screen" in names

    catalog = {item["name"]: item for item in registry.catalog()}
    entry = catalog["vision.see_screen"]
    assert entry["risk_label"] == "SAFE"
    assert "focus" in entry["args"]
    assert "include_image_b64" in entry["args"]
