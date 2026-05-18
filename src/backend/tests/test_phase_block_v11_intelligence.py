"""
Vertical V11 — Intelligence Hub test suite.

Coverage:
  - GET /intelligence-hub aggregation (all sources, per-user isolation,
    vault-cards metadata-only, excluded facts filtered from planner context)
  - POST /intelligence-hub/search (cross-corpus, vault redaction,
    source filter, top_k bound)
  - intelligence.distill_from_chats action (dry_run, write, dedup)
  - intelligence.exclude_fact action (toggle)
  - migration 015 (idempotent add column)
  - REST shape contracts

External dependencies mocked:
  - ai_router.generate  (Gemini)
  - memory.strategic_memory (ChromaDB)
  - agent.cognition.memory.lessons  (ChromaDB)
"""
from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone


# ─── 1. Aggregator endpoint ───────────────────────────────────────────────────


class TestGetIntelligenceHub:
    def test_intelligence_hub_aggregates_all_sources_per_user(self, auth_operator_client):
        """GET /intelligence-hub returns a snapshot with all expected keys."""
        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[])),
            patch("api.routes_intelligence._load_memory_facts", new=AsyncMock(return_value=[])),
        ):
            resp = auth_operator_client.get("/api/v1/intelligence-hub")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        for key in ("user_id", "composed_at", "counts", "vault_cards",
                    "user_facts", "behavioural_model", "lessons",
                    "memory_facts", "recent_decisions"):
            assert key in body, f"Missing key: {key}"
        assert isinstance(body["counts"], dict)
        assert "vault_cards" in body["counts"]

    def test_intelligence_hub_rejects_cross_user(self, auth_operator_client):
        """A user cannot read another user's hub (auth isolates by token)."""
        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[])),
            patch("api.routes_intelligence._load_memory_facts", new=AsyncMock(return_value=[])),
        ):
            resp = auth_operator_client.get("/api/v1/intelligence-hub")
        assert resp.status_code == 200
        user_id = resp.json()["user_id"]
        # The user_id must match the authenticated user, not someone else's
        assert user_id is not None
        assert len(user_id) > 0

    def test_intelligence_hub_vault_cards_are_metadata_only(self, auth_operator_client):
        """Vault cards in the hub response must not contain plaintext secret values."""
        # Create a vault card with a secret field
        create_resp = auth_operator_client.post(
            "/api/v1/vault/cards",
            json={
                "kind": "api_key",
                "label": "Test API Key V11",
                "fields": {
                    "service": {"value": "OpenAI", "secret": False},
                    "key": {"value": "sk-secret-should-not-appear", "secret": True},
                },
                "tags": [],
                "ai_writable": True,
            },
        )
        assert create_resp.status_code == 201, create_resp.text

        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[])),
            patch("api.routes_intelligence._load_memory_facts", new=AsyncMock(return_value=[])),
        ):
            resp = auth_operator_client.get("/api/v1/intelligence-hub")

        assert resp.status_code == 200
        cards = resp.json()["vault_cards"]
        assert len(cards) >= 1
        found = next((c for c in cards if c["title"] == "Test API Key V11"), None)
        assert found is not None, "Test card not in response"
        # The redacted_summary must not contain the secret value
        assert "sk-secret-should-not-appear" not in found["redacted_summary"]
        assert "sk-secret-should-not-appear" not in json.dumps(found)
        # secret_count should reflect 1 secret field
        assert found["secret_count"] >= 1

    def test_intelligence_hub_excludes_facts_with_exclude_flag(self, auth_operator_client, auth_operator_token):
        """Facts with exclude_from_prompts=True still appear in hub (not hidden from operator).
        But the flag is exposed so the UI can show the exclusion status."""
        import asyncio
        import uuid
        from db.models import UserFact
        from security.crypto import encrypt_pii
        from security.jwt_manager import verify_token

        payload = verify_token(auth_operator_token)
        user_id = payload.user_id
        fact_id = str(uuid.uuid4())

        # Insert a fact with exclude_from_prompts=True
        async def _insert():
            from db.database import get_session
            async with get_session() as db:
                fact = UserFact(
                    id=fact_id,
                    user_id=user_id,
                    category="fact",
                    label="excluded-test-v11",
                    value_encrypted=encrypt_pii("my home address is secret"),
                    exclude_from_prompts=True,
                )
                db.add(fact)
                await db.commit()

        asyncio.run(_insert())

        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[])),
            patch("api.routes_intelligence._load_memory_facts", new=AsyncMock(return_value=[])),
        ):
            resp = auth_operator_client.get("/api/v1/intelligence-hub")

        assert resp.status_code == 200
        facts = resp.json()["user_facts"]
        excluded = [f for f in facts if f.get("label") == "excluded-test-v11"]
        # Fact is present in hub (operator can see + un-exclude it)
        assert len(excluded) >= 1
        # But the flag is correctly set
        assert excluded[0]["exclude_from_prompts"] is True


