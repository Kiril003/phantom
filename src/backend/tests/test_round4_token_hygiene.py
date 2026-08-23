"""Раунд 4, панель П4: сесійний токен не лягає на диск відкритим текстом.

Три рубежі, по одному класу на кожен:

1. Токен їде під-протоколом WS, а не в query string (`security/ws_auth.py`).
2. Навіть якщо він усе-таки доїде до логера — на диск ляже маска
   (`security/log_scrub.py`).
3. Секрет підпису належить вузлу, а не збірці (`security/node_secret.py`),
   тож токен сусіда тут не відмикає нічого.
"""
from __future__ import annotations

import logging
import os
import stat
from types import SimpleNamespace

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-round4-token-hygiene")


# ─── 1. Токен геть з URL ─────────────────────────────────────────────────────


def _fake_ws(subprotocols=None, path="/ws"):
    return SimpleNamespace(
        scope={"path": path, "subprotocols": list(subprotocols or [])},
        headers={},
    )


class TestSubprotocolAuth:
    def test_token_rides_the_subprotocol_pair(self) -> None:
        from security.ws_auth import BEARER_SUBPROTOCOL, extract_ws_token

        ws = _fake_ws([BEARER_SUBPROTOCOL, "header.payload.sig"])
        token, echo = extract_ws_token(ws)

        assert token == "header.payload.sig"
        # Браузер рве зʼєднання, якщо сервер не підтвердив запропонований
        # під-протокол — тож ехо мусить бути саме маркером.
        assert echo == BEARER_SUBPROTOCOL

    def test_header_form_is_read_when_scope_has_no_list(self) -> None:
        from security.ws_auth import BEARER_SUBPROTOCOL, extract_ws_token

        ws = SimpleNamespace(
            scope={"path": "/ws"},
            headers={"sec-websocket-protocol": f"{BEARER_SUBPROTOCOL}, a.b.c"},
        )
        assert extract_ws_token(ws) == ("a.b.c", BEARER_SUBPROTOCOL)

    def test_marker_without_a_token_is_not_an_auth(self) -> None:
        from security.ws_auth import BEARER_SUBPROTOCOL, extract_ws_token

        assert extract_ws_token(_fake_ws([BEARER_SUBPROTOCOL])) == (None, None)

    def test_legacy_query_token_still_works_for_the_phone(self) -> None:
        # Мобільний клієнт (`PhantomLink.kt`) ще ходить у `/ws?token=`.
        # Ламати його зараз не можна — приймаємо, але без ехо під-протоколу.
        from security.ws_auth import extract_ws_token

        assert extract_ws_token(_fake_ws(), "legacy.jwt.here") == ("legacy.jwt.here", None)

    def test_subprotocol_wins_over_query_string(self) -> None:
        from security.ws_auth import BEARER_SUBPROTOCOL, extract_ws_token

        ws = _fake_ws([BEARER_SUBPROTOCOL, "new.token.here"])
        token, _ = extract_ws_token(ws, "old.token.here")
        assert token == "new.token.here"

    def test_no_token_at_all(self) -> None:
        from security.ws_auth import extract_ws_token

        assert extract_ws_token(_fake_ws()) == (None, None)


# ─── 2. Лог не зберігає секретів ─────────────────────────────────────────────


_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlBoYW50b20ifQ"
    ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
)


class TestSecretScrub:
    @pytest.mark.parametrize(
        "raw",
        [
            f"GET /ws?token={_JWT} HTTP/1.1",
            f"/api/v1/x?apikey={_JWT}",
            f"/api/v1/x?api_key=SEKRET&token={_JWT}",
            f"Authorization: Bearer {_JWT}",
            f"headers={{'authorization': 'Bearer {_JWT}'}}",
            f"звалився запит із токеном {_JWT} усередині",
        ],
    )
    def test_secret_never_survives_the_scrub(self, raw: str) -> None:
        from security.log_scrub import scrub

        cleaned = scrub(raw)
        assert _JWT not in cleaned
        assert "***" in cleaned

    def test_password_and_secret_params_too(self) -> None:
        from security.log_scrub import scrub

        cleaned = scrub("/login?password=hunter2&client_secret=abc123")
        assert "hunter2" not in cleaned
        assert "abc123" not in cleaned

    def test_ordinary_lines_are_untouched(self) -> None:
        from security.log_scrub import scrub

        line = 'GET /api/v1/messenger/chats?limit=50 HTTP/1.1" 200 OK'
        assert scrub(line) == line

    def test_scrub_is_idempotent(self) -> None:
        from security.log_scrub import scrub

        once = scrub(f"/ws?token={_JWT}")
        assert scrub(once) == once

    def test_filter_masks_the_uvicorn_access_record_shape(self) -> None:
        # uvicorn логує шаблоном, а шлях із query string приїжджає
        # АРГУМЕНТОМ — фільтр мусить чистити args, не тільки msg.
        from security.log_scrub import SecretScrubFilter

        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg='%s - "%s %s HTTP/%s" %d',
            args=("127.0.0.1:1", "GET", f"/ws?token={_JWT}", "1.1", 200),
            exc_info=None,
        )
        assert SecretScrubFilter().filter(record) is True
        rendered = record.getMessage()
        assert _JWT not in rendered
        assert "token=***" in rendered

    def test_filter_masks_the_websocket_record_shape(self) -> None:
        from security.log_scrub import SecretScrubFilter

        record = logging.LogRecord(
            name="uvicorn.error",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg='%s - "WebSocket %s" [accepted]',
            args=("('127.0.0.1', 1)", f"/ws?token={_JWT}"),
            exc_info=None,
        )
        SecretScrubFilter().filter(record)
        assert _JWT not in record.getMessage()

    def test_install_is_idempotent(self) -> None:
        from security.log_scrub import SecretScrubFilter, install_log_scrubber

        install_log_scrubber()
        install_log_scrubber()
        access = logging.getLogger("uvicorn.access")
        assert sum(isinstance(f, SecretScrubFilter) for f in access.filters) == 1


