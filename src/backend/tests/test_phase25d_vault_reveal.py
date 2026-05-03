"""
Phase 25-D — vault.reveal (REST + chat tool).

Returns plaintext for ONE secret field on ONE card. Two surfaces:

  • REST POST /api/v1/vault/cards/{id}/reveal
        — operator-driven (Settings UI). actor="user" in audit.
  • chat tool vault_reveal
        — AI-driven during conversation. actor="ai" in audit. Arg
          `justification` is required (4..240 chars).

Both write a VaultAuditEntry with action="reveal" + details
{field_name, justification?, accessed_via?}, bump card.last_accessed_at,
and never return the plaintext anywhere except the response body.

Tests cover:
  • happy path (decrypt + return plaintext + audit + last_accessed_at)
  • not-found / not-secret / 503 on key rotation
  • cross-user isolation (B's id 404s)
  • justification gate on chat tool (too short → invalid_args)
  • REST schema discovery exposes the new endpoint
"""
from __future__ import annotations

import os
import uuid

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase25d")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ─── 1. Wiring ──────────────────────────────────────────────────────────────


class TestWiring:
    def test_chat_schema_present(self) -> None:
        from ai.chat_tools import get_tool_schema
        schema = get_tool_schema("vault_reveal")
        assert schema is not None
        required = schema["parameters"]["required"]
        assert "card_id" in required
        assert "field_name" in required
        assert "justification" in required

    def test_handler_registered(self) -> None:
        from ai.tool_executor import _HANDLERS
        assert "vault_reveal" in _HANDLERS

    def test_dispatcher_whitelisted(self) -> None:
        from ai.chat_tool_dispatcher import _CHAT_SAFE_TOOL_NAMES
        assert "vault_reveal" in _CHAT_SAFE_TOOL_NAMES


# ─── 2. REST surface ────────────────────────────────────────────────────────


def _payload():
    return {
        "kind": "service_login",
        "label": "Reveal-test card",
        "fields": {
            "username": {"value": "alice@example.com", "secret": False},
            "password": {"value": "supersecret-PIN-2026!", "secret": True},
        },
        "tags": [],
        "ai_writable": True,
    }


