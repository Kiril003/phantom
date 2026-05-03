"""
Phase 25-B — Vault REST endpoints.

Verifies the full HTTP surface end-to-end:
  • create returns 201 + serialised card
  • secret values are MASKED in list/get/create responses ("***")
  • plain values surface as-is
  • cross-user reads return 404 (no cross-tenant leak)
  • patch only touches keys present in the body
  • soft delete + restore round-trip
  • audit log accumulates one row per mutation
  • known-kind enforcement (HTTP 400 on unknown)
  • unauthenticated requests get 401
"""
from __future__ import annotations


def _create_payload(**overrides):
    """Default well-formed CardCreate body."""
    body = {
        "kind": "service_login",
        "label": "Gmail основна",
        "fields": {
            "username": {"value": "kiril@example.com", "secret": False},
            "password": {"value": "hunter2", "secret": True},
            "url": {"value": "https://accounts.google.com", "secret": False},
        },
        "tags": ["mail", "primary"],
        "ai_writable": True,
    }
    body.update(overrides)
    return body


# ─── 1. Create + masking ────────────────────────────────────────────────────


class TestCreate:
    def test_create_returns_201_and_card(self, auth_root_client) -> None:
        r = auth_root_client.post("/api/v1/vault/cards", json=_create_payload())
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["kind"] == "service_login"
        assert body["label"] == "Gmail основна"
        assert body["tags"] == ["mail", "primary"]
        assert body["ai_writable"] is True
        # Masking: password is secret → "***"; username + url plain → as-is.
        assert body["fields"]["password"] == "***"
        assert body["fields"]["username"] == "kiril@example.com"
        assert body["fields"]["url"] == "https://accounts.google.com"
        assert body["field_kinds"] == {
            "username": "plain", "password": "secret", "url": "plain",
        }

    def test_unknown_kind_rejected(self, auth_root_client) -> None:
        r = auth_root_client.post(
            "/api/v1/vault/cards",
            json=_create_payload(kind="not_a_real_kind"),
        )
        assert r.status_code == 400
        assert "Unknown card kind" in r.json()["detail"]

    def test_label_required_min_length(self, auth_root_client) -> None:
        r = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label=""),
        )
        assert r.status_code == 422  # Pydantic min_length=1


# ─── 2. List + get ──────────────────────────────────────────────────────────


class TestListAndGet:
    def test_list_returns_created_card(self, auth_root_client) -> None:
        auth_root_client.post(
            "/api/v1/vault/cards",
            json=_create_payload(label="One only"),
        )
        r = auth_root_client.get("/api/v1/vault/cards")
        assert r.status_code == 200
        cards = r.json()["cards"]
        labels = [c["label"] for c in cards]
        assert "One only" in labels

    def test_filter_by_kind(self, auth_root_client) -> None:
        auth_root_client.post(
            "/api/v1/vault/cards",
            json=_create_payload(kind="email_account", label="Email kind"),
        )
        auth_root_client.post(
            "/api/v1/vault/cards",
            json=_create_payload(kind="phone", label="Phone kind", fields={
                "number": {"value": "+380501234567", "secret": False},
            }),
        )
        r = auth_root_client.get("/api/v1/vault/cards?kind=phone")
        assert r.status_code == 200
        cards = r.json()["cards"]
        assert all(c["kind"] == "phone" for c in cards)

    def test_filter_by_tag(self, auth_root_client) -> None:
        auth_root_client.post(
            "/api/v1/vault/cards",
            json=_create_payload(label="Tagged", tags=["work", "urgent"]),
        )
        r = auth_root_client.get("/api/v1/vault/cards?tag=urgent")
        cards = r.json()["cards"]
        assert any(c["label"] == "Tagged" for c in cards)
        r = auth_root_client.get("/api/v1/vault/cards?tag=NOT_A_TAG")
        cards = r.json()["cards"]
        assert all(c["label"] != "Tagged" for c in cards)

    def test_get_one_card(self, auth_root_client) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="Pick me"),
        ).json()
        r = auth_root_client.get(f"/api/v1/vault/cards/{c['id']}")
        assert r.status_code == 200
        assert r.json()["label"] == "Pick me"

    def test_get_nonexistent_yields_404(self, auth_root_client) -> None:
        r = auth_root_client.get("/api/v1/vault/cards/nope-doesnt-exist")
        assert r.status_code == 404


# ─── 3. Patch ───────────────────────────────────────────────────────────────


class TestPatch:
    def test_label_only(self, auth_root_client) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="Old"),
        ).json()
        r = auth_root_client.patch(
            f"/api/v1/vault/cards/{c['id']}", json={"label": "New"},
        )
        assert r.status_code == 200
        assert r.json()["label"] == "New"
        assert r.json()["fields"] == c["fields"]  # untouched

    def test_tags_only(self, auth_root_client) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(tags=["a"]),
        ).json()
        r = auth_root_client.patch(
            f"/api/v1/vault/cards/{c['id']}", json={"tags": ["b", "c"]},
        )
        assert r.json()["tags"] == ["b", "c"]

    def test_field_merge_keeps_untouched(self, auth_root_client) -> None:
        """Patching {fields: {password: ...}} must NOT clobber username."""
        c = auth_root_client.post(
            "/api/v1/vault/cards",
            json=_create_payload(),
        ).json()
        r = auth_root_client.patch(
            f"/api/v1/vault/cards/{c['id']}",
            json={"fields": {
                "password": {"value": "rotated", "secret": True},
            }},
        )
        body = r.json()
        # password rotated (still masked), but username + url survived.
        assert body["fields"]["username"] == "kiril@example.com"
        assert body["fields"]["url"] == "https://accounts.google.com"
        assert body["fields"]["password"] == "***"

    def test_ai_writable_toggle(self, auth_root_client) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(),
        ).json()
        assert c["ai_writable"] is True
        r = auth_root_client.patch(
            f"/api/v1/vault/cards/{c['id']}", json={"ai_writable": False},
        )
        assert r.json()["ai_writable"] is False


