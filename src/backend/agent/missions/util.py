"""
Block C-1 — Mission/Phase utility helpers.

Kept separate from store.py so neither audit.py nor the ORM modules need
to import formatting helpers that have no DB dependency.
"""
from __future__ import annotations


def format_size(size_bytes: int) -> str:
    """Return a human-readable file size string.

    Examples:
        format_size(0)          → "0 B"
        format_size(1500)       → "1.5 KB"
        format_size(2_500_000)  → "2.4 MB"
    """
    if size_bytes >= 1_048_576:
        return f"{size_bytes / 1_048_576:.1f} MB"
    if size_bytes >= 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes} B"


def format_duration(wall_s: float) -> str:
    """Format elapsed seconds as HHhMMm or MMmSSs.

    Examples:
        format_duration(90)    → "1m30s"
        format_duration(3900)  → "1h05m"
    """
    total_s = int(wall_s)
    hours, rem = divmod(total_s, 3600)
    minutes, secs = divmod(rem, 60)
    if hours > 0:
        return f"{hours}h{minutes:02d}m"
    return f"{minutes}m{secs:02d}s"


__all__ = ["format_size", "format_duration"]
