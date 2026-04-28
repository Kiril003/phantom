"""Day-4 Wave-1 — Block IDB-1: multi-user pytest under
deployment_mode='single' (ADR-IDB-001).

The Day-2 audit (D2-I2 invariant) refused multi-tenant deploys until
per-tenant ContextEngine ships. The phrase "multi-tenant" is loaded —
multiple SEPARATE customer organisations on one daemon. PHANTOM's
single-device case is *single-tenant, multi-USER*: one Radxa box
running for a family of 4, each with their own User row, their own
chat history, their own standing orders. That has always been
supported by the schema (`User.id` is the primary key on every chat /
standing-order row) but was never PINNED by a test, so a future refactor
could regress cross-user isolation without anyone noticing until a
family member opened the device and saw someone else's chats.

This test pins:

1. `config.deployment_mode` defaults to `'single'` (the cluster
   invariant from `audit-2026-04-30 R-2`).
2. `_refuse_unsupported_deployment_mode()` does NOT raise just
   because more than one User row exists — single-tenant multi-user
   is a legitimate deployment.
3. Two distinct users (root + operator from conftest fixtures) can
   each list ONLY their own chat sessions through `GET /chat/sessions`
   — no cross-user leak.
4. User A cannot fetch User B's messages via
   `GET /chat/sessions/{B's id}/messages` — 404, not 200.
5. `GET /auth/me` returns the user matching the bearer token, not the
   first row in the table.

Coverage of these five points constitutes the IDB-1 contract; the
single audit finding `IDB-D-1` (multi-user invariants unpinned) closes.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import pytest


# ──────────────────────────────────────────── deployment_mode default + guard ──


class TestDeploymentModeDefaultIsSingle:
    def test_config_default_is_single(self):
        from config import PhantomConfig

        default = PhantomConfig.model_fields["deployment_mode"].default
        assert default == "single", (
            f"IDB-1 regression: deployment_mode default flipped to "
            f"{default!r}. The Day-2 D2-I2 invariant assumes single-mode "
            "by default; flipping requires per-tenant ContextEngine."
        )

    def test_refuse_guard_passes_under_single_mode(self):
        from config import config
        from main import _refuse_unsupported_deployment_mode

        # No matter how many User rows live in the DB, single mode is
        # ALWAYS legal. The guard is about deployment topology, not
        # about user-row count.
        prev = config.deployment_mode
        config.deployment_mode = "single"
        try:
            _refuse_unsupported_deployment_mode()  # must not raise
        finally:
            config.deployment_mode = prev


# ────────────────────────────────────────────────── multi-user data isolation ──


@pytest.mark.asyncio
async def test_two_users_have_isolated_chat_sessions(
    auth_root_client,
    auth_root_user,
    auth_operator_client,
    auth_operator_user,
):
    """Both users coexist; each sees ONLY their own sessions."""
    from db.database import get_session
    from db.models import ChatSession, ChatMessage

    # Sanity: the two fixtures gave us distinct user_ids.
    assert auth_root_user.id != auth_operator_user.id, (
        "IDB-1 sanity: conftest gave the two clients the same user — the "
        "fixtures aren't isolating identity, the test below is meaningless."
    )

    # Seed: 2 sessions for root, 1 for operator. Avoid going through the
    # send_message endpoint — it calls the AI provider, which is heavy
    # and irrelevant here. Direct INSERT keeps the test scope to the
    # GET /sessions filter.
    root_session_ids = [str(uuid.uuid4()) for _ in range(2)]
    op_session_id = str(uuid.uuid4())
    started_root = datetime(2026, 5, 1, 10, 0, 0, tzinfo=timezone.utc)
    started_op = datetime(2026, 5, 1, 11, 0, 0, tzinfo=timezone.utc)

    async with get_session() as db:
        for sid in root_session_ids:
            db.add(
                ChatSession(
                    id=sid,
                    user_id=auth_root_user.id,
                    started_at=started_root,
                    message_count=1,
                    state_history_json="[]",
                )
            )
            db.add(
                ChatMessage(
                    id=str(uuid.uuid4()),
                    session_id=sid,
                    user_id=auth_root_user.id,
                    role="user",
                    content="root-secret",
                    response_form="text",
                    metadata_json="{}",
                    attachments_json="[]",
                    created_at=started_root,
                )
            )
        db.add(
            ChatSession(
                id=op_session_id,
                user_id=auth_operator_user.id,
                started_at=started_op,
                message_count=1,
                state_history_json="[]",
            )
        )
        db.add(
            ChatMessage(
                id=str(uuid.uuid4()),
                session_id=op_session_id,
                user_id=auth_operator_user.id,
                role="user",
                content="op-secret",
                response_form="text",
                metadata_json="{}",
                attachments_json="[]",
                created_at=started_op,
            )
        )
        await db.commit()

    try:
        # Root sees their 2 sessions, NOT the operator's.
        r = auth_root_client.get("/api/v1/chat/sessions")
        assert r.status_code == 200, r.text
        payload_root = r.json()
        seen_ids = {s["id"] for s in payload_root["sessions"]}
        assert set(root_session_ids).issubset(seen_ids), (
            "IDB-1 regression: root client missing one of its own sessions"
        )
        assert op_session_id not in seen_ids, (
            "IDB-1 LEAK: root listed an operator-owned session — "
            "ChatSession.user_id filter regressed."
        )
        for s in payload_root["sessions"]:
            assert s["user_id"] == auth_root_user.id, (
                "IDB-1 LEAK: ChatSession serialised under wrong user_id "
                f"({s['user_id']!r}) for the root client."
            )

        # Operator sees only their 1 session.
        r = auth_operator_client.get("/api/v1/chat/sessions")
        assert r.status_code == 200, r.text
        payload_op = r.json()
        op_seen_ids = {s["id"] for s in payload_op["sessions"]}
        assert op_session_id in op_seen_ids
        for sid in root_session_ids:
            assert sid not in op_seen_ids, (
                f"IDB-1 LEAK: operator listed root-owned session {sid!r}."
            )

    finally:
        # Clean up our seeded rows so subsequent tests start neutral.
        async with get_session() as db:
            from sqlalchemy import delete

            await db.execute(
                delete(ChatMessage).where(
                    ChatMessage.session_id.in_(root_session_ids + [op_session_id])
                )
            )
            await db.execute(
                delete(ChatSession).where(
                    ChatSession.id.in_(root_session_ids + [op_session_id])
                )
            )
            await db.commit()


@pytest.mark.asyncio
async def test_cross_user_session_messages_returns_404(
    auth_root_client,
    auth_root_user,
    auth_operator_client,
    auth_operator_user,
):
    """User A asking for User B's session messages must get 404, not
    200 with a leaked transcript."""
    from db.database import get_session
    from db.models import ChatSession, ChatMessage

    assert auth_root_user.id != auth_operator_user.id

    op_session_id = str(uuid.uuid4())
    started = datetime(2026, 5, 1, 11, 0, 0, tzinfo=timezone.utc)

    async with get_session() as db:
        db.add(
            ChatSession(
                id=op_session_id,
                user_id=auth_operator_user.id,
                started_at=started,
                message_count=1,
                state_history_json="[]",
            )
        )
        db.add(
            ChatMessage(
                id=str(uuid.uuid4()),
                session_id=op_session_id,
                user_id=auth_operator_user.id,
                role="user",
                content="op-private-content",
                response_form="text",
                metadata_json="{}",
                attachments_json="[]",
                created_at=started,
            )
        )
        await db.commit()

    try:
        r = auth_root_client.get(
            f"/api/v1/chat/sessions/{op_session_id}/messages"
        )
        assert r.status_code == 404, (
            f"IDB-1 LEAK: root client got HTTP {r.status_code} for "
            f"operator-owned session messages — expected 404. Body: "
            f"{r.text[:500]}"
        )
        assert "op-private-content" not in r.text, (
            "IDB-1 CRITICAL LEAK: cross-user message content surfaced in "
            "the 404 body."
        )
    finally:
        async with get_session() as db:
            from sqlalchemy import delete

            await db.execute(
                delete(ChatMessage).where(ChatMessage.session_id == op_session_id)
            )
            await db.execute(
                delete(ChatSession).where(ChatSession.id == op_session_id)
            )
            await db.commit()


@pytest.mark.asyncio
async def test_me_returns_token_user_not_first_row(
    auth_root_client,
    auth_root_user,
    auth_operator_client,
    auth_operator_user,
):
    """`/auth/me` must reflect the bearer token's user, not whichever
    User row the DB happens to return first."""
    assert auth_root_user.id != auth_operator_user.id

    r1 = auth_root_client.get("/api/v1/auth/me")
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["id"] == auth_root_user.id
    assert body1["role"] == "ROOT"

    r2 = auth_operator_client.get("/api/v1/auth/me")
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["id"] == auth_operator_user.id
    assert body2["role"] == "OPERATOR"

    # Belt-and-braces: their bodies MUST differ.
    assert json.dumps(body1, sort_keys=True) != json.dumps(body2, sort_keys=True), (
        "IDB-1 LEAK: /me returned identical bodies for two distinct "
        "tokens — get_current_user is not honouring the JWT user_id."
    )
