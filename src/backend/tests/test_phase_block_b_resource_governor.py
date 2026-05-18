"""
Block B — Resource Governance tests.

Covers:
  SystemMonitor:
    test_system_monitor_start_stop_idempotent
    test_system_monitor_emits_snapshot_to_event_bus
    test_system_monitor_pressure_red_when_ram_above_90
    test_system_monitor_pressure_yellow_when_ram_above_75
    test_system_monitor_pressure_green_otherwise
    test_system_monitor_history_bounded_to_720
    test_system_monitor_network_probe_cached_30s
    test_system_monitor_handles_missing_thermal_zone

  Action resource declarations:
    test_action_default_peak_ram_is_50mb
    test_blender_run_declares_4gb_peak_ram
    test_bash_install_command_bumps_peak_ram_via_heuristic

  ResourceGate:
    test_resource_gate_proceeds_on_green
    test_resource_gate_defers_on_red_ram
    test_resource_gate_warns_on_yellow_proceeds
    test_resource_gate_proceeds_on_unknown_when_monitor_off
    test_resource_gate_network_required_but_down_defers_normal_mode
    test_resource_gate_network_required_but_down_proceeds_unsafe_mode

  Planner resource blocks:
    test_format_resource_block_omitted_on_green
    test_format_resource_block_includes_pressure_and_hint

  Thermal helpers:
    test_thermal_recommendations_temp_buckets

  Watchdog logic:
    test_watchdog_kill_selection_picks_heaviest_child_not_daemon
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Bootstrap env before any PHANTOM import.
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-block-b")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-block-b")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ── Helpers to build controlled ResourceSnapshot ─────────────────────────────

def _make_snapshot(
    *,
    ram_used_pct: float = 50.0,
    ram_available_mb: int = 4096,
    ram_total_mb: int = 8192,
    swap_used_pct: float = 0.0,
    cpu_pct: float = 20.0,
    cpu_load_1m: float = 1.0,
    cpu_temp_c: float | None = 40.0,
    cpu_throttling: bool = False,
    disk_free_gb: float = 20.0,
    disk_used_pct: float = 30.0,
    network_up: bool = True,
    pressure_label: str = "green",
):
    from core.system_monitor import ResourceSnapshot
    return ResourceSnapshot(
        ts=time.monotonic(),
        captured_at_iso="2026-01-01T00:00:00+00:00",
        ram_total_mb=ram_total_mb,
        ram_available_mb=ram_available_mb,
        ram_used_pct=ram_used_pct,
        swap_used_pct=swap_used_pct,
        cpu_pct=cpu_pct,
        cpu_load_1m=cpu_load_1m,
        cpu_temp_c=cpu_temp_c,
        cpu_throttling=cpu_throttling,
        disk_free_gb=disk_free_gb,
        disk_used_pct=disk_used_pct,
        network_up=network_up,
        pressure_label=pressure_label,
    )


# ── 1. SystemMonitor: start/stop idempotency ──────────────────────────────────

@pytest.mark.asyncio
async def test_system_monitor_start_stop_idempotent():
    """start() is idempotent — calling it twice doesn't spawn two tasks."""
    from core.system_monitor import SystemMonitor
    mon = SystemMonitor()
    with patch("psutil.cpu_percent", return_value=0.0):
        with patch.object(mon, "_capture", new_callable=AsyncMock) as mock_cap:
            mock_cap.return_value = _make_snapshot()
            await mon.start()
            task1 = mon._task
            await mon.start()  # second call — must NOT replace task
            task2 = mon._task
    assert task1 is task2, "start() must be idempotent"
    await mon.stop()


# ── 2. SystemMonitor: emits snapshot to event_bus ────────────────────────────

