"""Embedding-function factory + store-coherence guard.

These tests never load a model — the point is the wiring and the guard, both
of which must hold on a machine with no HuggingFace cache.
"""
from __future__ import annotations

import logging

import pytest

from memory.embedding_fn import (
    E5_SYMMETRIC_PREFIX,
    FINGERPRINT_FILE,
    PrefixedEmbeddingFunction,
    assert_store_matches_model,
    is_e5_model,
    read_store_fingerprint,
    write_store_fingerprint,
)


class _RecordingEF:
    """Stand-in for Chroma's SentenceTransformerEmbeddingFunction."""

    def __init__(self) -> None:
        self.seen: list = []

    def __call__(self, input):  # noqa: A002 — Chroma's protocol name
        self.seen.append(input)
        if isinstance(input, str):
            return [0.0]
        return [[0.0] for _ in input]

    def name(self) -> str:
        return "recording"


def test_is_e5_model_detects_the_family_not_substrings():
    assert is_e5_model("intfloat/multilingual-e5-small")
    assert is_e5_model("intfloat/e5-large-v2")
    assert not is_e5_model("all-MiniLM-L6-v2")
    # "e5" must be a token, not an accidental substring of another word.
    assert not is_e5_model("some/preprocessed-model")


def test_prefix_wrapper_prefixes_every_input():
    inner = _RecordingEF()
    fn = PrefixedEmbeddingFunction(inner, E5_SYMMETRIC_PREFIX)
    fn(["Де живе користувач?", "Кава без цукру"])
    assert inner.seen == [
        ["query: Де живе користувач?", "query: Кава без цукру"]
    ]


def test_prefix_wrapper_handles_a_bare_string():
    inner = _RecordingEF()
    fn = PrefixedEmbeddingFunction(inner, E5_SYMMETRIC_PREFIX)
    fn("одне речення")
    assert inner.seen == ["query: одне речення"]


def test_prefix_wrapper_is_a_transparent_proxy():
    fn = PrefixedEmbeddingFunction(_RecordingEF(), E5_SYMMETRIC_PREFIX)
    assert fn.name() == "recording"


def test_fingerprint_roundtrip(tmp_path):
    assert read_store_fingerprint(tmp_path) is None
    write_store_fingerprint(tmp_path, "intfloat/multilingual-e5-small")
    assert read_store_fingerprint(tmp_path) == "intfloat/multilingual-e5-small"
    assert (tmp_path / FINGERPRINT_FILE).is_file()


def test_fresh_store_is_adopted_silently(tmp_path):
    store = tmp_path / "chroma"
    store.mkdir()
    assert assert_store_matches_model(store, "intfloat/multilingual-e5-small")
    assert read_store_fingerprint(store) == "intfloat/multilingual-e5-small"


def test_matching_fingerprint_passes(tmp_path):
    write_store_fingerprint(tmp_path, "all-MiniLM-L6-v2")
    assert assert_store_matches_model(tmp_path, "all-MiniLM-L6-v2")


def test_mismatch_is_reported_loudly_but_does_not_raise(tmp_path, caplog):
    write_store_fingerprint(tmp_path, "all-MiniLM-L6-v2")
    with caplog.at_level(logging.ERROR):
        ok = assert_store_matches_model(tmp_path, "intfloat/multilingual-e5-small")
    assert ok is False
    message = caplog.text
    # The operator needs both the cause and the two ways out.
    assert "384" in message
    assert "reembed_memory" in message
    assert "all-MiniLM-L6-v2" in message


def test_unfingerprinted_store_with_vectors_warns(tmp_path, caplog):
    store = tmp_path / "chroma"
    (store / "8a7b-uuid-collection").mkdir(parents=True)
    with caplog.at_level(logging.WARNING):
        ok = assert_store_matches_model(store, "intfloat/multilingual-e5-small")
    assert ok is False
    assert "no embedding fingerprint" in caplog.text
    # Fingerprinted afterwards so the warning fires once, not every boot.
    assert read_store_fingerprint(store) == "intfloat/multilingual-e5-small"


@pytest.mark.parametrize(
    "model,wrapped",
    [("intfloat/multilingual-e5-small", True), ("all-MiniLM-L6-v2", False)],
)
def test_factory_wraps_only_e5(monkeypatch, model, wrapped):
    import chromadb.utils.embedding_functions as chroma_ef

    monkeypatch.setattr(
        chroma_ef, "SentenceTransformerEmbeddingFunction",
        lambda **kwargs: _RecordingEF(),
    )
    from memory.embedding_fn import build_embedding_function

    fn = build_embedding_function(model)
    assert isinstance(fn, PrefixedEmbeddingFunction) is wrapped