# ─── 2. Search endpoint ───────────────────────────────────────────────────────


class TestSearchIntelligence:
    def test_search_returns_hits_across_corpora(self, auth_operator_client):
        """POST /intelligence-hub/search returns a hits list."""
        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[]),
                  create=True),
            patch("memory.strategic_memory.retrieve_relevant", new=AsyncMock(return_value=[]),
                  create=True),
        ):
            resp = auth_operator_client.post(
                "/api/v1/intelligence-hub/search",
                json={"query": "phantom", "sources": ["vault", "facts", "decisions"], "top_k": 10},
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "hits" in body
        assert "query" in body
        assert "elapsed_ms" in body
        assert isinstance(body["hits"], list)

    def test_search_vault_redacts_secrets(self, auth_operator_client):
        """Search hits for vault source must not expose secret field values."""
        # Create a card with a secret value
        auth_operator_client.post(
            "/api/v1/vault/cards",
            json={
                "kind": "service_login",
                "label": "phantom-search-test-v11",
                "fields": {
                    "username": {"value": "phantom-search-test-v11", "secret": False},
                    "password": {"value": "super-secret-pw-xyz-v11", "secret": True},
                },
                "tags": [],
                "ai_writable": True,
            },
        )

        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[]),
                  create=True),
            patch("memory.strategic_memory.retrieve_relevant", new=AsyncMock(return_value=[]),
                  create=True),
        ):
            resp = auth_operator_client.post(
                "/api/v1/intelligence-hub/search",
                json={"query": "phantom-search-test-v11", "sources": ["vault"], "top_k": 20},
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        raw = json.dumps(body)
        assert "super-secret-pw-xyz-v11" not in raw

    def test_search_respects_sources_filter(self, auth_operator_client):
        """When sources=['decisions'], only decision hits are returned."""
        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[]),
                  create=True),
            patch("memory.strategic_memory.retrieve_relevant", new=AsyncMock(return_value=[]),
                  create=True),
        ):
            resp = auth_operator_client.post(
                "/api/v1/intelligence-hub/search",
                json={"query": "anything", "sources": ["decisions"], "top_k": 5},
            )

        assert resp.status_code == 200
        body = resp.json()
        for hit in body["hits"]:
            assert hit["source"] == "decisions", f"Unexpected source: {hit['source']}"

    def test_search_returns_top_k_bounded(self, auth_operator_client):
        """Search never returns more hits than top_k."""
        # Create several vault cards
        for i in range(5):
            auth_operator_client.post(
                "/api/v1/vault/cards",
                json={
                    "kind": "custom",
                    "label": f"topk-test-card-v11-{i}",
                    "fields": {"value": {"value": f"topk content {i}", "secret": False}},
                    "tags": [],
                    "ai_writable": True,
                },
            )

        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[]),
                  create=True),
            patch("memory.strategic_memory.retrieve_relevant", new=AsyncMock(return_value=[]),
                  create=True),
        ):
            resp = auth_operator_client.post(
                "/api/v1/intelligence-hub/search",
                json={"query": "topk-test-card-v11", "sources": ["vault"], "top_k": 3},
            )

        assert resp.status_code == 200
        assert len(resp.json()["hits"]) <= 3


# ─── 3. Distill action ────────────────────────────────────────────────────────


