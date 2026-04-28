"""Tier-C I-7 — Day-2 D2-I1: chat-output safety classifier.

After Phase 17b enables ``call_with_tools``, the LLM has direct access
to ``recall_memory_facts`` — meaning a verbatim memory-fact quote can
now appear in the assistant's response and stream straight to TTS or
the chat broadcast. ``ai/output_safety.sanitize`` is the choke point
that scrubs those quotes before the response leaves the daemon.

This file pins the classifier's contract:

* sensitive facts (sealed / sensitive category / high importance) are
  redacted; non-sensitive ones flow through untouched
* very-short facts ("yes", "Home") never trigger redaction (too generic
  to risk false positives)
* whitespace-tolerant matching (reflowed quotes still get caught)
* DB failures degrade gracefully — return original text, no crash
* SanitiseResult carries redaction telemetry without echoing the
  redacted content (operator review must NOT have a copy of the leak)
"""

from __future__ import annotations

import uuid

import pytest


@pytest.fixture()
async def fresh_user():
    from db.database import init_db, get_session
    from db.models import User
    await init_db()
    user_id = str(uuid.uuid4())
    async with get_session() as db:
        db.add(User(
            id=user_id,
            username=f"phantom_i7_{user_id[:8]}",
            role="ROOT",
            pin_hash="x",
            rfid_uid_hash=None,
            preferences_json="{}",
        ))
        await db.commit()
    yield user_id


def _make_fact(*, user_id: str, content: str, category: str = "fact",
               importance: float = 0.5, is_sealed: bool = False):
    from db.models import MemoryFact
    return MemoryFact(
        id=str(uuid.uuid4()),
        user_id=user_id,
        layer="tactical",
        content=content,
        category=category,
        importance=importance,
        is_sealed=is_sealed,
        place_name=None,
        # MemoryFact.source_session_id is NOT NULL — give it a synthetic
        # session id so the SQL insert doesn't roll back.
        source_session_id=str(uuid.uuid4()),
    )


# ── Verbatim redaction ────────────────────────────────────────────────────────


class TestSensitiveCategoryRedaction:
    @pytest.mark.asyncio
    async def test_medical_fact_quoted_back_is_redacted(self, fresh_user):
        from db.database import get_session
        from ai.output_safety import sanitize

        user_id = fresh_user
        fact_text = "operator has Type 2 diabetes diagnosed 2024"
        async with get_session() as db:
            db.add(_make_fact(
                user_id=user_id,
                content=fact_text,
                category="medical",
                importance=0.6,
            ))
            await db.commit()

        async with get_session() as db:
            res = await sanitize(
                f"Sure — {fact_text}, that's noted.",
                user_id=user_id,
                db=db,
            )
        assert res.safe is False
        assert "[REDACTED]" in res.text
        assert fact_text not in res.text
        assert len(res.redactions) == 1
        assert res.redactions[0].fact_category == "medical"
        # The audit event MUST NOT carry the redacted content itself
        # (an operator review with a leak built into the audit log
        # defeats the point).
        assert not hasattr(res.redactions[0], "content")
        assert not hasattr(res.redactions[0], "text")

    @pytest.mark.asyncio
    async def test_financial_credential_categories_also_redact(self, fresh_user):
        from db.database import get_session
        from ai.output_safety import sanitize

        user_id = fresh_user
        cred_text = "Wi-Fi password is super-secret-passphrase-2026"
        async with get_session() as db:
            db.add(_make_fact(
                user_id=user_id,
                content=cred_text,
                category="credential",
                importance=0.5,
            ))
            await db.commit()

        async with get_session() as db:
            res = await sanitize(
                f"As you mentioned, {cred_text}.",
                user_id=user_id,
                db=db,
            )
        assert res.safe is False
        assert cred_text not in res.text


