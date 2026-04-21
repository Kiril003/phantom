"""
Phase 9.4c audit Q6 — external-service health tracker + endpoint.

The localization adapters ping ``service_health`` on every call so the
Settings / Map UI can surface an offline banner when Nominatim, Overpass,
or ipapi.co are unreachable. These tests exercise the tracker directly
(unit) and the ``/map/services_health`` endpoint (integration).
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from agent.localization import service_health
from main import create_app


@pytest.fixture(autouse=True)
def _reset_tracker():
    service_health.reset_for_tests()
    yield
    service_health.reset_for_tests()


def test_unknown_before_any_call() -> None:
    snap = service_health.snapshot()
    for name in service_health.TRACKED_SERVICES:
        assert snap[name]["status"] == "unknown"
        assert snap[name]["last_success_at"] is None


def test_success_marks_ok() -> None:
    service_health.mark_success("nominatim")
    snap = service_health.snapshot()
    assert snap["nominatim"]["status"] == "ok"
    assert snap["nominatim"]["last_success_at"] is not None


def test_failure_after_success_marks_down() -> None:
    service_health.mark_success("overpass")
    service_health.mark_failure("overpass", "HTTP 429 rate limit")
    snap = service_health.snapshot()
    assert snap["overpass"]["status"] == "down"
    assert "rate limit" in (snap["overpass"]["last_failure_reason"] or "")


def test_success_after_failure_clears_down() -> None:
    service_health.mark_failure("ipapi", "timeout")
    service_health.mark_success("ipapi")
    snap = service_health.snapshot()
    assert snap["ipapi"]["status"] == "ok"
    assert snap["ipapi"]["last_failure_reason"] is None


def test_stale_when_last_success_too_old(monkeypatch: pytest.MonkeyPatch) -> None:
    service_health.mark_success("nominatim")
    # Fast-forward just past the stale threshold.
    future = time.time() + service_health.STALE_AFTER_S + 5
    monkeypatch.setattr(service_health.time, "time", lambda: future)
    snap = service_health.snapshot()
    assert snap["nominatim"]["status"] == "stale"


@pytest.fixture(scope="module")
def app():
    return create_app()


def test_services_health_endpoint_returns_tracked_services(app) -> None:
    service_health.mark_success("nominatim")
    service_health.mark_failure("overpass", "HTTP 504")
    client = TestClient(app)
    resp = client.get("/api/v1/map/services_health")
    assert resp.status_code == 200
    body = resp.json()
    assert "services" in body
    services = body["services"]
    assert set(services.keys()) >= set(service_health.TRACKED_SERVICES)
    assert services["nominatim"]["status"] == "ok"
    assert services["overpass"]["status"] == "down"