# ─── 4. Soft delete + restore ───────────────────────────────────────────────


class TestSoftDelete:
    def test_delete_hides_from_default_list(self, auth_root_client) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="Doomed"),
        ).json()
        r = auth_root_client.delete(f"/api/v1/vault/cards/{c['id']}")
        assert r.status_code == 204
        r = auth_root_client.get("/api/v1/vault/cards")
        assert all(card["label"] != "Doomed" for card in r.json()["cards"])

    def test_delete_visible_with_include_deleted(self, auth_root_client) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="Doomed2"),
        ).json()
        auth_root_client.delete(f"/api/v1/vault/cards/{c['id']}")
        r = auth_root_client.get("/api/v1/vault/cards?include_deleted=true")
        labels = [card["label"] for card in r.json()["cards"]]
        assert "Doomed2" in labels
        # Deleted card has a non-null deleted_at.
        doomed = next(card for card in r.json()["cards"] if card["label"] == "Doomed2")
        assert doomed["deleted_at"] is not None

    def test_restore_brings_card_back(self, auth_root_client) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="Bounce"),
        ).json()
        auth_root_client.delete(f"/api/v1/vault/cards/{c['id']}")
        r = auth_root_client.post(f"/api/v1/vault/cards/{c['id']}/restore")
        assert r.status_code == 200
        assert r.json()["deleted_at"] is None
        r = auth_root_client.get("/api/v1/vault/cards")
        assert any(card["label"] == "Bounce" for card in r.json()["cards"])

    def test_default_list_excludes_deleted(self, auth_root_client) -> None:
        """get_card on a deleted id returns 404 in the default flow —
        callers that want the deleted row must use include_deleted=true."""
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="Vanish"),
        ).json()
        auth_root_client.delete(f"/api/v1/vault/cards/{c['id']}")
        r = auth_root_client.get(f"/api/v1/vault/cards/{c['id']}")
        assert r.status_code == 404


# ─── 5. Audit log ───────────────────────────────────────────────────────────


class TestAudit:
    def test_audit_records_create_update_delete_restore(self, auth_root_client) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="Audited"),
        ).json()
        cid = c["id"]
        auth_root_client.patch(
            f"/api/v1/vault/cards/{cid}", json={"label": "Audited renamed"},
        )
        auth_root_client.delete(f"/api/v1/vault/cards/{cid}")
        auth_root_client.post(f"/api/v1/vault/cards/{cid}/restore")

        r = auth_root_client.get(f"/api/v1/vault/audit?card_id={cid}")
        assert r.status_code == 200
        actions = [e["action"] for e in r.json()["entries"]]
        # Newest first.
        assert actions[0] == "restore"
        assert "delete" in actions
        assert "update" in actions
        assert "create" in actions

    def test_audit_filtered_by_card(self, auth_root_client) -> None:
        a = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="A"),
        ).json()
        b = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="B"),
        ).json()
        auth_root_client.patch(
            f"/api/v1/vault/cards/{a['id']}", json={"label": "A2"},
        )
        r = auth_root_client.get(f"/api/v1/vault/audit?card_id={a['id']}")
        for entry in r.json()["entries"]:
            assert entry["card_id"] == a["id"]
        # B's create is in the user's audit but not under a's filter.
        r_all = auth_root_client.get("/api/v1/vault/audit")
        all_card_ids = {e["card_id"] for e in r_all.json()["entries"]}
        assert b["id"] in all_card_ids


# ─── 6. Cross-user isolation ────────────────────────────────────────────────


class TestCrossUserIsolation:
    def test_operator_cannot_read_root_card(
        self, auth_root_client, auth_operator_client,
    ) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="Root only"),
        ).json()
        # operator GET → 404 (NOT 403; we don't even acknowledge existence)
        r = auth_operator_client.get(f"/api/v1/vault/cards/{c['id']}")
        assert r.status_code == 404

    def test_operator_list_does_not_see_root_card(
        self, auth_root_client, auth_operator_client,
    ) -> None:
        auth_root_client.post(
            "/api/v1/vault/cards", json=_create_payload(label="Root listed"),
        )
        r = auth_operator_client.get("/api/v1/vault/cards")
        assert r.status_code == 200
        assert all(c["label"] != "Root listed" for c in r.json()["cards"])


# ─── 7. Auth ────────────────────────────────────────────────────────────────


class TestAuth:
    def test_unauth_list_returns_401(self, unauth_client) -> None:
        r = unauth_client.get("/api/v1/vault/cards")
        assert r.status_code == 401

    def test_unauth_create_returns_401(self, unauth_client) -> None:
        r = unauth_client.post(
            "/api/v1/vault/cards", json=_create_payload(),
        )
        assert r.status_code == 401