class TestImportanceFloor:
    @pytest.mark.asyncio
    async def test_high_importance_fact_is_redacted_even_with_neutral_category(
        self, fresh_user
    ):
        from db.database import get_session
        from ai.output_safety import sanitize

        user_id = fresh_user
        # Plain "fact" category but importance ≥ 0.85.
        sensitive_text = "the spare key is hidden under the third potted plant"
        async with get_session() as db:
            db.add(_make_fact(
                user_id=user_id,
                content=sensitive_text,
                category="fact",
                importance=0.92,
            ))
            await db.commit()

        async with get_session() as db:
            res = await sanitize(
                f"Yes, {sensitive_text}, just like you said.",
                user_id=user_id,
                db=db,
            )
        assert res.safe is False
        assert sensitive_text not in res.text

    @pytest.mark.asyncio
    async def test_low_importance_neutral_fact_is_NOT_redacted(self, fresh_user):
        from db.database import get_session
        from ai.output_safety import sanitize

        user_id = fresh_user
        async with get_session() as db:
            db.add(_make_fact(
                user_id=user_id,
                content="user prefers the colour blue",
                category="preference",
                importance=0.4,
            ))
            await db.commit()

        async with get_session() as db:
            res = await sanitize(
                "I see you prefer the colour blue.",
                user_id=user_id,
                db=db,
            )
        assert res.safe is True
        assert "blue" in res.text  # untouched


class TestSealedFactsAlwaysRedact:
    @pytest.mark.asyncio
    async def test_sealed_fact_is_redacted_regardless_of_category(self, fresh_user):
        from db.database import get_session
        from ai.output_safety import sanitize

        user_id = fresh_user
        sealed_text = "user mentioned a private memory about childhood"
        async with get_session() as db:
            db.add(_make_fact(
                user_id=user_id,
                content=sealed_text,
                category="event",
                importance=0.4,
                is_sealed=True,
            ))
            await db.commit()

        async with get_session() as db:
            res = await sanitize(
                f"Recalling: {sealed_text}.",
                user_id=user_id,
                db=db,
            )
        assert res.safe is False
        assert sealed_text not in res.text


# ── Robustness ────────────────────────────────────────────────────────────────


class TestWhitespaceTolerance:
    @pytest.mark.asyncio
    async def test_reflowed_quote_with_extra_spaces_is_caught(self, fresh_user):
        from db.database import get_session
        from ai.output_safety import sanitize

        user_id = fresh_user
        async with get_session() as db:
            db.add(_make_fact(
                user_id=user_id,
                content="house alarm code is 7741",
                category="credential",
                importance=0.5,
            ))
            await db.commit()

        async with get_session() as db:
            res = await sanitize(
                # extra whitespace + line break — reflowed quote.
                "the\thouse  alarm\n  code\t  is   7741, that's right.",
                user_id=user_id,
                db=db,
            )
        assert res.safe is False
        assert "7741" not in res.text


class TestShortFactNoOverRedaction:
    @pytest.mark.asyncio
    async def test_one_word_fact_does_not_redact_chat(self, fresh_user):
        # "Home" as a fact would otherwise wipe every "home" mention
        # in the response; refusing to redact short facts is essential
        # to keep chat usable.
        from db.database import get_session
        from ai.output_safety import sanitize

        user_id = fresh_user
        async with get_session() as db:
            db.add(_make_fact(
                user_id=user_id,
                content="Home",
                category="location_precise",
                importance=0.95,
            ))
            await db.commit()

        async with get_session() as db:
            res = await sanitize(
                "Welcome home — let me know what you need.",
                user_id=user_id,
                db=db,
            )
        assert res.safe is True
        assert "home" in res.text.lower()


class TestDbFailureDegradesGracefully:
    @pytest.mark.asyncio
    async def test_sanitize_returns_original_text_when_db_query_fails(self):
        from ai.output_safety import sanitize

        class _BoomDb:
            async def execute(self, *_a, **_kw):
                raise RuntimeError("synthetic DB outage")

        res = await sanitize(
            "the spare key is hidden under the third potted plant",
            user_id="phantom",
            db=_BoomDb(),
        )
        # No facts loaded → no redaction. Original text returned.
        assert res.safe is True
        assert "spare key" in res.text


class TestEmptyAndNoFacts:
    @pytest.mark.asyncio
    async def test_empty_text_is_returned_unchanged(self, fresh_user):
        from db.database import get_session
        from ai.output_safety import sanitize

        user_id = fresh_user
        async with get_session() as db:
            res = await sanitize("", user_id=user_id, db=db)
        assert res.text == ""
        assert res.safe is True

    @pytest.mark.asyncio
    async def test_user_with_no_facts_short_circuits_clean(self, fresh_user):
        from db.database import get_session
        from ai.output_safety import sanitize

        user_id = fresh_user
        async with get_session() as db:
            res = await sanitize(
                "Talking about my favourite topic.",
                user_id=user_id,
                db=db,
            )
        assert res.safe is True