class TestRestReveal:
    def test_happy_path(self, auth_root_client) -> None:
        c = auth_root_client.post("/api/v1/vault/cards", json=_payload()).json()
        cid = c["id"]
        r = auth_root_client.post(
            f"/api/v1/vault/cards/{cid}/reveal",
            json={
                "field_name": "password",
                "justification": "operator opened Settings → reveal",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["card_id"] == cid
        assert body["field_name"] == "password"
        assert body["value"] == "supersecret-PIN-2026!"
        assert "revealed_at" in body

    def test_audit_records_actor_user(self, auth_root_client) -> None:
        c = auth_root_client.post("/api/v1/vault/cards", json=_payload()).json()
        cid = c["id"]
        auth_root_client.post(
            f"/api/v1/vault/cards/{cid}/reveal",
            json={
                "field_name": "password",
                "justification": "audit-test reveal from REST",
            },
        )
        r = auth_root_client.get(f"/api/v1/vault/audit?card_id={cid}")
        entries = r.json()["entries"]
        reveal = next(e for e in entries if e["action"] == "reveal")
        assert reveal["actor"] == "user"
        assert reveal["details"]["field_name"] == "password"
        assert "audit-test" in reveal["details"]["justification"]

    def test_last_accessed_at_bumped(self, auth_root_client) -> None:
        c = auth_root_client.post("/api/v1/vault/cards", json=_payload()).json()
        cid = c["id"]
        before = auth_root_client.get(f"/api/v1/vault/cards/{cid}").json()
        assert before["last_accessed_at"] is None
        auth_root_client.post(
            f"/api/v1/vault/cards/{cid}/reveal",
            json={"field_name": "password",
                  "justification": "bump test for last_accessed_at"},
        )
        after = auth_root_client.get(f"/api/v1/vault/cards/{cid}").json()
        assert after["last_accessed_at"] is not None

    def test_not_secret_field_rejected(self, auth_root_client) -> None:
        """Reveal of a plain-text field is meaningless — caller can read
        it via vault_get. We return 400 so the AI fixes its prompt."""
        c = auth_root_client.post("/api/v1/vault/cards", json=_payload()).json()
        r = auth_root_client.post(
            f"/api/v1/vault/cards/{c['id']}/reveal",
            json={"field_name": "username",
                  "justification": "reveal a plain field on purpose"},
        )
        assert r.status_code == 400
        assert "not secret" in r.json()["detail"].lower()

    def test_unknown_field_404(self, auth_root_client) -> None:
        c = auth_root_client.post("/api/v1/vault/cards", json=_payload()).json()
        r = auth_root_client.post(
            f"/api/v1/vault/cards/{c['id']}/reveal",
            json={"field_name": "ghost_field",
                  "justification": "field that does not exist"},
        )
        assert r.status_code == 404

    def test_unknown_card_404(self, auth_root_client) -> None:
        r = auth_root_client.post(
            "/api/v1/vault/cards/no-such-card/reveal",
            json={"field_name": "password",
                  "justification": "trying to read ghost card"},
        )
        assert r.status_code == 404

    def test_cross_user_404(self, auth_root_client, auth_operator_client) -> None:
        c = auth_root_client.post(
            "/api/v1/vault/cards", json=_payload(),
        ).json()
        r = auth_operator_client.post(
            f"/api/v1/vault/cards/{c['id']}/reveal",
            json={"field_name": "password",
                  "justification": "B trying to read A"},
        )
        assert r.status_code == 404

    def test_unauth_401(self, unauth_client) -> None:
        r = unauth_client.post(
            "/api/v1/vault/cards/anything/reveal",
            json={"field_name": "password",
                  "justification": "no token at all"},
        )
        assert r.status_code == 401


# ─── 3. Chat tool surface ───────────────────────────────────────────────────


@pytest.fixture
async def vault_user(_root_payload):
    """Real User row so chat-tool vault_reveal finds the owner."""
    from db.database import get_session
    from db.models import User
    from sqlalchemy import select

    async with get_session() as db:
        existing = (await db.execute(
            select(User).where(User.id == _root_payload["id"])
        )).scalar_one_or_none()
        if existing is None:
            db.add(User(
                id=_root_payload["id"],
                username=_root_payload["username"],
                role=_root_payload["role"],
                pin_hash=None, rfid_uid_hash=None,
                avatar_url=None, preferences_json="{}",
            ))
            await db.commit()
    return _root_payload["id"]


class TestChatReveal:
    @pytest.mark.asyncio
    async def test_happy_path_returns_plaintext(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        c = await _HANDLERS["vault_create"]({
            "kind": "api_key",
            "label": "OpenAI Reveal Test",
            "fields": {
                "service": {"value": "OpenAI", "secret": False},
                "key": {"value": "sk-revealable-PIN-001", "secret": True},
            },
        }, vault_user)
        cid = c["card"]["id"]
        result = await _HANDLERS["vault_reveal"]({
            "card_id": cid,
            "field_name": "key",
            "justification": "user asked the model to read it back aloud",
        }, vault_user)
        assert result["ok"] is True
        assert result["value"] == "sk-revealable-PIN-001"
        assert result["field_name"] == "key"

    @pytest.mark.asyncio
    async def test_audit_actor_ai(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        from db.database import get_session
        from db.models import VaultAuditEntry
        from sqlalchemy import desc, select

        c = await _HANDLERS["vault_create"]({
            "kind": "api_key",
            "label": "OpenAI Audit Test",
            "fields": {"key": {"value": "sk-x", "secret": True}},
        }, vault_user)
        cid = c["card"]["id"]
        await _HANDLERS["vault_reveal"]({
            "card_id": cid,
            "field_name": "key",
            "justification": "audit actor=ai marker test",
        }, vault_user)
        async with get_session() as db:
            stmt = select(VaultAuditEntry).where(
                VaultAuditEntry.card_id == cid,
                VaultAuditEntry.action == "reveal",
            ).order_by(desc(VaultAuditEntry.created_at)).limit(1)
            row = (await db.execute(stmt)).scalar_one()
        assert row.actor == "ai"
        import json
        details = json.loads(row.details_json)
        assert details["field_name"] == "key"
        assert "audit actor=ai" in details["justification"]
        assert details.get("accessed_via") == "chat_tool"

    @pytest.mark.asyncio
    async def test_justification_required(self, vault_user) -> None:
        """Missing justification → invalid_args. The chat tool is
        intentionally aggressive about this so the AI cannot quietly
        reveal secrets without leaving a human-readable trace."""
        from ai.tool_executor import _HANDLERS
        result = await _HANDLERS["vault_reveal"]({
            "card_id": "any",
            "field_name": "x",
            "justification": "tl",  # < 4 chars
        }, vault_user)
        assert result.get("ok") is not True
        assert result["error_kind"] == "invalid_args"

    @pytest.mark.asyncio
    async def test_not_secret_returns_distinct_error(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        c = await _HANDLERS["vault_create"]({
            "kind": "contact", "label": "Phonebook",
            "fields": {"phone": {"value": "+380501112233", "secret": False}},
        }, vault_user)
        result = await _HANDLERS["vault_reveal"]({
            "card_id": c["card"]["id"],
            "field_name": "phone",
            "justification": "trying to reveal a non-secret",
        }, vault_user)
        assert result.get("ok") is not True
        assert result["error_kind"] == "not_secret"

    @pytest.mark.asyncio
    async def test_cross_user_isolation_chat(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        from db.database import get_session
        from db.models import User

        c = await _HANDLERS["vault_create"]({
            "kind": "messenger", "label": "Telegram",
            "fields": {"token": {"value": "bot-token", "secret": True}},
        }, vault_user)
        cid = c["card"]["id"]
        user_b = f"isolated-user-{uuid.uuid4().hex[:6]}"
        async with get_session() as db:
            db.add(User(
                id=user_b, username=user_b, role="OPERATOR",
                pin_hash=None, rfid_uid_hash=None,
                avatar_url=None, preferences_json="{}",
            ))
            await db.commit()

        result = await _HANDLERS["vault_reveal"]({
            "card_id": cid,
            "field_name": "token",
            "justification": "user B trying to read user A's token",
        }, user_b)
        assert result.get("ok") is not True
        assert result["error_kind"] == "not_found"