# ─── 3. Свій секрет на вузол ─────────────────────────────────────────────────


class TestPerNodeSecret:
    @pytest.fixture(autouse=True)
    def _isolate(self, monkeypatch):
        from security import node_secret

        # Прибираємо явний env — інакше він виграє за задумом (правило 2).
        monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
        monkeypatch.delenv("PHANTOM_TOKEN_SECRET_SHARED", raising=False)
        node_secret.reset_cache()
        yield
        node_secret.reset_cache()

    def test_first_start_generates_a_private_key_file(self, tmp_path, monkeypatch) -> None:
        from security import node_secret

        monkeypatch.setattr(node_secret, "data_root", lambda: tmp_path)
        secret = node_secret.token_signing_secret()

        path = tmp_path / node_secret.SECRET_FILE_NAME
        assert path.read_text(encoding="utf-8").strip() == secret
        assert len(secret) >= 32
        # Права як у turn.json: тільки власник.
        assert stat.S_IMODE(path.stat().st_mode) == 0o600

    def test_the_secret_is_stable_across_restarts(self, tmp_path, monkeypatch) -> None:
        from security import node_secret

        monkeypatch.setattr(node_secret, "data_root", lambda: tmp_path)
        first = node_secret.token_signing_secret()
        node_secret.reset_cache()
        assert node_secret.token_signing_secret() == first

    def test_two_data_dirs_are_two_nodes(self, tmp_path, monkeypatch) -> None:
        from security import node_secret

        node_a, node_b = tmp_path / "a", tmp_path / "b"
        monkeypatch.setattr(node_secret, "data_root", lambda: node_a)
        secret_a = node_secret.token_signing_secret()
        node_secret.reset_cache()
        monkeypatch.setattr(node_secret, "data_root", lambda: node_b)
        secret_b = node_secret.token_signing_secret()

        assert secret_a != secret_b

    def test_a_neighbours_token_does_not_open_this_node(self, tmp_path, monkeypatch) -> None:
        from jose import JWTError

        from security import jwt_manager, node_secret

        monkeypatch.setattr(node_secret, "data_root", lambda: tmp_path / "a")
        token, _ = jwt_manager.create_token("u1", "phantom", "ROOT")
        assert jwt_manager.verify_token(token).user_id == "u1"

        node_secret.reset_cache()
        monkeypatch.setattr(node_secret, "data_root", lambda: tmp_path / "b")
        with pytest.raises(JWTError):
            jwt_manager.verify_token(token)

    def test_explicit_env_secret_still_wins(self, tmp_path, monkeypatch) -> None:
        # docker-compose / systemd передають секрет змінною середовища —
        # це свідома воля оператора саме для цього процесу.
        from security import node_secret

        monkeypatch.setattr(node_secret, "data_root", lambda: tmp_path)
        monkeypatch.setenv("JWT_SECRET_KEY", "explicit-operator-secret")
        assert node_secret.token_signing_secret() == "explicit-operator-secret"
        assert not (tmp_path / node_secret.SECRET_FILE_NAME).exists()

    def test_shared_mode_is_opt_in_and_loud(self, tmp_path, monkeypatch, caplog) -> None:
        from config import config
        from security import node_secret

        monkeypatch.setattr(node_secret, "data_root", lambda: tmp_path)
        monkeypatch.setattr(config, "jwt_secret_key", "fleet-wide-secret")
        monkeypatch.setenv("PHANTOM_TOKEN_SECRET_SHARED", "1")
        with caplog.at_level(logging.WARNING):
            assert node_secret.token_signing_secret() == "fleet-wide-secret"
        assert any("спільним" in r.message for r in caplog.records)