@pytest.mark.asyncio
async def test_system_monitor_emits_snapshot_to_event_bus():
    """Each captured snapshot is published on event_bus topic 'resource.snapshot'.

    The system_monitor module imports event_bus lazily inside _sample_loop,
    so we patch the canonical singleton: core.event_bus.event_bus.
    """
    from core.system_monitor import SystemMonitor
    mon = SystemMonitor()
    snap = _make_snapshot()
    published: list[tuple[str, Any]] = []

    mock_bus = MagicMock()
    mock_bus.emit = lambda topic, payload: published.append((topic, payload))

    with patch("psutil.cpu_percent", return_value=0.0):
        with patch.object(mon, "_capture", new_callable=AsyncMock) as mock_cap:
            mock_cap.return_value = snap
            # Patch the canonical singleton used by the lazy import inside _sample_loop.
            with patch("core.event_bus.event_bus", mock_bus):
                await mon.start()
                # Give the loop one iteration.
                await asyncio.sleep(0.05)
    await mon.stop()

    assert any(topic == "resource.snapshot" for topic, _ in published), (
        "Expected at least one 'resource.snapshot' emit"
    )


# ── 3–5. Pressure derivation ──────────────────────────────────────────────────

def test_system_monitor_pressure_red_when_ram_above_90():
    from core.system_monitor import _derive_pressure
    label = _derive_pressure(
        ram_used_pct=91.0,
        swap_used_pct=0.0,
        cpu_pct=10.0,
        cpu_temp_c=40.0,
        cpu_throttling=False,
        disk_free_gb=20.0,
    )
    assert label == "red"


def test_system_monitor_pressure_yellow_when_ram_above_75():
    from core.system_monitor import _derive_pressure
    label = _derive_pressure(
        ram_used_pct=78.0,
        swap_used_pct=0.0,
        cpu_pct=10.0,
        cpu_temp_c=40.0,
        cpu_throttling=False,
        disk_free_gb=20.0,
    )
    assert label == "yellow"


def test_system_monitor_pressure_green_otherwise():
    from core.system_monitor import _derive_pressure
    label = _derive_pressure(
        ram_used_pct=50.0,
        swap_used_pct=5.0,
        cpu_pct=30.0,
        cpu_temp_c=55.0,
        cpu_throttling=False,
        disk_free_gb=20.0,
    )
    assert label == "green"


# ── 6. History bounded to 720 ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_system_monitor_history_bounded_to_720():
    """History deque must not grow beyond 720 entries."""
    from core.system_monitor import SystemMonitor, _HISTORY_MAXLEN
    mon = SystemMonitor()
    assert _HISTORY_MAXLEN == 720
    snap = _make_snapshot()
    # Fill beyond capacity directly.
    for _ in range(800):
        mon._history.append(snap)
    assert len(mon._history) <= 720


# ── 7. Network probe cached 30 s ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_system_monitor_network_probe_cached_30s():
    """The network probe must not be called again within 30 s of a prior probe."""
    from core.system_monitor import SystemMonitor
    mon = SystemMonitor()
    call_count = 0

    async def _fake_probe() -> bool:
        nonlocal call_count
        call_count += 1
        return True

    # Simulate 6 samples within the 30 s cache window by giving the same
    # monotonic time (well within the 30 s window).
    base_ts = time.monotonic()
    with patch("core.system_monitor._probe_network", side_effect=_fake_probe):
        # First call — cache miss, probe fires.
        await mon._check_network(base_ts)
        # Five more calls within the same 30 s window (base_ts unchanged).
        for _ in range(5):
            await mon._check_network(base_ts + 1.0)

    # Only the first call should have triggered the probe.
    assert call_count == 1, f"Expected 1 probe invocation, got {call_count}"


# ── 8. Missing thermal zone ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_system_monitor_handles_missing_thermal_zone():
    """If sysfs thermal zone is unreadable, cpu_temp_c=None and cpu_throttling=False."""
    from core.system_monitor import SystemMonitor

    mon = SystemMonitor()

    with patch("psutil.virtual_memory") as mock_vm, \
         patch("psutil.swap_memory") as mock_swap, \
         patch("psutil.cpu_percent", return_value=5.0), \
         patch("psutil.getloadavg", return_value=(0.5, 0.5, 0.5)), \
         patch("psutil.disk_usage") as mock_disk, \
         patch("psutil.cpu_count", return_value=4), \
         patch("core.system_monitor._read_cpu_temp", new_callable=AsyncMock, return_value=None), \
         patch.object(mon, "_check_network", new_callable=AsyncMock, return_value=True):

        mock_vm.return_value = MagicMock(
            total=8 * 1024**3, available=4 * 1024**3, percent=50.0
        )
        mock_swap.return_value = MagicMock(percent=0.0)
        mock_disk.return_value = MagicMock(
            free=20 * 1024**3, percent=30.0
        )

        snap = await mon._capture()

    assert snap.cpu_temp_c is None
    assert snap.cpu_throttling is False


