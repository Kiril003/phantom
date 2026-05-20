"""Day-4 Wave-2 X-2 — per-sub-agent nonce + leaf sanitize wrapper
(ADR-ORC-002 + ADR-ORC-003).

Closes audit U3-ORCH-C1 (forged leaf envelopes) + U3-ORCH-C2 (cross-
agent prompt-injection).

Coverage:

1. fresh_sub_nonce() returns a 16-char hex string.
2. K=3 fresh nonces are pairwise unique.
3. None of the leaf nonces equals the merge envelope key
   (cross-pollination guard).
4. envelope_key_for_sub(idx, nonce) shape:
   `_phantom_sub_<idx>_<nonce>`.
5. envelope_key_for_sub rejects negative idx + non-16-char nonce.
6. merge_envelope_key() includes the existing chat_pipeline
   `_PROCESS_NONCE` (so a leaf cannot forge the merge marker).
7. sanitize_leaf_draft fail-open: when ai.output_safety.sanitize
   raises, returns the original text + logs WARN.
8. sanitize_leaf_draft on empty input returns empty (no work).
9. sanitize_leaf_draft normal path: forwards to output_safety.sanitize
   and returns the `.text` attribute of the result.
"""
from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ─────────────────────────────────────────────────────────── nonces ──


class TestFreshSubNonce:
    def test_returns_16_char_hex_string(self):
        from ai.agents import fresh_sub_nonce

        n = fresh_sub_nonce()
        assert isinstance(n, str)
        assert len(n) == 16
        # Hex character set.
        int(n, 16)

    def test_three_consecutive_nonces_are_unique(self):
        from ai.agents import fresh_sub_nonce

        nonces = [fresh_sub_nonce() for _ in range(3)]
        assert len(set(nonces)) == 3, (
            f"X-2: 3 fresh nonces should be pairwise unique; got {nonces!r}. "
            "secrets.token_hex(8) collision is astronomically unlikely; "
            "duplicates indicate a refactor that froze the seed."
        )

    def test_leaf_nonces_differ_from_merge_envelope(self):
        from ai.agents import fresh_sub_nonce, merge_envelope_key

        merge_key = merge_envelope_key()
        for _ in range(5):
            assert fresh_sub_nonce() not in merge_key, (
                "X-2: leaf nonce collided with merge envelope key — "
                "cross-pollination guard broken."
            )


# ──────────────────────────────────────────────────── envelope keys ──


class TestEnvelopeKeys:
    def test_shape_is_phantom_sub_idx_nonce(self):
        from ai.agents import envelope_key_for_sub

        n = "deadbeefcafef00d"  # 16-char hex
        assert envelope_key_for_sub(0, n) == f"_phantom_sub_0_{n}"
        assert envelope_key_for_sub(7, n) == f"_phantom_sub_7_{n}"

    def test_rejects_negative_sub_idx(self):
        from ai.agents import envelope_key_for_sub

        with pytest.raises(ValueError):
            envelope_key_for_sub(-1, "deadbeefcafef00d")

    def test_rejects_non_int_sub_idx(self):
        from ai.agents import envelope_key_for_sub

        with pytest.raises(ValueError):
            envelope_key_for_sub("zero", "deadbeefcafef00d")  # type: ignore[arg-type]

    def test_rejects_short_nonce(self):
        from ai.agents import envelope_key_for_sub

        with pytest.raises(ValueError):
            envelope_key_for_sub(0, "tooshort")

    def test_rejects_non_string_nonce(self):
        from ai.agents import envelope_key_for_sub

        with pytest.raises(ValueError):
            envelope_key_for_sub(0, 12345)  # type: ignore[arg-type]

    def test_merge_envelope_uses_process_nonce(self):
        """The merge envelope key MUST embed chat_pipeline._ENVELOPE_NONCE
        so a forged leaf cannot also forge the merge marker."""
        from ai.agents import merge_envelope_key
        from ai.chat_pipeline import _ENVELOPE_NONCE

        key = merge_envelope_key()
        assert _ENVELOPE_NONCE in key, (
            f"Expected merge envelope key {key!r} to contain "
            f"_ENVELOPE_NONCE = {_ENVELOPE_NONCE!r}; the cross-forge guard "
            f"requires them to match."
        )
        assert key.startswith("_phantom_merge_")


# ──────────────────────────────────────────────────── leaf sanitize ──


class TestSanitizeLeafDraft:
    @pytest.mark.asyncio
    async def test_empty_input_passthrough(self):
        from ai.agents import sanitize_leaf_draft

        result = await sanitize_leaf_draft(text="", user_id="u-1")
        assert result == ""

    @pytest.mark.asyncio
    async def test_normal_path_returns_sanitized_text(self):
        from ai.agents import sanitize_leaf_draft

        # Stub the inner sanitize to return a result with a redacted text.
        sanitised = MagicMock()
        sanitised.text = "this is [REDACTED]"
        with patch("ai.output_safety.sanitize", new=AsyncMock(return_value=sanitised)):
            out = await sanitize_leaf_draft(
                text="this is the original",
                user_id="u-1",
                db=None,
            )
        assert out == "this is [REDACTED]"

    @pytest.mark.asyncio
    async def test_fail_open_on_sanitize_crash(self, caplog):
        """When output_safety.sanitize raises, the leaf returns the
        ORIGINAL draft (fail-open) and logs WARN."""
        from ai.agents import sanitize_leaf_draft

        with patch(
            "ai.output_safety.sanitize",
            new=AsyncMock(side_effect=RuntimeError("simulated crash")),
        ):
            with caplog.at_level(logging.WARNING):
                out = await sanitize_leaf_draft(
                    text="raw leaf draft",
                    user_id="u-1",
                )
        assert out == "raw leaf draft"
        assert any(
            "X-2 leaf sanitize fail-open" in rec.message
            for rec in caplog.records
        ), "Fail-open path must emit a WARN with the X-2 marker."

    @pytest.mark.asyncio
    async def test_sanitize_returning_empty_text_falls_back_to_original(self):
        """Defensive: if `sanitize` returns a result whose `.text` is
        None or empty, the wrapper returns the ORIGINAL draft so the
        leaf never silently emits an empty string."""
        from ai.agents import sanitize_leaf_draft

        empty_result = MagicMock()
        empty_result.text = ""
        with patch(
            "ai.output_safety.sanitize", new=AsyncMock(return_value=empty_result)
        ):
            out = await sanitize_leaf_draft(text="hi", user_id="u-1")
        assert out == "hi", (
            "X-2 defensive: sanitize returning empty text must NOT zero "
            "out the leaf draft."
        )
