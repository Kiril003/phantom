"""
Phase 18-COMPLETE — AT-SPI bridge.

Reads the live accessibility tree to locate UI elements by semantic
label / role rather than via screen capture + OCR + visual grounding.
Drastically faster + more reliable for native GTK / Qt / Electron
applications when the operator's desktop has the a11y daemon running
and the application opted into accessibility.

The whole module is built around graceful degradation:

  * `ensure_available()` — imports pyatspi lazily, raises
    ATSPIUnavailable when the binding or daemon is missing.
  * Every public coroutine catches the import failure and reports the
    same exception class so callers can decide whether to fall back to
    OCR + screen.click(x, y).

The agent layer wraps this in two Action subclasses
(`ATSPIFindByLabel`, `ATSPIClickByLabel`) so the planner can still
compose plans that work on systems without AT-SPI — the action just
returns ok=False with error_class='ATSPIUnavailable' and the loop's
existing fallback path takes over.

The cache trades freshness for speed: a 500ms TTL on a per-PID app
subtree is enough to resolve "find Save → click Save" in one round
without re-walking the whole desktop tree twice.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Cache TTL is intentionally short — accessibility trees mutate any time
# a window opens / closes. 500ms is enough for "find Save → click Save"
# but cheap enough to discard otherwise.
CACHE_TTL_S = 0.5


class ATSPIUnavailable(RuntimeError):
    """Raised when pyatspi can't be imported or the a11y daemon is
    unreachable. Callers should fall back to screen-vision paths."""


@dataclass(frozen=True)
class ATSPINode:
    """Snapshot of one matched accessibility node. We capture only the
    bits the action layer needs (bbox + identity) so the bridge owns the
    raw pyatspi handles and they don't leak into the rest of the agent."""

    role: str
    name: str
    description: str | None
    bbox: tuple[int, int, int, int]  # x, y, w, h in screen pixels
    app: str
    pid: int


_CACHE: dict[tuple[str, str | None, str | None], tuple[float, list[ATSPINode]]] = {}


def _cache_get(key: tuple[str, str | None, str | None]) -> list[ATSPINode] | None:
    entry = _CACHE.get(key)
    if entry is None:
        return None
    when, payload = entry
    if time.monotonic() - when > CACHE_TTL_S:
        _CACHE.pop(key, None)
        return None
    return payload


def _cache_put(key: tuple[str, str | None, str | None], value: list[ATSPINode]) -> None:
    _CACHE[key] = (time.monotonic(), value)


def ensure_available() -> object:
    """Import pyatspi lazily. Returns the module on success; raises
    ATSPIUnavailable with a hint string the action layer can surface
    verbatim."""
    try:
        import pyatspi  # type: ignore[import-untyped]
    except Exception as exc:  # noqa: BLE001
        raise ATSPIUnavailable(
            f"pyatspi unavailable: {exc}. Install python3-pyatspi or "
            "fall back to screen.ocr + screen.click."
        )
    return pyatspi


def _bbox_for(accessible: object) -> tuple[int, int, int, int] | None:
    """Read screen-coord bbox for an accessibility node. Returns None
    when the node has no Component interface (group containers etc.)."""
    try:
        component = accessible.queryComponent()  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        return None
    try:
        # pyatspi Atspi.CoordType.SCREEN — but using the constant name is
        # version-fragile, so import it lazily on first call.
        from pyatspi import DESKTOP_COORDS  # type: ignore[import-untyped]
        ext = component.getExtents(DESKTOP_COORDS)
    except Exception:  # noqa: BLE001
        try:
            ext = component.getExtents(0)  # 0 == screen in legacy pyatspi
        except Exception:  # noqa: BLE001
            return None
    try:
        return (int(ext.x), int(ext.y), int(ext.width), int(ext.height))
    except Exception:  # noqa: BLE001
        return None


def _role_name(accessible: object) -> str:
    try:
        return str(accessible.getRoleName())  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        return ""


def _walk_tree(root: object, app_name: str, pid: int, out: list[tuple[object, str, int]]) -> None:
    """Recursive walk that yields (accessible, app_name, pid) for every
    visible/sensible node. Pruned at common dead-ends to stay snappy."""
    try:
        out.append((root, app_name, pid))
    except Exception:  # noqa: BLE001
        return
    try:
        n = root.childCount  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        return
    for i in range(min(int(n), 256)):  # hard cap per node
        try:
            child = root.getChildAtIndex(i)  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            continue
        if child is None:
            continue
        _walk_tree(child, app_name, pid, out)