# ── 9. Action default peak RAM ────────────────────────────────────────────────

def test_action_default_peak_ram_is_50mb():
    from agent.actions.base import Action
    assert Action.estimated_peak_ram_mb == 50


# ── 10. BlenderRun declares 4 GB ──────────────────────────────────────────────

def test_blender_run_declares_4gb_peak_ram():
    from agent.actions.device import BlenderRun
    assert BlenderRun.estimated_peak_ram_mb == 4096


# ── 11. BashRun heavy install heuristic ──────────────────────────────────────

def test_bash_install_command_bumps_peak_ram_via_heuristic():
    from agent.actions.bash import BashRun
    action = BashRun(cmd="apt install foo")
    # expected_peak_ram_mb() is the instance method added in Block B.
    assert action.expected_peak_ram_mb() >= 1500, (
        "apt install should trigger the heavy-install heuristic"
    )


# ── Resource gate helpers ─────────────────────────────────────────────────────
# resource_gate imports system_monitor lazily inside check_resources(), so we
# patch the canonical singleton at core.system_monitor.system_monitor.

async def _gate(action, *, unsafe_mode=False, snap=None):
    """Run check_resources with a controlled snapshot."""
    with patch("core.system_monitor.system_monitor") as mock_sm:
        mock_sm.current.return_value = snap
        from agent.operations.safety.resource_gate import check_resources
        return await check_resources(action, unsafe_mode=unsafe_mode)


# ── 12. Gate proceeds on green ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_resource_gate_proceeds_on_green():
    snap = _make_snapshot(
        ram_available_mb=8000, ram_used_pct=40.0,
        pressure_label="green", network_up=True,
    )
    from agent.actions.bash import BashRun
    action = BashRun(cmd="echo hello")
    verdict = await _gate(action, snap=snap)
    assert verdict.proceed is True
    assert verdict.pressure == "green"


# ── 13. Gate defers on red RAM ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_resource_gate_defers_on_red_ram():
    """When pressure is red AND available RAM is below the needed threshold, defer."""
    snap = _make_snapshot(
        ram_available_mb=100,    # very low — below 600 * 1.2 = 720 MB needed
        ram_used_pct=92.0,
        pressure_label="red",
        network_up=True,
    )
    from agent.actions.vision import SeeScreen
    action = SeeScreen()  # estimated_peak_ram_mb = 600
    verdict = await _gate(action, snap=snap)
    assert verdict.proceed is False
    assert verdict.reason == "ram_unavailable"


# ── 14. Gate warns on yellow, still proceeds ─────────────────────────────────

@pytest.mark.asyncio
async def test_resource_gate_warns_on_yellow_proceeds():
    """Yellow pressure with low RAM emits a warning but still proceeds."""
    snap = _make_snapshot(
        ram_available_mb=50,     # below needed but pressure=yellow (advisory only)
        ram_used_pct=78.0,
        pressure_label="yellow",
        network_up=True,
    )
    from agent.actions.web import WebSearch
    action = WebSearch(query="test")

    mock_bus = MagicMock()
    with patch("core.event_bus.event_bus", mock_bus):
        verdict = await _gate(action, snap=snap)

    # Yellow is advisory — must proceed.
    assert verdict.proceed is True


# ── 15. Gate proceeds when monitor is off (snapshot=None) ────────────────────

@pytest.mark.asyncio
async def test_resource_gate_proceeds_on_unknown_when_monitor_off():
    """If system_monitor.current() returns None, the gate must fail-open."""
    from agent.actions.bash import BashRun
    action = BashRun(cmd="ls")
    verdict = await _gate(action, snap=None)
    assert verdict.proceed is True
    assert verdict.pressure == "unknown"


# ── 16. Gate defers when network required but down (normal mode, red pressure) ─

@pytest.mark.asyncio
async def test_resource_gate_network_required_but_down_defers_normal_mode():
    snap = _make_snapshot(
        ram_available_mb=8000, ram_used_pct=40.0,
        pressure_label="red",   # red + no network → defer
        network_up=False,
    )
    from agent.actions.web import WebSearch
    action = WebSearch(query="test")
    verdict = await _gate(action, snap=snap, unsafe_mode=False)
    assert verdict.proceed is False
    assert verdict.reason == "network_unavailable"


