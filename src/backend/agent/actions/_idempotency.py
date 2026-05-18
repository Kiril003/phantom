"""
Block A-1 — Action idempotency helpers.

Every action that has side effects gets a stable idempotency key derived from
(task_id, step_idx, action_name, normalized_args).  The key is deterministic
across process restarts, so sentinel files / cached results survive a crash.

Usage pattern
-------------
key = idempotency_key(task_id=ctx.task_id, step_idx=ctx.step_idx,
                      action_name="bash.run", args={"cmd": "apt install vim"})

Sentinel-based caching (bash.run)
----------------------------------
sentinel_dir = sentinel_cache_dir(ctx.workspace_dir)
cached        = load_cached_result(sentinel_dir, key)
if cached:
    return cached
# … do the work …
save_cached_result(sentinel_dir, key, result)

Content-hash idempotency (fs.write)
-------------------------------------
if file_content_matches(path, new_content):
    return <skip result>
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

# Sentinel directory name relative to workspace root.
_SENTINEL_SUBDIR = ".phantom-bash-done"
# Maximum entries in the sentinel directory before LRU prune kicks in.
_SENTINEL_MAX_ENTRIES = 1000

# Command substrings that indicate non-idempotent intent — these commands
# produce different output on every call (clocks, live logs, network state).
# bash.run skips caching when any of these is found in the command string.
# This is a heuristic — the LLM retains the ability to set force_rerun=True.
_NON_IDEMPOTENT_HINTS: frozenset[str] = frozenset({
    "date",
    "uname",
    "journalctl",
    "tail -f",
    "ping",
    "netstat",
    "ss -t",
    " ps ",
    "ps aux",
    "ps -",
    " top",
    "htop",
    "vmstat",
    "iostat",
    "free ",
    "uptime",
    "w ",
    "who",
    "last ",
    "dmesg",
    "watch ",
})


# ── Key derivation ────────────────────────────────────────────────────────────


def idempotency_key(
    *,
    task_id: str,
    step_idx: int,
    action_name: str,
    args: dict[str, Any],
) -> str:
    """Return a stable hex string that uniquely identifies this (task, step,
    action, args) tuple.  Normalization:
      - dict keys are sorted recursively
      - string values are lowercased + stripped
      - timestamp-like keys ("ts", "timestamp", "now", "_ts", "created_at")
        are dropped so clock-jitter doesn't bust the key
    """
    _TS_KEYS = frozenset({"ts", "timestamp", "now", "_ts", "created_at"})

    def _norm(v: Any) -> Any:
        if isinstance(v, str):
            return v.lower().strip()
        if isinstance(v, dict):
            return {
                k: _norm(vv)
                for k, vv in sorted(v.items())
                if k not in _TS_KEYS
            }
        if isinstance(v, list):
            return [_norm(x) for x in v]
        return v

    payload = json.dumps(
        {
            "task_id": task_id,
            "step_idx": step_idx,
            "action_name": action_name.lower(),
            "args": _norm(args),
        },
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


# ── File content idempotency (fs.write) ───────────────────────────────────────


def file_content_matches(path: str, new_content: str) -> bool:
    """Return True iff *path* already exists and its content equals
    *new_content*.  Comparison is done via SHA-256 so large files are
    compared cheaply without loading both into memory simultaneously."""
    if not os.path.isfile(path):
        return False
    try:
        new_hash = hashlib.sha256(new_content.encode("utf-8")).hexdigest()
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
        return h.hexdigest() == new_hash
    except OSError:
        return False


# ── Sentinel-based caching (bash.run) ─────────────────────────────────────────


def sentinel_cache_dir(workspace_dir: str) -> str:
    """Return the absolute path to the bash-done sentinel directory,
    creating it if necessary."""
    path = os.path.join(os.path.abspath(os.path.expanduser(workspace_dir)), _SENTINEL_SUBDIR)
    os.makedirs(path, exist_ok=True)
    return path


def load_cached_result(cache_dir: str, key: str) -> dict[str, Any] | None:
    """Return the previously cached ActionResult model_dump, or None."""
    sentinel = os.path.join(cache_dir, key + ".json")
    if not os.path.isfile(sentinel):
        return None
    try:
        with open(sentinel, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        # Touch the file for LRU accounting.
        os.utime(sentinel, None)
        return data
    except Exception as exc:
        logger.debug("load_cached_result: failed to read %s: %s", sentinel, exc)
        return None


def save_cached_result(cache_dir: str, key: str, result: dict[str, Any]) -> None:
    """Persist *result* as a sentinel JSON file.  Prunes oldest entries when
    the directory exceeds _SENTINEL_MAX_ENTRIES."""
    _prune_if_needed(cache_dir)
    sentinel = os.path.join(cache_dir, key + ".json")
    try:
        with open(sentinel, "w", encoding="utf-8") as fh:
            json.dump(result, fh, default=str)
    except Exception as exc:
        logger.debug("save_cached_result: failed to write %s: %s", sentinel, exc)


def _prune_if_needed(cache_dir: str) -> None:
    """Remove the oldest entries (by mtime) when the directory has grown
    beyond _SENTINEL_MAX_ENTRIES.  Prunes 10% of the limit so we don't
    prune on every write once we hit the cap."""
    try:
        entries = [
            (os.path.getmtime(os.path.join(cache_dir, f)), f)
            for f in os.listdir(cache_dir)
            if f.endswith(".json")
        ]
        if len(entries) <= _SENTINEL_MAX_ENTRIES:
            return
        # Sort by mtime ascending — oldest first.
        entries.sort()
        prune_count = max(1, _SENTINEL_MAX_ENTRIES // 10)
        for _, fname in entries[:prune_count]:
            try:
                os.unlink(os.path.join(cache_dir, fname))
            except OSError:
                pass
        logger.debug(
            "_prune_if_needed: pruned %d sentinel(s) from %s", prune_count, cache_dir
        )
    except Exception as exc:
        logger.debug("_prune_if_needed: failed: %s", exc)


def is_non_idempotent_command(cmd: str) -> bool:
    """Heuristic: return True when the command string contains tokens that
    typically produce different output on every run (clocks, live logs, etc.)
    or when it writes to an already-existing path via > / >> redirect.

    Limitations (documented):
      - Only substring matching; a command that wraps `date` in a variable
        assignment may still be cached.
      - Redirects to NEW paths are fine; we can't cheaply tell if the target
        exists at planning time, so we conservatively skip caching for any
        > or >> that appears after a non-trivial path token.
    """
    cmd_lower = cmd.lower()
    for hint in _NON_IDEMPOTENT_HINTS:
        if hint in cmd_lower:
            return True
    # Skip caching for any command that redirects output.
    if ">" in cmd or ">>" in cmd:
        return True
    return False


# ── Output-freshness check (blender.run) ─────────────────────────────────────


def output_is_fresh(output_path: str, script_path: str) -> bool:
    """Return True iff *output_path* already exists AND its mtime is newer
    than *script_path*'s mtime.  This is the blender.run idempotency guard:
    if the render output is already up-to-date relative to the script that
    produced it, re-running is wasteful."""
    try:
        out_mtime = os.path.getmtime(output_path)
        script_mtime = os.path.getmtime(script_path)
        return out_mtime > script_mtime
    except OSError:
        return False
