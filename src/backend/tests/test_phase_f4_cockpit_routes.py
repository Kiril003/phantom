"""Ф4 «Кокпіт оператора» — тести тонких читальних маршрутів.

Перевіряємо чесність, не лише форму:
* /cockpit/machine: CPU без запущеного сампера — null (не нуль);
  RAM/диск — справжні ненульові байти; слухачі назвають порт з config.
* /cockpit/audit: пагінація курсором їде по справжніх рядках
  agent_audit (пишемо їх через record_tool_invocation — той самий
  письменник, що й продакшн-шлях chat-tool), і рядки ЧИТАЮТЬСЯ НАЗАД
  (клас дефекту phantom-os-silent-audit-gaps: «не впало» != «записано»).
* Обидва маршрути — operator-grade: без токена 401/403.
"""
from __future__ import annotations

import asyncio

import pytest

import system_metrics_sampler


# ── /cockpit/machine ─────────────────────────────────────────────────────────


class TestCockpitMachine:
    def test_requires_auth(self, unauth_client):
        r = unauth_client.get("/api/v1/cockpit/machine")
        assert r.status_code in (401, 403)

    def test_machine_shape_and_honesty(self, auth_operator_client):
        r = auth_operator_client.get("/api/v1/cockpit/machine")
        assert r.status_code == 200
        body = r.json()

        # CPU: у TestClient lifespan warmup сампер може бути як живим,
        # так і ні — але контракт один: не запущений → null, запущений
        # → число 0..100. Нуль-без-сампера заборонений.
        cpu = body["cpu"]
        if system_metrics_sampler.is_running():
            assert isinstance(cpu["pct"], (int, float))
            assert 0.0 <= cpu["pct"] <= 100.0
        else:
            assert cpu["pct"] is None
        assert "сампер" in cpu["source"] or "sampler" in cpu["source"]

        # RAM/диск — справжні байти цієї машини, не нулі.
        assert body["ram"]["total"] > 0
        assert 0 < body["ram"]["used"] <= body["ram"]["total"]
        assert body["disk"]["total"] > 0

        # Аптайми: хост не молодший за процес бекенда.
        assert body["uptime"]["host_s"] >= body["uptime"]["backend_s"] >= 0

        listeners = body["listeners"]
        from config import config

        assert listeners["http"]["port"] == config.port
        # TLS у тестовому app не піднімається лайфспаном → чесне слово.
        assert listeners["tls"]["state"] in ("слухає", "не піднявся")
        assert isinstance(listeners["mdns"]["state"], str)
        assert isinstance(listeners["ws_clients"], int)
        assert body["sampled_at_ms"] > 0


# ── /cockpit/audit ───────────────────────────────────────────────────────────


def _write_audit_rows(user_id: str, n: int) -> list[int]:
    """Пише n рядків тим самим письменником, що й продакшн-шлях."""
    from tools.audit_service import record_tool_invocation

    async def _run() -> list[int]:
        ids = []
        for i in range(n):
            row_id = await record_tool_invocation(
                actor_user_id=user_id,
                tool_name=f"f4_test_tool_{i}",
                args_snippet="{}",
                intent=f"тестовий запис №{i}",
                duration_ms=5 + i,
                outcome="ok" if i % 3 else "fail",
                error=None if i % 3 else "boom",
            )
            ids.append(row_id)
        return ids

    # Той самий прийом, що в test_audit_writers_persist.py: sync-тест,
    # окремий короткий loop на запис.
    return asyncio.run(_run())


class TestCockpitAudit:
    def test_requires_auth(self, unauth_client):
        r = unauth_client.get("/api/v1/cockpit/audit")
        assert r.status_code in (401, 403)

    def test_rows_written_are_readable_back(self, auth_operator_client, auth_operator_user):
        ids = _write_audit_rows(auth_operator_user.id, 3)
        # Письменник повертає -1 коли insert не персистнувся — це
        # окремий дефект, і тест мусить його назвати, не проковтнути.
        assert all(i > 0 for i in ids), f"audit writer failed: {ids}"

        r = auth_operator_client.get("/api/v1/cockpit/audit", params={"limit": 10})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] >= 3
        got_ids = [e["id"] for e in body["entries"]]
        for row_id in ids:
            assert row_id in got_ids, "записаний рядок не читається назад"

        newest = body["entries"][0]
        assert newest["ts_ms"] > 0
        assert newest["status"] in ("ok", "retry", "fail")
        assert newest["action_name"].startswith("f4_test_tool_")

        # Новіші згори: id спадають.
        assert got_ids == sorted(got_ids, reverse=True)

    def test_cursor_pagination_walks_without_overlap(
        self, auth_operator_client, auth_operator_user
    ):
        _write_audit_rows(auth_operator_user.id, 5)

        r1 = auth_operator_client.get("/api/v1/cockpit/audit", params={"limit": 2})
        assert r1.status_code == 200
        page1 = r1.json()
        assert len(page1["entries"]) == 2
        assert page1["next_before_id"] == page1["entries"][-1]["id"]

        r2 = auth_operator_client.get(
            "/api/v1/cockpit/audit",
            params={"limit": 2, "before_id": page1["next_before_id"]},
        )
        assert r2.status_code == 200
        page2 = r2.json()
        ids1 = {e["id"] for e in page1["entries"]}
        ids2 = {e["id"] for e in page2["entries"]}
        assert not (ids1 & ids2), "сторінки перетинаються"
        assert max(ids2, default=0) < min(ids1)

    def test_exhausted_journal_says_so(self, auth_operator_client):
        # before_id=1 → нижче першого рядка нічого нема.
        r = auth_operator_client.get(
            "/api/v1/cockpit/audit", params={"limit": 50, "before_id": 1}
        )
        assert r.status_code == 200
        body = r.json()
        assert body["entries"] == []
        assert body["next_before_id"] is None
