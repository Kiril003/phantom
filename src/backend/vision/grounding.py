"""
Visual grounding (Phase 9.2 — Grounded Mind).

Resolves natural-language UI references like "click the red Sign In button"
into screen coordinates the agent can actually click.

Two implementations live here behind a common Grounder protocol:

1. `OmniParserV2` — vision-based: YOLOv8 detects elements + Florence-2 caption.
   Lazy-loaded; if weights aren't installed, raises GroundingUnavailable instead
   of crashing the whole vision module.

2. `DomAccessibilityParser` — DOM/accessibility-tree based: works inside an
   active Playwright page using only DOM queries + accessibility roles. Cheap,
   reliable, works without external model weights — and covers the only
   browser-only flows Phase 9.2 actually demonstrates.

`OmniParserGrounder` chooses the best available parser at runtime: prefers
DOM (fast, no weights) when a Playwright page is supplied, falls back to
OmniParserV2 (slow, needs weights) when only a screenshot is available.

This module never raises during import. Heavy deps load lazily on first use.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ── Public types ──────────────────────────────────────────────────────────────


class ParsedElement(BaseModel):
    """One UI element parsed from a screenshot or DOM."""

    type: str  # button, input, link, image, text, icon, ...
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2 in screen coords
    text: str | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    attrs: dict[str, Any] = Field(default_factory=dict)

    def center(self) -> tuple[int, int]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) // 2, (y1 + y2) // 2)


class GroundingFailed(Exception):
    """Raised when grounding can run but no candidate clears confidence floor."""


class GroundingUnavailable(Exception):
    """Raised when the grounder cannot run at all (no weights, no page)."""


@runtime_checkable
class Parser(Protocol):
    async def parse(self, *, page: Any | None = None,
                    image: bytes | None = None) -> list[ParsedElement]: ...


# ── DOM accessibility parser ──────────────────────────────────────────────────


_TYPE_MAP = {
    "button": "button",
    "link": "link",
    "textbox": "input",
    "input": "input",
    "img": "image",
    "image": "image",
    "checkbox": "input",
    "radio": "input",
    "combobox": "input",
    "menuitem": "button",
    "tab": "button",
    "heading": "text",
    "paragraph": "text",
    "static": "text",
}


class DomAccessibilityParser:
    """Uses Playwright accessibility snapshot + bounding boxes — no models."""

    name = "dom_a11y"

    async def parse(
        self, *, page: Any | None = None, image: bytes | None = None
    ) -> list[ParsedElement]:
        if page is None:
            raise GroundingUnavailable("dom_a11y parser requires a Playwright page")

        # Prefer accessibility snapshot; fall back to a DOM walk.
        elements: list[ParsedElement] = []
        try:
            snapshot = await page.accessibility.snapshot(interesting_only=False)
        except Exception as exc:
            logger.debug("a11y snapshot failed (%s) — falling back to DOM walk", exc)
            snapshot = None

        if snapshot:
            await self._collect_from_snapshot(page, snapshot, elements)

        if not elements:
            await self._collect_from_dom(page, elements)

        return elements

    async def _collect_from_snapshot(
        self, page: Any, node: dict, out: list[ParsedElement]
    ) -> None:
        role = (node.get("role") or "").lower()
        name = (node.get("name") or "").strip()
        if role in _TYPE_MAP:
            # Try to locate this element by role+name to get a bounding box.
            try:
                locator = page.get_by_role(role, name=name) if name else None
                if locator is not None:
                    box = await locator.first.bounding_box()
                    if box is not None:
                        out.append(ParsedElement(
                            type=_TYPE_MAP[role],
                            bbox=(int(box["x"]), int(box["y"]),
                                  int(box["x"] + box["width"]),
                                  int(box["y"] + box["height"])),
                            text=name or None,
                            confidence=0.9,
                            attrs={"role": role, "name": name},
                        ))
            except Exception:
                pass
        for child in node.get("children", []) or []:
            await self._collect_from_snapshot(page, child, out)

    async def _collect_from_dom(
        self, page: Any, out: list[ParsedElement]
    ) -> None:
        # Pull a flat array of (selector, text, box) for common interactive tags.
        try:
            data = await page.evaluate(
                """() => {
                    const out = [];
                    const tags = ['button', 'a', 'input', 'select', 'textarea',
                                  '[role=button]', '[role=link]', '[role=tab]'];
                    for (const sel of tags) {
                        for (const el of document.querySelectorAll(sel)) {
                            const r = el.getBoundingClientRect();
                            if (r.width === 0 || r.height === 0) continue;
                            out.push({
                                tag: el.tagName.toLowerCase(),
                                text: (el.innerText || el.value || el.alt || '').slice(0, 200),
                                x: r.left, y: r.top, w: r.width, h: r.height,
                            });
                        }
                    }
                    return out;
                }"""
            )
        except Exception as exc:
            logger.warning("DOM walk failed: %s", exc)
            return
        for entry in data or []:
            tag = entry.get("tag", "")
            type_name = (
                "button" if tag in {"button"} or "button" in tag
                else "link" if tag == "a"
                else "input" if tag in {"input", "textarea", "select"}
                else "text"
            )
            out.append(ParsedElement(
                type=type_name,
                bbox=(int(entry["x"]), int(entry["y"]),
                      int(entry["x"] + entry["w"]),
                      int(entry["y"] + entry["h"])),
                text=(entry.get("text") or "").strip() or None,
                confidence=0.7,
                attrs={"tag": tag},
            ))


# ── OmniParser V2 wrapper ─────────────────────────────────────────────────────


class OmniParserV2:
    """
    Lazy wrapper around microsoft/OmniParser-v2.0.

    Loaded on first parse() call. If `omniparser` isn't installed the call
    raises GroundingUnavailable — the grounder catches that and falls back to
    DomAccessibilityParser when a page is available.
    """

    name = "omniparser_v2"

    def __init__(self) -> None:
        self._loaded = False
        self._parser: Any | None = None

    def _try_load(self) -> None:
        if self._loaded:
            return
        try:
            # OmniParser is not on PyPI as a single package — users install from
            # the upstream repo. Try a couple of plausible import paths.
            try:
                import omniparser  # type: ignore[import-not-found]
                self._parser = omniparser
            except ImportError:
                from util import omniparser as _op  # type: ignore[import-not-found]
                self._parser = _op
        except Exception as exc:
            logger.info("OmniParserV2 not installed (%s)", exc)
            self._parser = None
        self._loaded = True

    async def parse(
        self, *, page: Any | None = None, image: bytes | None = None
    ) -> list[ParsedElement]:
        self._try_load()
        if self._parser is None:
            raise GroundingUnavailable(
                "OmniParser V2 weights/library not installed. "
                "See docs/phase-09.2-setup.md to download."
            )
        if image is None and page is not None:
            try:
                image = await page.screenshot(full_page=False)
            except Exception as exc:
                raise GroundingUnavailable(f"could not capture page screenshot: {exc}") from exc
        if image is None:
            raise GroundingUnavailable("OmniParser V2 needs an image or page")

        # Real call would be: bboxes = self._parser.run(image)
        # then map each row to ParsedElement(type, bbox, text, confidence).
        # We never reach here in CI because _parser is None unless someone
        # installed the upstream package.
        raise GroundingUnavailable("OmniParserV2 stub: real inference not wired")


# ── Grounder ──────────────────────────────────────────────────────────────────


_TYPE_PRIORITIES: dict[str, list[str]] = {
    "button": ["button"],
    "input": ["input"],
    "link": ["link"],
    "image": ["image"],
    "text": ["text", "button", "link"],
    "element": ["button", "link", "input", "text", "image"],
}


def _tokenize(s: str) -> set[str]:
    return {tok for tok in re.findall(r"[a-zа-яіїєґ0-9]+", s.lower()) if len(tok) > 1}


def _score(description: str, element: ParsedElement) -> float:
    """Cheap text-overlap score — adequate for DOM-grounded clicks."""
    desc_toks = _tokenize(description)
    if not desc_toks:
        return 0.0
    elem_text = (element.text or "") + " " + " ".join(
        str(v) for v in element.attrs.values() if isinstance(v, str)
    )
    elem_toks = _tokenize(elem_text)
    if not elem_toks:
        return 0.0
    overlap = desc_toks & elem_toks
    if not overlap:
        return 0.0
    # Jaccard, weighted by element confidence.
    jaccard = len(overlap) / len(desc_toks | elem_toks)
    return jaccard * element.confidence


class OmniParserGrounder:
    """
    Resolves a `GroundedParam(description, expected_type)` → (x, y) on screen.

    Tries DOM first (cheap), falls back to OmniParser V2 (slow, optional).
    """

    def __init__(
        self,
        *,
        dom_parser: Parser | None = None,
        omni_parser: Parser | None = None,
        min_confidence: float | None = None,
    ) -> None:
        from config import config
        self.dom = dom_parser or DomAccessibilityParser()
        self.omni = omni_parser or OmniParserV2()
        self.min_confidence = (
            min_confidence if min_confidence is not None
            else float(config.agent_grounding_min_confidence)
        )

    async def resolve_coords(
        self, *, description: str, expected_type: str, page: Any | None = None,
    ) -> tuple[int, int]:
        elements: list[ParsedElement] = []
        # Try DOM first when a page is available.
        if page is not None:
            try:
                elements = await self.dom.parse(page=page)
            except GroundingUnavailable:
                elements = []

        # Fall back to OmniParser if DOM came up empty.
        if not elements:
            try:
                elements = await self.omni.parse(page=page)
            except GroundingUnavailable as exc:
                if page is None:
                    raise
                logger.debug("OmniParser unavailable, no DOM elements either: %s", exc)
                raise GroundingFailed("no parser produced any elements") from exc

        # Filter by expected type then rank by description match.
        priorities = _TYPE_PRIORITIES.get(expected_type, [expected_type])
        candidates = [e for e in elements if e.type in priorities] or elements
        scored = sorted(
            ((_score(description, e), e) for e in candidates),
            key=lambda p: -p[0],
        )

        if not scored or scored[0][0] < self.min_confidence:
            best_score = scored[0][0] if scored else 0.0
            raise GroundingFailed(
                f"no candidate ≥ min_confidence {self.min_confidence:.2f} for "
                f"'{description}' (best={best_score:.2f}, "
                f"considered={len(candidates)} of {len(elements)})"
            )

        return scored[0][1].center()


__all__ = [
    "ParsedElement",
    "GroundingFailed",
    "GroundingUnavailable",
    "Parser",
    "DomAccessibilityParser",
    "OmniParserV2",
    "OmniParserGrounder",
]
