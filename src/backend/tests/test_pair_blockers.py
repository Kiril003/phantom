"""Перепони на шляху телефона мають називатись, а не мовчати."""
import api.routes_pair as rp


def _zone(tmp_path, body: str) -> str:
    zone = tmp_path / "public.xml"
    zone.write_text(f"<?xml version='1.0'?>\n<zone>\n{body}\n</zone>", encoding="utf-8")
    return str(tmp_path / "*.xml")


def test_open_port_is_not_reported(tmp_path):
    zones = _zone(tmp_path, '<port port="8443" protocol="tcp"/>')
    assert rp._firewall_closes(8443, zones) is False


def test_closed_port_is_reported(tmp_path, monkeypatch):
    zones = _zone(tmp_path, '<port port="8000" protocol="tcp"/>')
    monkeypatch.setattr(rp, "_FIREWALLD_ZONES", zones)
    monkeypatch.setattr(rp, "_listening_on_lan", lambda _p: True)
    assert rp._firewall_closes(8443, zones) is True
    assert any("8443" in p for p in rp._lan_blockers(8443))


def test_port_range_counts_as_open(tmp_path):
    zones = _zone(tmp_path, '<port port="8000-8500" protocol="tcp"/>')
    assert rp._firewall_closes(8443, zones) is False


def test_udp_does_not_count(tmp_path):
    zones = _zone(tmp_path, '<port port="8443" protocol="udp"/>')
    assert rp._firewall_closes(8443, zones) is True


def test_silent_server_is_reported(monkeypatch, tmp_path):
    zones = _zone(tmp_path, '<port port="8443" protocol="tcp"/>')
    monkeypatch.setattr(rp, "_FIREWALLD_ZONES", zones)
    monkeypatch.setattr(rp, "_listening_on_lan", lambda _p: False)
    assert any("0.0.0.0" in p for p in rp._lan_blockers(8443))


def test_no_firewalld_means_no_scare(tmp_path):
    assert rp._firewall_closes(8443, str(tmp_path / "порожньо" / "*.xml")) is False


def test_cache_does_not_answer_for_another_port(tmp_path, monkeypatch):
    """Кеш пам'ятав відповідь, але не питання."""
    zones = _zone(tmp_path, '<port port="8000" protocol="tcp"/>')
    monkeypatch.setattr(rp, "_FIREWALLD_ZONES", zones)
    monkeypatch.setattr(rp, "_listening_on_lan", lambda _p: True)
    rp._blockers_cache = (0.0, [], None)
    assert rp._lan_blockers_cached(8000) == []
    assert rp._lan_blockers_cached(8443) != []


def test_lan_bound_socket_counts_as_reachable(tmp_path, monkeypatch):
    proc = tmp_path / "tcp"
    proc.write_text(
        "  sl  local_address rem_address   st\n"
        "   0: 8500A8C0:1F40 00000000:0000 0A\n",
        encoding="ascii",
    )
    monkeypatch.setattr("builtins.open", _opener(proc, rp))
    assert rp._listening_on_lan(8000) is True


def test_loopback_only_socket_is_not_reachable(tmp_path, monkeypatch):
    proc = tmp_path / "tcp"
    proc.write_text(
        "  sl  local_address rem_address   st\n"
        "   0: 0100007F:1F40 00000000:0000 0A\n",
        encoding="ascii",
    )
    monkeypatch.setattr("builtins.open", _opener(proc, rp))
    assert rp._listening_on_lan(8000) is False


def _opener(path, module):
    real = open

    def fake(name, *a, **kw):
        if name == "/proc/net/tcp":
            return real(path, *a, **kw)
        return real(name, *a, **kw)

    return fake