# ── 17. Gate proceeds when network down but unsafe_mode=True ─────────────────

@pytest.mark.asyncio
async def test_resource_gate_network_required_but_down_proceeds_unsafe_mode():
    snap = _make_snapshot(
        ram_available_mb=8000, ram_used_pct=40.0,
        pressure_label="red",
        network_up=False,
    )
    from agent.actions.web import WebSearch
    action = WebSearch(query="test")

    mock_bus = MagicMock()
    with patch("core.event_bus.event_bus", mock_bus):
        verdict = await _gate(action, snap=snap, unsafe_mode=True)

    # In unsafe_mode, network-down is a warning, not a blocker.
    assert verdict.proceed is True


# ── 18. _format_resource_block omitted on green ──────────────────────────────

def test_format_resource_block_omitted_on_green():
    snap = _make_snapshot(pressure_label="green")
    with patch("core.system_monitor.system_monitor") as mock_sm:
        mock_sm.current.return_value = snap
        from agent.cognition.planner.tactical import _format_resource_block
        block = _format_resource_block()
    assert block == ""


# ── 19. _format_resource_block includes pressure and hint ────────────────────

def test_format_resource_block_includes_pressure_and_hint():
    snap = _make_snapshot(
        pressure_label="red",
        ram_available_mb=512,
        ram_used_pct=92.0,
        cpu_pct=80.0,
        disk_free_gb=0.5,
        network_up=False,
    )
    with patch("core.system_monitor.system_monitor") as mock_sm:
        mock_sm.current.return_value = snap
        from agent.cognition.planner.tactical import _format_resource_block
        block = _format_resource_block()
    assert "RED" in block.upper()
    assert "512" in block          # RAM available
    assert "СТРАТЕГІЯ" in block    # strategy hint present


# ── 20. Thermal recommendation buckets ───────────────────────────────────────

@pytest.mark.parametrize("temp_c,expected_ctx,expected_model", [
    (25.0,  4096, "medium"),
    (80.0,  2048, "small.en"),
    (90.0,  1024, "tiny.en"),
    (None,  4096, "medium"),
])
def test_thermal_recommendations_temp_buckets(temp_c, expected_ctx, expected_model):
    from agent.operations.safety.thermal import (
        recommended_ollama_context_size,
        recommended_whisper_model,
    )
    assert recommended_ollama_context_size(temp_c) == expected_ctx
    assert recommended_whisper_model(temp_c) == expected_model


# ── 21. Watchdog kill selection never targets daemon ─────────────────────────

def test_watchdog_kill_selection_picks_heaviest_child_not_daemon():
    """The watchdog's _heaviest_child must exclude the daemon PID itself."""
    import importlib.util
    import sys

    # Resolve the watchdog path relative to this test file.
    watchdog_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../../scripts/phantom-watchdog.py")
    )
    assert os.path.exists(watchdog_path), f"watchdog not found at {watchdog_path}"

    spec = importlib.util.spec_from_file_location("phantom_watchdog", watchdog_path)
    assert spec is not None, "watchdog spec is None"
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]

    daemon_pid = 1000

    def _make_child(pid: int, rss_bytes: int) -> MagicMock:
        c = MagicMock()
        c.pid = pid
        c.memory_info.return_value = MagicMock(rss=rss_bytes)
        return c

    mock_daemon_proc = MagicMock()
    mock_daemon_proc.children.return_value = [
        _make_child(1001, 200 * 1024 * 1024),   # 200 MB
        _make_child(1000, 999 * 1024 * 1024),   # daemon itself — must be excluded
        _make_child(1002, 800 * 1024 * 1024),   # 800 MB — heaviest eligible child
    ]

    import psutil as psutil_mod
    with patch.object(psutil_mod, "Process", return_value=mock_daemon_proc):
        result = mod._heaviest_child(daemon_pid)

    assert result is not None, "_heaviest_child must find a target"
    assert result.pid != daemon_pid, (
        "_heaviest_child must never return the daemon PID itself"
    )
    assert result.pid == 1002, "Expected pid 1002 (heaviest non-daemon child)"
