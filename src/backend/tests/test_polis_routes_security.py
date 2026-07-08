"""ПОЛІС security contract — RBAC boundaries, id validation, traversal.

The city runs missions that burn provider tokens and manages the
KeyVault, so the boundary rules are: no token → 401, GUEST → 403,
OPERATOR commands missions but cannot touch keys, ROOT does everything.
Filesystem access never leaves ~/.phantom/polis/<mission_id>/.
"""
from __future__ import annotations

import uuid

import pytest

from tests.conftest import _ensure_user, _issue_token, _make_user_row

BASE = "/api/v1/polis"


@pytest.fixture
async def auth_guest_client():
    from fastapi.testclient import TestClient
    from main import create_app

    payload = _make_user_row("GUEST")
    await _ensure_user(payload)
    token = _issue_token(payload["id"], payload["username"], payload["role"])
    app = create_app()
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {token}"})
        yield c


def test_polis_requires_auth(unauth_client):
    assert unauth_client.get(f"{BASE}/state").status_code == 401


def test_guest_forbidden_everywhere(auth_guest_client):
    assert auth_guest_client.get(f"{BASE}/state").status_code == 403
    assert auth_guest_client.get(f"{BASE}/keys").status_code == 403
    r = auth_guest_client.post(
        f"{BASE}/missions", json={"brief": "спробувати проникнути"}
    )
    assert r.status_code == 403


def test_operator_cannot_mutate_keys(auth_operator_client):
    r = auth_operator_client.post(
        f"{BASE}/keys",
        json={"provider": "gemini", "secret": "sk-test-1234567890"},
    )
    assert r.status_code == 403
    r = auth_operator_client.delete(f"{BASE}/keys/{'a' * 12}")
    assert r.status_code == 403
    # reads stay open to operators — key list is masked server-side
    assert auth_operator_client.get(f"{BASE}/keys").status_code == 200


def test_root_can_manage_keys(auth_root_client):
    r = auth_root_client.post(
        f"{BASE}/keys",
        json={"provider": "gemini", "label": "t", "secret": "sk-test-1234567890"},
    )
    assert r.status_code == 200
    key_id = r.json()["id"]
    assert auth_root_client.delete(f"{BASE}/keys/{key_id}").status_code == 200


def test_traversal_mission_id_rejected(auth_root_client):
    r = auth_root_client.get(f"{BASE}/missions/..%2f..%2fetc/artifact?name=passwd")
    assert r.status_code in (404, 422)
    r = auth_root_client.get(f"{BASE}/missions/../artifact?name=x")
    assert r.status_code in (404, 422)
    r = auth_root_client.get(f"{BASE}/missions/AAAA-not-hex/artifacts")
    assert r.status_code == 422


def test_whitespace_brief_rejected(auth_root_client):
    r = auth_root_client.post(f"{BASE}/missions", json={"brief": "   \n\t  "})
    assert r.status_code == 422


def test_unknown_pipeline_rejected(auth_root_client):
    r = auth_root_client.post(
        f"{BASE}/missions", json={"brief": "щось корисне", "pipeline": "nope"}
    )
    assert r.status_code == 400


# ── service-level filesystem containment ─────────────────────────────────


def test_read_artifact_never_escapes(tmp_path, monkeypatch):
    from agent.fabric.service import PolisService

    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("top secret")
    mission_id = uuid.uuid4().hex[:12]
    (tmp_path / mission_id).mkdir(parents=True)
    (tmp_path / mission_id / "note.md").write_text("ok")

    svc = PolisService()
    assert svc.read_artifact(mission_id, "note.md") == "ok"
    assert svc.read_artifact(mission_id, "../../secret.txt") is None
    assert svc.read_artifact(mission_id, "/etc/passwd") is None
    assert svc.read_artifact("../" + mission_id, "note.md") is None
    assert svc.read_artifact("..", "secret.txt") is None
    assert svc.list_artifacts("../evil") == []


def test_forge_files_contained(tmp_path, monkeypatch):
    from agent.fabric.graph import MissionGraph, PlanNode
    from agent.fabric.service import ActiveMission, PolisService

    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))
    svc = PolisService()
    node = PlanNode(title="t", prompt="p")
    graph = MissionGraph(mission_id=uuid.uuid4().hex[:12])
    graph.add(node)
    m = ActiveMission(graph.mission_id, "u", "t", "b", "generic", graph)

    text = (
        "```file:../escape.txt\nowned\n```\n"
        "```file:/abs/escape.txt\nowned\n```\n"
        "```file:src/app.py\nprint('ok')\n```\n"
    )
    forged = svc._forge_files(m, node, text)
    # `../` is rejected outright; absolute paths are re-rooted INSIDE the
    # workspace (lstrip) — either way nothing lands outside it
    assert "../escape.txt" not in forged
    assert not (tmp_path.parent / "escape.txt").exists()
    ws = tmp_path / m.id / "workspace"
    assert (ws / "src" / "app.py").read_text() == "print('ok')\n"
    for rel in forged:
        assert (ws / rel).is_file()


def test_harvest_ssrf_guard():
    from agent.fabric.harvest import _url_ok

    assert _url_ok("https://example.com/page")
    assert _url_ok("http://uk.wikipedia.org/wiki/Київ")
    # the harvester lives on a box that serves its own admin APIs — the
    # loopback/LAN/metadata surfaces must never be reachable via a result
    assert not _url_ok("http://localhost:8000/api/v1/polis/keys")
    assert not _url_ok("http://127.0.0.1/admin")
    assert not _url_ok("http://169.254.169.254/latest/meta-data/")
    assert not _url_ok("http://192.168.1.1/")
    assert not _url_ok("http://10.0.0.5:8000/")
    assert not _url_ok("http://router.local/")
    assert not _url_ok("file:///etc/passwd")
    assert not _url_ok("ftp://example.com/")
    assert not _url_ok("not a url")


@pytest.mark.asyncio
async def test_budget_exhausted_node_fails_without_llm(tmp_path, monkeypatch):
    from agent.fabric.graph import MissionGraph, NodeBudget, PlanNode
    from agent.fabric.service import ActiveMission, PolisService

    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))

    class Bomb:
        def __getattr__(self, name):  # any LLM touch explodes the test
            raise AssertionError("LLM must not be called on exhausted budget")

    import ai.provider_mesh as mesh_mod
    monkeypatch.setattr(mesh_mod, "get_mesh", lambda: Bomb())

    svc = PolisService()
    node = PlanNode(
        title="t", prompt="p",
        budget=NodeBudget(max_tokens=10, max_llm_calls=1,
                          spent_tokens=10, spent_llm_calls=1),
    )
    graph = MissionGraph(mission_id=uuid.uuid4().hex[:12])
    graph.add(node)
    m = ActiveMission(graph.mission_id, "u", "t", "b", "generic", graph)

    await svc._execute(m, node)
    assert node.status == "failed"
    assert "бюджет" in (node.error or "")