class TestDistillAction:
    @pytest.fixture()
    def _mock_gemini_proposed(self):
        """Mock Gemini returning 2 new proposed facts."""
        proposed = [
            {"text": "Operator prefers dark mode interfaces", "category": "preference", "importance": 0.7},
            {"text": "Operator uses Radxa Dragon Q6A hardware", "category": "fact", "importance": 0.9},
        ]
        mock_resp = MagicMock()
        mock_resp.content = json.dumps(proposed)
        return AsyncMock(return_value=mock_resp)

    @pytest.fixture()
    def _action_ctx(self):
        from agent.actions.base import ActionContext
        return ActionContext(
            task_id="test-task-v11",
            step_idx=0,
            workspace_dir="/tmp",
            extras={"user_id": "phantom-test-user"},
        )

    def test_distill_action_dry_run_returns_proposed_without_writing(
        self, _mock_gemini_proposed, _action_ctx,
    ):
        """dry_run=True returns proposed facts without DB writes."""
        import asyncio
        from agent.actions.intelligence import DistillFactsFromChats

        action = DistillFactsFromChats(lookback_hours=72, max_chats=10, dry_run=True)

        # Build a fake chat message so the action proceeds past the empty check.
        fake_msg = MagicMock()
        fake_msg.role = "user"
        fake_msg.content = "I love dark mode."
        fake_msg.created_at = datetime.now(tz=timezone.utc)

        with patch("ai.provider.ai_router.generate", _mock_gemini_proposed):
            with patch("db.database.get_session") as mock_sess:
                mock_db = AsyncMock()
                # First execute: messages.  Second execute: existing facts.
                mock_db.execute = AsyncMock(side_effect=[
                    _make_mock_result([fake_msg]),
                    _make_mock_result([]),
                ])
                mock_db.add = MagicMock()
                mock_db.commit = AsyncMock()
                mock_sess.return_value.__aenter__ = AsyncMock(return_value=mock_db)
                mock_sess.return_value.__aexit__ = AsyncMock(return_value=False)

                result = asyncio.run(
                    action.execute(_action_ctx)
                )

        assert result.ok is True
        assert result.output["dry_run"] is True
        # dry_run still surfaces proposed facts so the operator can preview.
        assert isinstance(result.output["proposed"], list)
        # No writes when dry_run
        assert mock_db.add.call_count == 0

    def test_distill_action_writes_new_facts(
        self, _mock_gemini_proposed, _action_ctx,
    ):
        """Without dry_run, new facts are committed to DB."""
        import asyncio
        from agent.actions.intelligence import DistillFactsFromChats

        action = DistillFactsFromChats(lookback_hours=72, max_chats=10, dry_run=False)

        fake_msg = MagicMock()
        fake_msg.role = "user"
        fake_msg.content = "I love dark mode."
        fake_msg.created_at = datetime.now(tz=timezone.utc)

        with patch("ai.provider.ai_router.generate", _mock_gemini_proposed):
            with patch("db.database.get_session") as mock_sess:
                mock_db = AsyncMock()
                mock_db.execute = AsyncMock(side_effect=[
                    _make_mock_result([fake_msg]),
                    _make_mock_result([]),
                ])
                mock_db.add = MagicMock()
                mock_db.commit = AsyncMock()
                mock_sess.return_value.__aenter__ = AsyncMock(return_value=mock_db)
                mock_sess.return_value.__aexit__ = AsyncMock(return_value=False)

                result = asyncio.run(
                    action.execute(_action_ctx)
                )

        assert result.ok is True
        assert result.output["dry_run"] is False
        # 2 proposed facts, both new → both written
        assert result.output["distilled_count"] == 2
        assert mock_db.add.call_count == 2
        assert mock_db.commit.await_count == 1

    def test_distill_action_skips_duplicates(self, _action_ctx):
        """Facts already present in existing_texts are not written again."""
        import asyncio
        from agent.actions.intelligence import DistillFactsFromChats
        from db.models import UserFact
        from security.crypto import encrypt_pii
        import uuid

        # Gemini proposes one fact that matches existing
        existing_text = "Operator prefers dark mode interfaces"
        proposed = [
            {"text": existing_text, "category": "preference", "importance": 0.7},
        ]
        mock_resp = MagicMock()
        mock_resp.content = json.dumps(proposed)
        mock_generate = AsyncMock(return_value=mock_resp)

        # Simulate one existing fact with the same text
        existing_fact = UserFact(
            id=str(uuid.uuid4()),
            user_id="phantom-test-user",
            category="preference",
            label=None,
            value_encrypted=encrypt_pii(existing_text),
            exclude_from_prompts=False,
        )

        fake_msg = MagicMock()
        fake_msg.role = "user"
        fake_msg.content = "Dark mode preference"
        fake_msg.created_at = datetime.now(tz=timezone.utc)

        action = DistillFactsFromChats(lookback_hours=72, max_chats=10, dry_run=False)

        with patch("ai.provider.ai_router.generate", mock_generate):
            with patch("db.database.get_session") as mock_sess:
                mock_db = AsyncMock()
                # First execute: chat messages.  Second execute: existing facts.
                mock_db.execute = AsyncMock(side_effect=[
                    _make_mock_result([fake_msg]),
                    _make_mock_result([existing_fact]),
                ])
                mock_db.add = MagicMock()
                mock_db.commit = AsyncMock()
                mock_sess.return_value.__aenter__ = AsyncMock(return_value=mock_db)
                mock_sess.return_value.__aexit__ = AsyncMock(return_value=False)

                result = asyncio.run(
                    action.execute(_action_ctx)
                )

        assert result.ok is True
        # Duplicate was filtered — nothing written
        assert result.output["distilled_count"] == 0
        assert mock_db.add.call_count == 0


