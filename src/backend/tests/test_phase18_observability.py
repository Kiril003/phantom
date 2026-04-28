"""Phase 18 — productisation observability primitives.

Covers:
  /healthz                  — liveness, no deps
  /readyz                   — readiness, exposes per-check status
  /metrics                  — Prometheus text exposition
  correlation_id_middleware — X-Correlation-Id round-trip
  CorrelationFilter         — log records pick up the id
"""

from __future__ import annotations

import logging

import pytest


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c


# ── /healthz — liveness ───────────────────────────────────────────────────────


class TestHealthz:
    def test_healthz_returns_ok(self, client):
        resp = client.get("/healthz")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert "version" in body
        assert "uptime_s" in body

    def test_healthz_has_no_deps(self, client):
        # Liveness must succeed even if DB / chroma / AI are down. We can't
        # actually break them in this test process, but the contract is
        # captured here as a doc / regression marker.
        resp = client.get("/healthz")
        assert resp.status_code == 200


# ── /readyz — readiness ───────────────────────────────────────────────────────


class TestReadyz:
    def test_readyz_response_shape(self, client):
        resp = client.get("/readyz")
        assert resp.status_code in (200, 503)
        body = resp.json()
        assert body["status"] in ("ready", "not_ready")
        checks = body["checks"]
        assert {"db", "chroma", "ai"} <= set(checks.keys())
        for name, info in checks.items():
            assert "ok" in info, f"{name} missing ok flag"
            assert "detail" in info, f"{name} missing detail"

    def test_readyz_returns_503_when_check_fails(self, client, monkeypatch):
        # Force the AI probe to fail; readyz must surface 503.
        from observability import _probe_ai_provider as _real

        def _fail():
            return False, "ai: synthetic"

        monkeypatch.setattr("observability._probe_ai_provider", _fail)
        resp = client.get("/readyz")
        assert resp.status_code == 503
        body = resp.json()
        assert body["checks"]["ai"]["ok"] is False
        # Other checks should still be reported truthfully.
        assert body["checks"]["db"]["ok"] is True


# ── /metrics — Prometheus exposition ──────────────────────────────────────────


class TestMetrics:
    def test_metrics_serves_prom_text(self, client):
        resp = client.get("/metrics")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/plain")
        body = resp.text
        # Required canary lines
        assert "phantom_build_info" in body
        assert "# TYPE phantom_uptime_seconds gauge" in body
        assert "# TYPE phantom_chat_messages_total counter" in body

    def test_counter_increment_visible(self, client):
        from observability import chat_messages_total

        chat_messages_total.inc(role="user")
        chat_messages_total.inc(role="assistant")
        body = client.get("/metrics").text
        assert 'phantom_chat_messages_total{role="user"}' in body
        assert 'phantom_chat_messages_total{role="assistant"}' in body

    def test_counter_negative_value_clamped(self):
        from observability import Counter

        c = Counter("phantom_test_counter", "test")
        c.inc(5.0)
        c.inc(-3.0)  # ignored
        rendered = "\n".join(c.render())
        # Body has only "5.0" — negative inc is silently dropped.
        assert "5" in rendered
        assert "-3" not in rendered

    def test_label_escaping_safe(self):
        from observability import Counter

        c = Counter("phantom_test_label", "test")
        # An adversarial label with quotes / backslashes / newlines.
        c.inc(role='evil"\\\nrole')
        rendered = "\n".join(c.render())
        # Output must remain on a single line with proper escapes.
        assert 'role="evil\\"\\\\\\nrole"' in rendered


# ── Correlation id ────────────────────────────────────────────────────────────


class TestCorrelationId:
    def test_response_includes_correlation_id(self, client):
        resp = client.get("/healthz")
        cid = resp.headers.get("X-Correlation-Id")
        assert cid, "missing X-Correlation-Id on response"
        assert 1 <= len(cid) <= 64

    def test_incoming_correlation_id_echoed(self, client):
        resp = client.get(
            "/healthz",
            headers={"X-Correlation-Id": "test-12345-abcdef"},
        )
        assert resp.headers["X-Correlation-Id"] == "test-12345-abcdef"

    def test_oversized_incoming_header_replaced(self, client):
        resp = client.get(
            "/healthz",
            headers={"X-Correlation-Id": "x" * 5000},  # > 64 chars
        )
        cid = resp.headers["X-Correlation-Id"]
        assert cid != "x" * 5000
        assert len(cid) <= 64

    def test_http_requests_counter_bumped_on_call(self, client):
        # E-5 — every served request must register on the
        # phantom_http_requests_total counter, bucketed by method + route
        # prefix + status. Confirm via a follow-up /metrics scrape.
        client.get("/healthz")
        body = client.get("/metrics").text
        assert "phantom_http_requests_total" in body
        # The /healthz call should appear as a row.
        assert 'method="GET"' in body
        assert "/healthz" in body

    def test_correlation_filter_attaches_dash_outside_request(self):
        # Outside an HTTP request the contextvar default "-" applies, so
        # log records emitted by background workers stay deterministic.
        from observability import CorrelationFilter, get_correlation_id

        record = logging.LogRecord(
            name="bg", level=logging.INFO, pathname=__file__, lineno=1,
            msg="hi", args=(), exc_info=None,
        )
        filt = CorrelationFilter()
        assert filt.filter(record) is True
        assert getattr(record, "correlation_id") == "-"
        assert get_correlation_id() is None
