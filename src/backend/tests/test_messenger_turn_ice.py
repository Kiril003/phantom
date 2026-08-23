"""Дороги для медіа: що вузол віддає браузеру і чого не віддає ніколи.

Перевіряємо три речі. Форму — бо на ній стоїть RTCPeerConnection. Підпис —
бо пару, яку coturn не прийме, немає сенсу видавати. І чесність порожнього
випадку: без `turn.json` вузол каже «TURN немає», а не малює ретранслятор,
якого не існує.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json

import pytest

from messenger import turn as turn_mod

SECRET = "тестовий-секрет-не-з-продукту"


def _write_config(tmp_path, **overrides):
    body = {"host": "203.0.113.10", "port": 3478, "secret": SECRET}
    body.update(overrides)
    path = tmp_path / "turn.json"
    path.write_text(json.dumps(body), encoding="utf-8")
    return path


@pytest.fixture
def turn_file(tmp_path, monkeypatch):
    """Кладемо конфіг у ДАНІ, як це робить власник вузла, а не в код."""
    path = _write_config(tmp_path)
    monkeypatch.setattr(turn_mod, "turn_config_path", lambda: path)
    return path


@pytest.fixture
def no_turn_file(tmp_path, monkeypatch):
    monkeypatch.setattr(turn_mod, "turn_config_path", lambda: tmp_path / "turn.json")


@pytest.mark.anyio
async def test_ice_returns_stun_and_both_turn_transports(auth_root_client, turn_file):
    resp = auth_root_client.get("/api/v1/messenger/ice")

    assert resp.status_code == 200
    body = resp.json()
    assert body["turn"] is True
    assert body["ttl"] == turn_mod.DEFAULT_TTL_S

    stun, relay = body["iceServers"]
    assert stun["urls"] == ["stun:stun.l.google.com:19302"]
    assert stun["username"] is None and stun["credential"] is None
    assert relay["urls"] == [
        "turn:203.0.113.10:3478?transport=udp",
        "turn:203.0.113.10:3478?transport=tcp",
    ]
    assert relay["username"] and relay["credential"]


@pytest.mark.anyio
async def test_the_credential_is_the_hmac_coturn_will_check(auth_root_client, turn_file):
    """Пароль — це base64(HMAC-SHA1(secret, username)), і нічого іншого.

    Саме це рахує coturn у режимі `use-auth-secret`. Якщо ми порахуємо інакше,
    ретранслятор відмовить уже під час дзвінка — а тут це видно одразу.
    """
    relay = auth_root_client.get("/api/v1/messenger/ice").json()["iceServers"][1]

    expected = base64.b64encode(
        hmac.new(SECRET.encode(), relay["username"].encode(), hashlib.sha1).digest()
    ).decode()
    assert relay["credential"] == expected


@pytest.mark.anyio
async def test_the_username_is_when_the_pair_dies(auth_root_client, turn_file):
    """username coturn — це час смерті пари, тож він завжди попереду."""
    import time

    before = int(time.time())
    relay = auth_root_client.get("/api/v1/messenger/ice").json()["iceServers"][1]

    expiry = int(relay["username"])
    assert before + turn_mod.DEFAULT_TTL_S <= expiry <= before + turn_mod.DEFAULT_TTL_S + 5


@pytest.mark.anyio
async def test_without_a_config_the_node_says_there_is_no_turn(auth_root_client, no_turn_file):
    resp = auth_root_client.get("/api/v1/messenger/ice")

    assert resp.status_code == 200
    body = resp.json()
    assert body["turn"] is False
    assert body["ttl"] == 0
    assert len(body["iceServers"]) == 1
    assert body["iceServers"][0]["urls"] == ["stun:stun.l.google.com:19302"]


@pytest.mark.anyio
async def test_a_config_without_a_secret_is_not_a_turn(auth_root_client, tmp_path, monkeypatch):
    """Половина конфігу гірша за його відсутність: пари все одно не буде."""
    path = _write_config(tmp_path, secret="")
    monkeypatch.setattr(turn_mod, "turn_config_path", lambda: path)

    assert auth_root_client.get("/api/v1/messenger/ice").json()["turn"] is False


@pytest.mark.anyio
async def test_the_secret_never_leaves_the_node(auth_root_client, turn_file):
    assert SECRET not in auth_root_client.get("/api/v1/messenger/ice").text


@pytest.mark.anyio
async def test_ice_needs_a_token(unauth_client, turn_file):
    assert unauth_client.get("/api/v1/messenger/ice").status_code in (401, 403)