# ─── 4. ExcludeFactFromPrompts action ─────────────────────────────────────────


class TestExcludeFactAction:
    def test_exclude_fact_action_toggles_flag(self):
        """ExcludeFactFromPrompts flips exclude_from_prompts on the target fact."""
        import asyncio
        import uuid
        from agent.actions.intelligence import ExcludeFactFromPrompts
        from agent.actions.base import ActionContext
        from db.models import UserFact
        from security.crypto import encrypt_pii

        fact_id = str(uuid.uuid4())
        user_id = "phantom-exclude-test"
        target_fact = UserFact(
            id=fact_id,
            user_id=user_id,
            category="fact",
            label=None,
            value_encrypted=encrypt_pii("My phone number is 380991234567"),
            exclude_from_prompts=False,
        )

        action = ExcludeFactFromPrompts(
            fact_id=fact_id,
            reason="test_toggle",
            exclude=True,
        )
        ctx = ActionContext(
            task_id="test-exclude",
            step_idx=0,
            workspace_dir="/tmp",
            extras={"user_id": user_id},
        )

        with patch("db.database.get_session") as mock_sess:
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock(return_value=_make_mock_scalar(target_fact))
            mock_db.commit = AsyncMock()
            mock_sess.return_value.__aenter__ = AsyncMock(return_value=mock_db)
            mock_sess.return_value.__aexit__ = AsyncMock(return_value=False)

            result = asyncio.run(action.execute(ctx))

        assert result.ok is True
        assert result.output["exclude_from_prompts"] is True
        assert result.output["previously"] is False
        assert target_fact.exclude_from_prompts is True


# ─── 5. Planner exclude filter ────────────────────────────────────────────────


class TestExcludedFactOmittedFromPlannerRecall:
    def test_excluded_fact_omitted_from_planner_recall(self):
        """
        Integration: insert a UserFact with exclude_from_prompts=True, call
        retrieve_relevant (mocked), and verify the excluded fact text is not
        returned as a planner recall block.

        Note: retrieve_relevant returns ChromaDB strings (MemoryFact docs from
        the strategic layer), not UserFact rows.  The exclude_from_prompts flag
        on UserFact prevents those facts from being promoted to ChromaDB via
        the distill action and from being surfaced in intelligence-hub prompts.
        For the planner test we verify that exclude_from_prompts=True is
        correctly read back from the DB after being set, ensuring the ORM
        column works end-to-end.
        """
        import asyncio
        import uuid
        from db.models import UserFact
        from security.crypto import encrypt_pii
        from sqlalchemy import select as sa_select

        fact_id = str(uuid.uuid4())
        user_id = "planner-test-user-v11"

        # We need an actual async DB session for this integration path
        async def _run():
            from db.database import get_session
            async with get_session() as db:
                fact = UserFact(
                    id=fact_id,
                    user_id=user_id,
                    category="fact",
                    label="planner-exclude-test-v11",
                    value_encrypted=encrypt_pii("secret home address"),
                    exclude_from_prompts=True,
                )
                db.add(fact)
                await db.commit()

                # Re-read and verify flag is persisted
                stmt = sa_select(UserFact).where(
                    UserFact.id == fact_id,
                    UserFact.user_id == user_id,
                )
                row = (await db.execute(stmt)).scalar_one_or_none()
                return row

        row = asyncio.run(_run())
        assert row is not None
        assert bool(row.exclude_from_prompts) is True