def _matches(node: object, label: str, role_filter: str | None) -> bool:
    try:
        name = str(node.name or "")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        name = ""
    try:
        desc = str(node.description or "")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        desc = ""
    label_low = label.lower()
    if label_low not in name.lower() and label_low not in desc.lower():
        return False
    if role_filter:
        if role_filter.lower().replace("_", " ") not in _role_name(node).lower():
            return False
    return True


def _to_snapshot(node: object, app_name: str, pid: int) -> ATSPINode | None:
    bbox = _bbox_for(node)
    if bbox is None:
        return None
    try:
        name = str(node.name or "")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        name = ""
    try:
        desc = str(node.description or None)  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        desc = None
    return ATSPINode(
        role=_role_name(node),
        name=name,
        description=desc,
        bbox=bbox,
        app=app_name,
        pid=int(pid),
    )


def _do_search(label: str, role_filter: str | None, app_filter: str | None) -> list[ATSPINode]:
    """Synchronous search — must be invoked through asyncio.to_thread()
    because pyatspi calls block on dbus."""
    pyatspi = ensure_available()
    registry = pyatspi.Registry  # type: ignore[attr-defined]
    desktop = registry.getDesktop(0)
    matches: list[ATSPINode] = []
    try:
        n_apps = desktop.childCount
    except Exception:  # noqa: BLE001
        return matches
    for i in range(int(n_apps)):
        try:
            app = desktop.getChildAtIndex(i)
        except Exception:  # noqa: BLE001
            continue
        if app is None:
            continue
        try:
            app_name = str(app.name or "")
        except Exception:  # noqa: BLE001
            app_name = ""
        if app_filter and app_filter.lower() not in app_name.lower():
            continue
        try:
            pid = int(getattr(app, "process_id", 0) or 0)
        except Exception:  # noqa: BLE001
            pid = 0
        nodes: list[tuple[object, str, int]] = []
        _walk_tree(app, app_name, pid, nodes)
        for raw, an, pi in nodes:
            if _matches(raw, label, role_filter):
                snap = _to_snapshot(raw, an, pi)
                if snap is not None:
                    matches.append(snap)
    return matches


async def find_by_label(
    label: str,
    *,
    role: str | None = None,
    app: str | None = None,
) -> ATSPINode | None:
    """Return the first accessibility node whose name/description
    contains `label` (case-insensitive). `role` and `app` narrow the
    search; both are optional substrings.

    Raises ATSPIUnavailable when the binding is missing.
    """
    if not label:
        return None
    key = (label, role, app)
    cached = _cache_get(key)
    if cached is not None:
        return cached[0] if cached else None
    matches = await asyncio.to_thread(_do_search, label, role, app)
    _cache_put(key, matches)
    return matches[0] if matches else None


async def find_role(
    role: str,
    *,
    app: str | None = None,
    label: str | None = None,
) -> list[ATSPINode]:
    """Return all accessibility nodes of a given semantic role (e.g.
    'push button', 'menu item'). Use sparingly — a desktop tree can be
    huge."""
    if not role:
        return []
    key = (label or "", role, app)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    matches = await asyncio.to_thread(_do_search, label or "", role, app)
    _cache_put(key, matches)
    return matches


async def click_element(node: ATSPINode, *, button: str = "left") -> bool:
    """Click the centre of the node's bbox via the existing
    desktop_control backend. AT-SPI gives us the geometry; the
    actuation goes through xdotool / ydotool / wtype as usual."""
    from . import desktop_control as dc

    x, y, w, h = node.bbox
    cx = int(x + max(1, w // 2))
    cy = int(y + max(1, h // 2))
    return await dc.click(cx, cy, button=button)


def clear_cache() -> None:
    """Drop all cached lookups. Tests + tooltips that change UI state
    should call this to force a re-walk on the next query."""
    _CACHE.clear()


__all__ = [
    "ATSPINode",
    "ATSPIUnavailable",
    "CACHE_TTL_S",
    "clear_cache",
    "click_element",
    "ensure_available",
    "find_by_label",
    "find_role",
]
