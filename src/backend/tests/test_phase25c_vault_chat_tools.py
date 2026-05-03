"""
Phase 25-C — Vault chat tools.

The AI can manage the user's vault from chat — list / get / create /
update / delete / restore — and audit rows are written with actor="ai"
so the operator's timeline distinguishes user-initiated from AI-initiated
edits. Reveal + use stay in 25-D behind Council + phone biometric.

Tests cover the chat-tool layer end-to-end against the real DB (same
session_factory pytest already uses for the rest of the agent suite),
verifying:

  • All 6 tool schemas are present in CHAT_DATA_TOOLS and reachable
    via get_tool_schema().
  • All 6 handlers are registered in tool_executor._HANDLERS.
  • All 6 are whitelisted in chat_tool_dispatcher._CHAT_SAFE_TOOL_NAMES.
  • Round-trip: AI-create → AI-list shows it → AI-get returns
    masked secrets → AI-update merges fields → AI-delete hides it →
    AI-restore brings it back.
  • Validation: unknown kind, missing card_id, ai_writable=false card
    rejects update + delete from AI but list/get still work.
  • Cross-user isolation: card created by user A is invisible to
    user B's chat tools.
  • Audit rows record actor="ai".
"""
from __future__ import annotations

import os
import uuid

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase25c")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ─── 1. Wiring ──────────────────────────────────────────────────────────────


class TestWiring:
    def test_all_tool_schemas_present(self) -> None:
        from ai.chat_tools import get_tool_schema
        for name in (
            "vault_list", "vault_get", "vault_create",
            "vault_update", "vault_delete", "vault_restore",
        ):
            schema = get_tool_schema(name)
            assert schema is not None, f"{name} missing from chat_tools"
            assert "parameters" in schema
            assert "description" in schema

    def test_all_handlers_registered(self) -> None:
        from ai.tool_executor import _HANDLERS
        for name in (
            "vault_list", "vault_get", "vault_create",
            "vault_update", "vault_delete", "vault_restore",
        ):
            assert name in _HANDLERS, f"{name} missing from _HANDLERS"

    def test_all_whitelisted_in_dispatcher(self) -> None:
        """Without the dispatcher whitelist the chat session would refuse
        to expose the tool, even though the handler exists. Catches
        accidental drift between handler registration and dispatcher
        gate."""
        from ai.chat_tool_dispatcher import _CHAT_SAFE_TOOL_NAMES
        for name in (
            "vault_list", "vault_get", "vault_create",
            "vault_update", "vault_delete", "vault_restore",
        ):
            assert name in _CHAT_SAFE_TOOL_NAMES, (
                f"{name} not in dispatcher safe-tools list"
            )


# ─── 2. End-to-end via the real DB ──────────────────────────────────────────


def _uid() -> str:
    return f"test-user-{uuid.uuid4().hex[:8]}"


@pytest.fixture
async def vault_user(_root_payload):
    """Create a real User row so vault tools that hit the DB find a
    valid owner_user_id. Uses the same DB session helper the conftest
    fixtures use."""
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
                pin_hash=None,
                rfid_uid_hash=None,
                avatar_url=None,
                preferences_json="{}",
            ))
            await db.commit()
    return _root_payload["id"]


