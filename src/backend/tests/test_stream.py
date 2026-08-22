"""Ф0 (master-plan §5): /ws/telemetry — фейковий генератор 1000 дронів.

Споживачів у фронтенді нуль (перевірено grep'ом по src/ — «telemetry» там
лише назва режиму розкладки). Намальована неправда на бойовій поверхні
гірша за порожнечу, тож маршрут реєструється ЛИШЕ за явним прапором
PHANTOM_FAKE_TELEMETRY=1; без прапора шлях чесно відсутній — 404, а не
потік вигаданих координат.
"""
import json

from fastapi.testclient import TestClient


def _route_paths(app_) -> set:
    return {getattr(r, "path", None) for r in app_.routes}


def test_telemetry_absent_by_default() -> None:
    """Модульний app збудовано без прапора — маршруту не існує."""
    from main import app

    assert "/ws/telemetry" not in _route_paths(app)
    client = TestClient(app)
    resp = client.get("/ws/telemetry")
    assert resp.status_code == 404


def test_telemetry_streams_only_behind_flag(monkeypatch) -> None:
    """З PHANTOM_FAKE_TELEMETRY=1 маршрут повертається як був: батчі
    по 1000 сутностей. Це двері для майбутнього «Тренажера», не прод."""
    monkeypatch.setenv("PHANTOM_FAKE_TELEMETRY", "1")
    from main import create_app

    app2 = create_app()
    assert "/ws/telemetry" in _route_paths(app2)

    client = TestClient(app2)
    with client.websocket_connect("/ws/telemetry") as websocket:
        entities = json.loads(websocket.receive_text())
        assert isinstance(entities, list)
        assert len(entities) == 1000
        entity = entities[0]
        for key in (
            "id", "latitude", "longitude", "elevation",
            "heading", "velocity", "timestamp",
        ):
            assert key in entity
        assert entity["id"].startswith("drone-")
