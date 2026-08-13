"""Слухач для телефонів і uvicorn не можуть ділити один порт."""
import logging

from config import config
from security.tls_listener import start_tls_listener


def test_default_tls_port_differs_from_http_port():
    assert config.pair_tls_port != config.port


async def test_same_port_refuses_to_bind(monkeypatch, caplog):
    monkeypatch.setattr(config, "pair_tls_port", config.port)
    with caplog.at_level(logging.ERROR, logger="security.tls_listener"):
        assert await start_tls_listener(object()) is None
    assert "pair_tls_port" in caplog.text
