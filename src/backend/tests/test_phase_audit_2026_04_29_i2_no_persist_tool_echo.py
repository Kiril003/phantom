"""Tier-C I-2 — Day-2 D2-T2: don't persist AI tool-result echoes.

The chat turn pipeline used to call ``extract_and_store_facts`` with
``f"{user_message} {ai_response.content}"`` — the assistant's text was
stored straight into the user's memory layer alongside the user's own
words. With Phase 17b's ``call_with_tools`` enabled, ``ai_response``
can verbatim quote a recall hit, a location row, or a sensor snapshot
field; that becomes a "fact" the next turn's
``retrieve_relevant()`` pulls back and the LLM treats as ground truth.
Self-poisoning loop.

Until the D2-I1 output-safety classifier ships, the chat path stores
user_message only. This regression freezes that.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch, AsyncMock


class TestD2T2NoPersistToolEcho:
    def test_chat_turn_only_persists_user_message(self):
        # Inspect the source as the cheap, robust check: the
        # `extract_and_store_facts` call site MUST pass user_message
        # only as the conversation_summary, NOT a combined string with
        # ai_response.content. Source-level assertion is the safest
        # regression guard — full chat-turn integration would have to
        # mock the entire AI router and we'd be testing the mocks.
        import inspect
        from api import routes_chat

        src = inspect.getsource(routes_chat)
        # Look for the audit-tag comment + the canonical call shape.
        assert "D2-T2" in src, (
            "D2-T2 regression: audit-tag comment removed; reviewers "
            "may not realise the AI-echo persistence is a deliberate skip."
        )
        # The combined-text variable must NOT exist any more.
        assert 'combined_text = f"{user_message}' not in src, (
            "D2-T2 regression: routes_chat still concatenates "
            "ai_response.content into the conversation_summary."
        )
        # And the persistence call must explicitly pass user_message.
        assert "conversation_summary=user_message" in src, (
            "D2-T2 regression: the persistence call no longer hands "
            "user_message verbatim — likely re-introduced the AI text."
        )

    def test_extract_and_store_facts_signature_unchanged(self):
        # If the function signature drifts (e.g. swap conversation_summary
        # for a richer object), the comment-based contract above stops
        # being meaningful. Pin the keyword.
        import inspect
        from memory.strategic_memory import extract_and_store_facts

        sig = inspect.signature(extract_and_store_facts)
        assert "conversation_summary" in sig.parameters, (
            "D2-T2 regression: extract_and_store_facts no longer accepts "
            "conversation_summary; routes_chat call site needs revisiting."
        )