class TestRoundTrip:
    @pytest.mark.asyncio
    async def test_create_then_list_then_get(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        create = _HANDLERS["vault_create"]
        list_ = _HANDLERS["vault_list"]
        get = _HANDLERS["vault_get"]

        result = await create({
            "kind": "service_login",
            "label": "Chat-created Gmail",
            "fields": {
                "username": {"value": "ai@example.com", "secret": False},
                "password": {"value": "ai-secret", "secret": True},
            },
            "tags": ["mail"],
        }, vault_user)
        assert result["ok"] is True
        card = result["card"]
        cid = card["id"]
        # Created card has masked secret + plain visible.
        assert card["fields"]["password"] == "***"
        assert card["fields"]["username"] == "ai@example.com"
        assert card["field_kinds"]["password"] == "secret"

        # list shows it
        listed = await list_({}, vault_user)
        assert listed["ok"] is True
        labels = [c["label"] for c in listed["cards"]]
        assert "Chat-created Gmail" in labels

        # get returns the same shape
        got = await get({"card_id": cid}, vault_user)
        assert got["ok"] is True
        assert got["card"]["id"] == cid

    @pytest.mark.asyncio
    async def test_update_merges_fields(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        create = _HANDLERS["vault_create"]
        update = _HANDLERS["vault_update"]
        c = await create({
            "kind": "api_key",
            "label": "OpenAI",
            "fields": {
                "service": {"value": "OpenAI", "secret": False},
                "key": {"value": "sk-original", "secret": True},
            },
        }, vault_user)
        cid = c["card"]["id"]
        result = await update({
            "card_id": cid,
            "fields": {
                "key": {"value": "sk-rotated", "secret": True},
            },
        }, vault_user)
        assert result["ok"] is True
        # service field NOT in the patch body — must survive.
        assert result["card"]["fields"]["service"] == "OpenAI"
        assert result["card"]["fields"]["key"] == "***"

    @pytest.mark.asyncio
    async def test_delete_then_restore(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        create = _HANDLERS["vault_create"]
        delete = _HANDLERS["vault_delete"]
        restore = _HANDLERS["vault_restore"]
        list_ = _HANDLERS["vault_list"]
        c = await create({
            "kind": "phone",
            "label": "Бабуся",
            "fields": {"number": {"value": "+380501112233", "secret": False}},
        }, vault_user)
        cid = c["card"]["id"]
        d = await delete({"card_id": cid}, vault_user)
        assert d["ok"] is True
        # vault_list (default scope) excludes deleted
        listed = await list_({}, vault_user)
        assert all(card["id"] != cid for card in listed["cards"])
        # restore brings it back
        r = await restore({"card_id": cid}, vault_user)
        assert r["ok"] is True
        assert r["card"]["deleted_at"] is None

    @pytest.mark.asyncio
    async def test_filter_by_kind(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        create = _HANDLERS["vault_create"]
        list_ = _HANDLERS["vault_list"]
        await create({
            "kind": "wifi_network",
            "label": "Home WiFi",
            "fields": {
                "ssid": {"value": "HomeNet", "secret": False},
                "password": {"value": "wifipass", "secret": True},
            },
        }, vault_user)
        result = await list_({"kind": "wifi_network"}, vault_user)
        assert result["ok"] is True
        for c in result["cards"]:
            assert c["kind"] == "wifi_network"


# ─── 3. Validation ──────────────────────────────────────────────────────────


class TestValidation:
    @pytest.mark.asyncio
    async def test_unknown_kind_rejected(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        result = await _HANDLERS["vault_create"]({
            "kind": "totally_made_up_kind",
            "label": "x",
            "fields": {},
        }, vault_user)
        assert result.get("ok") is not True
        assert "error_kind" in result
        assert result["error_kind"] == "invalid_args"

    @pytest.mark.asyncio
    async def test_missing_card_id_for_get(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        result = await _HANDLERS["vault_get"]({}, vault_user)
        assert result.get("ok") is not True
        assert "error_kind" in result
        assert result["error_kind"] == "invalid_args"

    @pytest.mark.asyncio
    async def test_label_too_long_rejected(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        result = await _HANDLERS["vault_create"]({
            "kind": "custom",
            "label": "x" * 200,  # > 160
            "fields": {},
        }, vault_user)
        assert result.get("ok") is not True
        assert "error_kind" in result

    @pytest.mark.asyncio
    async def test_get_nonexistent_returns_not_found(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        result = await _HANDLERS["vault_get"]({"card_id": "no-such"}, vault_user)
        assert result.get("ok") is not True
        assert "error_kind" in result
        assert result["error_kind"] == "not_found"


# ─── 4. ai_writable gate ────────────────────────────────────────────────────


class TestAIWritableGate:
    @pytest.mark.asyncio
    async def test_update_blocked_when_ai_writable_false(self, vault_user) -> None:
        """Operator can mark a card ai_writable=false to lock AI out of
        editing it — AI list/get still work, but update/delete reject."""
        from ai.tool_executor import _HANDLERS
        from db.database import get_session
        from db.models import VaultCard
        from sqlalchemy import select

        c = await _HANDLERS["vault_create"]({
            "kind": "custom", "label": "Locked card",
            "fields": {"note": {"value": "x", "secret": False}},
        }, vault_user)
        cid = c["card"]["id"]
        # Operator flip ai_writable directly (would normally be PATCH from FE)
        async with get_session() as db:
            row = (await db.execute(
                select(VaultCard).where(VaultCard.id == cid)
            )).scalar_one()
            row.ai_writable = False
            await db.commit()

        # AI tries to update — must reject.
        result = await _HANDLERS["vault_update"]({
            "card_id": cid, "label": "Renamed by AI",
        }, vault_user)
        assert result.get("ok") is not True
        assert "error_kind" in result
        assert result["error_kind"] == "forbidden"

        # AI tries to delete — must reject.
        result = await _HANDLERS["vault_delete"]({"card_id": cid}, vault_user)
        assert result.get("ok") is not True
        assert "error_kind" in result
        assert result["error_kind"] == "forbidden"

        # But AI can still GET (read-only access stays).
        result = await _HANDLERS["vault_get"]({"card_id": cid}, vault_user)
        assert result["ok"] is True


# ─── 5. Cross-user isolation ────────────────────────────────────────────────


class TestCrossUserIsolation:
    @pytest.mark.asyncio
    async def test_user_b_cannot_see_user_a_cards(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        from db.database import get_session
        from db.models import User

        # Create a card under vault_user (user A)
        c = await _HANDLERS["vault_create"]({
            "kind": "messenger", "label": "Telegram main",
            "fields": {"handle": {"value": "@me", "secret": False}},
        }, vault_user)
        cid = c["card"]["id"]

        # Provision user B in the DB
        user_b_id = _uid()
        async with get_session() as db:
            db.add(User(
                id=user_b_id, username=user_b_id,
                role="OPERATOR", pin_hash=None, rfid_uid_hash=None,
                avatar_url=None, preferences_json="{}",
            ))
            await db.commit()

        # B's vault_list — A's card MUST NOT appear.
        listed = await _HANDLERS["vault_list"]({}, user_b_id)
        ids = [card["id"] for card in listed["cards"]]
        assert cid not in ids

        # B's vault_get on A's id — not_found (no cross-tenant ack).
        got = await _HANDLERS["vault_get"]({"card_id": cid}, user_b_id)
        assert got.get("ok") is not True
        assert got.get("error_kind") == "not_found"


# ─── 6. Audit rows tagged actor="ai" ────────────────────────────────────────


class TestAuditActor:
    @pytest.mark.asyncio
    async def test_create_writes_ai_audit_row(self, vault_user) -> None:
        from ai.tool_executor import _HANDLERS
        from db.database import get_session
        from db.models import VaultAuditEntry
        from sqlalchemy import desc, select

        c = await _HANDLERS["vault_create"]({
            "kind": "company", "label": "AcmeCorp",
            "fields": {
                "edrpou": {"value": "12345678", "secret": False},
                "iban": {"value": "UA00...", "secret": True},
            },
        }, vault_user)
        cid = c["card"]["id"]
        async with get_session() as db:
            stmt = select(VaultAuditEntry).where(
                VaultAuditEntry.card_id == cid,
                VaultAuditEntry.action == "create",
            ).order_by(desc(VaultAuditEntry.created_at)).limit(1)
            row = (await db.execute(stmt)).scalar_one()
        assert row.actor == "ai", (
            "Phase 25-C regression: chat-tool create must record "
            "actor='ai' so the audit timeline distinguishes AI from "
            "operator-driven edits."
        )
