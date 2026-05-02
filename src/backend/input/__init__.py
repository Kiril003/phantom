"""Phase 18 — desktop input automation primitives."""
from .desktop_control import DesktopController, ControlBackendError, click, double_click, type_text, key_combo, scroll, move

__all__ = [
    "DesktopController",
    "ControlBackendError",
    "click",
    "double_click",
    "type_text",
    "key_combo",
    "scroll",
    "move",
]