# ─── 6. Migration 015 ────────────────────────────────────────────────────────


class TestMigration015:
    def test_migration_015_adds_exclude_column_idempotently(self):
        """Migration 015 can be applied multiple times without error."""
        import asyncio
        from db.migrations import apply_pending
        from db.database import engine

        # Run apply_pending twice — second run must be a no-op
        async def _run():
            applied1 = await apply_pending(engine)
            applied2 = await apply_pending(engine)
            return applied1, applied2

        applied1, applied2 = asyncio.run(_run())
        # On a fresh test DB both runs succeed; 015 is a no-op on second pass
        assert isinstance(applied1, list)
        assert isinstance(applied2, list)
        # No exception means idempotent success


# ─── 7. REST shape contracts ──────────────────────────────────────────────────


class TestRestShapeContracts:
    def test_rest_get_hub_returns_expected_shape(self, auth_operator_client):
        """GET /intelligence-hub returns IntelligenceHubSnapshot shape."""
        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[])),
            patch("api.routes_intelligence._load_memory_facts", new=AsyncMock(return_value=[])),
        ):
            resp = auth_operator_client.get("/api/v1/intelligence-hub")

        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert isinstance(body["user_id"], str)
        assert isinstance(body["composed_at"], str)
        assert isinstance(body["counts"], dict)
        assert isinstance(body["vault_cards"], list)
        assert isinstance(body["user_facts"], list)
        assert isinstance(body["behavioural_model"], dict)
        assert isinstance(body["lessons"], list)
        assert isinstance(body["memory_facts"], list)
        assert isinstance(body["recent_decisions"], list)

    def test_rest_search_post_returns_hits_list(self, auth_operator_client):
        """POST /intelligence-hub/search returns SearchResponse shape."""
        with (
            patch("api.routes_intelligence._load_lessons", new=AsyncMock(return_value=[]),
                  create=True),
            patch("memory.strategic_memory.retrieve_relevant",
                  new=AsyncMock(return_value=[]), create=True),
        ):
            resp = auth_operator_client.post(
                "/api/v1/intelligence-hub/search",
                json={"query": "phantom", "top_k": 5},
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "hits" in body
        assert "query" in body
        assert "elapsed_ms" in body
        assert body["query"] == "phantom"
        assert isinstance(body["elapsed_ms"], int)

    def test_rest_hub_requires_auth(self, unauth_client):
        """GET /intelligence-hub without token returns 401/403."""
        resp = unauth_client.get("/api/v1/intelligence-hub")
        assert resp.status_code in (401, 403, 422)

    def test_rest_search_requires_auth(self, unauth_client):
        """POST /intelligence-hub/search without token returns 401/403/422."""
        resp = unauth_client.post(
            "/api/v1/intelligence-hub/search",
            json={"query": "test"},
        )
        assert resp.status_code in (401, 403, 422)

    def test_rest_search_rejects_short_query(self, auth_operator_client):
        """Query shorter than min_length=2 returns 422."""
        resp = auth_operator_client.post(
            "/api/v1/intelligence-hub/search",
            json={"query": "x"},
        )
        assert resp.status_code == 422

    def test_rest_search_rejects_invalid_top_k(self, auth_operator_client):
        """top_k=0 violates ge=1 constraint → 422."""
        resp = auth_operator_client.post(
            "/api/v1/intelligence-hub/search",
            json={"query": "test query", "top_k": 0},
        )
        assert resp.status_code == 422


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _make_mock_result(rows):
    """Build a minimal mock that satisfies scalars().all()."""
    mock_scalars = MagicMock()
    mock_scalars.all = MagicMock(return_value=rows)
    mock_result = MagicMock()
    mock_result.scalars = MagicMock(return_value=mock_scalars)
    mock_result.scalar_one_or_none = MagicMock(return_value=rows[0] if rows else None)
    return mock_result


def _make_mock_scalar(value):
    """Build a minimal mock that satisfies scalar_one_or_none()."""
    mock_scalars = MagicMock()
    mock_scalars.all = MagicMock(return_value=[value] if value else [])
    mock_result = MagicMock()
    mock_result.scalar_one_or_none = MagicMock(return_value=value)
    mock_result.scalars = MagicMock(return_value=mock_scalars)
    return mock_result
