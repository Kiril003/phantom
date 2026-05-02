"""
Phase 18 — Screen OCR.

Optional dependency: `pytesseract` + system `tesseract` binary. When either
is missing, `ocr_screen()` returns `OCRError` so the caller (action) can
surface a clean error instead of crashing.

Returns a list of `OCRWord` rows with bbox, text, confidence — same shape
the FE AgentVisionPanel renders as overlays. Operators can call OCR over
the full screen or a region; the region is delegated to `screen_capture`.
"""
from __future__ import annotations

import asyncio
import io
import logging
from dataclasses import dataclass, field

from . import screen_capture as sc

logger = logging.getLogger(__name__)


@dataclass
class OCRWord:
    text: str
    x: int
    y: int
    w: int
    h: int
    confidence: float


@dataclass
class OCRResult:
    words: list[OCRWord] = field(default_factory=list)
    width: int = 0
    height: int = 0
    languages: str = ""


@dataclass
class OCRError:
    error: str
    tried: list[str] = field(default_factory=list)


def _is_available() -> tuple[bool, str | None]:
    try:
        import pytesseract  # type: ignore
    except Exception as exc:
        return False, f"pytesseract not installed ({exc})"
    try:
        # Probe the binary too — pytesseract import succeeds even when
        # tesseract itself is missing.
        pytesseract.get_tesseract_version()
    except Exception as exc:
        return False, f"tesseract binary missing ({exc})"
    return True, None


async def ocr_screen(
    *,
    region: tuple[int, int, int, int] | None = None,
    languages: str = "ukr+eng",
    min_confidence: float = 30.0,
) -> OCRResult | OCRError:
    avail, why = _is_available()
    if not avail:
        return OCRError(error=why or "ocr unavailable", tried=["pytesseract"])

    frame = await sc.capture(region=region)
    if isinstance(frame, sc.ScreenCaptureError):
        return OCRError(error=f"capture failed: {frame.error}", tried=frame.tried)

    def _ocr() -> OCRResult:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore
        with Image.open(io.BytesIO(frame.png_bytes)) as img:
            data = pytesseract.image_to_data(
                img,
                lang=languages,
                output_type=pytesseract.Output.DICT,
            )
        out = OCRResult(width=frame.width, height=frame.height, languages=languages)
        n = len(data.get("text", []))
        for i in range(n):
            text = (data["text"][i] or "").strip()
            if not text:
                continue
            try:
                conf = float(data["conf"][i])
            except Exception:
                conf = -1.0
            if conf < min_confidence:
                continue
            try:
                x = int(data["left"][i])
                y = int(data["top"][i])
                w = int(data["width"][i])
                h = int(data["height"][i])
            except Exception:
                continue
            out.words.append(OCRWord(text=text, x=x, y=y, w=w, h=h, confidence=conf))
        return out

    return await asyncio.to_thread(_ocr)


__all__ = ["OCRWord", "OCRResult", "OCRError", "ocr_screen"]
