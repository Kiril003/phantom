"""Linux subprocess sandbox subsystem (phase-5-R3-BE-SBX).

Public surface used by routes_linux + tests:

  dangerous_patterns.is_dangerous(cmd)   — regex blocklist gate
  dangerous_patterns.find_violation(cmd) — return matching pattern label
  resource_monitor.snapshot()            — psutil host snapshot
  executor.SandboxExecutor               — ROOT-gated WS-streamed runner
  executor.SandboxSession                — per-session state + lifecycle
  executor.session_registry              — in-process session map
"""
from __future__ import annotations

from . import dangerous_patterns, executor, resource_monitor

__all__ = ["dangerous_patterns", "executor", "resource_monitor"]
