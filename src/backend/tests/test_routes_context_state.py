"""
Regression: GET /context/state and POST /context/state must not 500.

The handler in `api/routes_context.py` referenced `SystemState.ALL` and
`SystemState.OPERATOR` without importing the symbol — every UI tick that
hit `POST /context/state` (or any code path validating against `SystemState`)
crashed with `NameError: name 'SystemState' is not defined`. Live backend
log captured this on 2026-05-08 as repeating
`POST /api/v1/context/state HTTP/1.1 500 Internal Server Error`.

These tests pin the import contract so the route can never silently
regress to a 500 again.
"""
from __future__ import annotations

import pytest


def test_get_state_returns_200(auth_root_client):
    resp = auth_root_client.get("/api/v1/context/state")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "state" in body
    assert "since" in body
    assert "previous" in body


def test_post_state_invalid_returns_400_not_500(auth_root_client):
    """The validation branch references `SystemState.ALL` — exercise it
    so a missing import surfaces as a test failure, not a 500."""
    resp = auth_root_client.post(
        "/api/v1/context/state",
        json={"state": "NOT_A_REAL_STATE", "trigger": "test"},
    )
    assert resp.status_code == 400, resp.text
    assert "Invalid state" in resp.text


def test_post_state_valid_transitions(auth_root_client):
    """The dispatch branch references `SystemState.OPERATOR` — exercise
    the non-OPERATOR path so a missing import would trip here too."""
    resp = auth_root_client.post(
        "/api/v1/context/state",
        json={"state": "FOCUS", "trigger": "test"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["to"] == "FOCUS"
    assert body["trigger"] == "test"
