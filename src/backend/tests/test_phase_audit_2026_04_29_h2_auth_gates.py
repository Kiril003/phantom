"""Tier-A H-2 regression — Day-2 audit D2-A1 + D2-A2 (closes F-08, F-09).

Voice (/stt /tts /status) + settings (GET / GET _value / POST export)
must require authentication. Pre-Day-2 these were the LAN-takeover
surface the audit explicitly flagged P0; v0.18.0-saas-base shipped
with them open. This test pins the gate.
"""

from __future__ import annotations

import pytest


VOICE_ROUTES = [
    ("POST", "/api/v1/voice/stt"),
    ("POST", "/api/v1/voice/tts"),
    ("GET", "/api/v1/voice/status"),
]

SETTINGS_GET_ROUTES = [
    ("GET", "/api/v1/settings"),
    ("GET", "/api/v1/settings/_value/voice_stt_mode"),
    ("POST", "/api/v1/settings/export"),
]


class TestVoiceAuthGate:
    @pytest.mark.parametrize("method,path", VOICE_ROUTES)
    def test_unauth_voice_request_returns_401(self, unauth_client, method, path):
        # Hit the route with a payload it'd normally accept — gate should
        # 401 before any of that processing runs.
        if method == "POST" and path.endswith("/stt"):
            res = unauth_client.post(path, files={"file": ("x.wav", b"00", "audio/wav")})
        elif method == "POST" and path.endswith("/tts"):
            res = unauth_client.post(path, json={"text": "x", "voice": "", "speed": 1.0})
        else:
            res = unauth_client.get(path)
        assert res.status_code == 401, (
            f"D2-A1 regression: {method} {path} returned "
            f"{res.status_code}, expected 401 (unauthenticated)"
        )

    @pytest.mark.parametrize("method,path", VOICE_ROUTES)
    def test_authed_voice_request_does_not_401(self, auth_root_client, method, path):
        # Same matrix but with auth — should NOT be 401. May be other
        # codes depending on payload; what matters is the gate didn't
        # block a legitimate caller.
        if method == "POST" and path.endswith("/stt"):
            res = auth_root_client.post(path, files={"file": ("x.wav", b"00", "audio/wav")})
        elif method == "POST" and path.endswith("/tts"):
            res = auth_root_client.post(path, json={"text": "x", "voice": "", "speed": 1.0})
        else:
            res = auth_root_client.get(path)
        assert res.status_code != 401, (
            f"D2-A1 regression: {method} {path} 401'd a legitimate ROOT "
            "request — auth gate is misconfigured"
        )


class TestSettingsAuthGate:
    @pytest.mark.parametrize("method,path", SETTINGS_GET_ROUTES)
    def test_unauth_settings_request_returns_401(self, unauth_client, method, path):
        if method == "GET":
            res = unauth_client.get(path)
        else:
            res = unauth_client.post(path)
        assert res.status_code == 401, (
            f"D2-A2 regression: {method} {path} returned "
            f"{res.status_code}, expected 401"
        )

    @pytest.mark.parametrize("method,path", SETTINGS_GET_ROUTES)
    def test_authed_settings_request_does_not_401(self, auth_root_client, method, path):
        if method == "GET":
            res = auth_root_client.get(path)
        else:
            res = auth_root_client.post(path)
        assert res.status_code != 401, (
            f"D2-A2 regression: {method} {path} 401'd a legitimate ROOT "
            "request — auth gate is misconfigured"
        )

    def test_authed_get_settings_returns_json(self, auth_root_client):
        # Sanity: ROOT can read the settings catalogue.
        res = auth_root_client.get("/api/v1/settings")
        assert res.status_code == 200
        body = res.json()
        assert "categories" in body
