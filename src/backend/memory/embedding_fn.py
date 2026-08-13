"""
Embedding-function factory + store/model coherence guard.

Why this module exists
──────────────────────
PHANTOM's memory used ``all-MiniLM-L6-v2``, which is an **English-only**
model. On Ukrainian — the product's actual language — its retrieval is
close to random. Measured on a 6-fact / 4-query Ukrainian probe:

    all-MiniLM-L6-v2               top-1 1/4   mean margin  -0.033
    multilingual-e5-small          top-1 4/4   mean margin  +0.042
    multilingual-e5-small (prefix) top-1 4/4   mean margin  +0.052

A *negative* mean margin means the correct fact was, on average, not the
nearest neighbour: strategic memory was returning noise for Ukrainian
input while looking perfectly healthy from the outside.

The trap: both models emit **384 dimensions**. Chroma validates dimension,
not provenance, so swapping the model raises no error anywhere — a store
written by one model and queried by the other silently degrades to garbage
retrieval. Dimension compatibility is the hazard here, not the green light.
Hence ``assert_store_matches_model``: a fingerprint written beside the
Chroma store, checked on first use, which is the *only* thing standing
between an operator and a silently poisoned memory.

e5 prefixes
───────────
e5 models are trained with ``query: `` / ``passage: `` prefixes. Chroma's
embedding-function protocol is ``__call__(input) -> embeddings`` — it does
not say whether it is embedding a document or a query, so the asymmetric
form is not expressible without precomputing every vector at all ~10 call
sites. The e5 model card documents a symmetric mode for semantic-similarity
work: use ``query: `` on both sides. That is stateless, needs no call-site
changes, and measured better than no prefix at all (+0.052 vs +0.042), so
that is what we use.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Filename of the fingerprint dropped next to the Chroma store.
FINGERPRINT_FILE = ".embedding_model"

# Symmetric prefix per the e5 model card. Applied to documents and queries
# alike — see the module docstring for why the asymmetric form is not
# reachable through Chroma's embedding-function protocol.
E5_SYMMETRIC_PREFIX = "query: "


def is_e5_model(model_name: str) -> bool:
    """True for the e5 family, which requires input prefixes to perform."""
    return "e5" in model_name.lower().rsplit("/", 1)[-1].split("-")


class PrefixedEmbeddingFunction:
    """Wraps any Chroma embedding function, prepending a fixed prefix.

    Implements Chroma's ``EmbeddingFunction`` protocol structurally (it is a
    ``typing.Protocol``, so no inheritance is required) and stays a thin,
    stateless pass-through: no mode flags, nothing to get out of sync
    between the add path and the query path.
    """

    def __init__(self, inner: Any, prefix: str) -> None:
        self._inner = inner
        self._prefix = prefix

    def __call__(self, input: Any) -> Any:  # noqa: A002 — Chroma's protocol name
        if isinstance(input, str):
            return self._inner(self._prefix + input)
        return self._inner([self._prefix + str(text) for text in input])

    # Chroma 0.5 persists `name()` for some embedding functions; forward
    # anything else to the wrapped instance so we stay a transparent proxy.
    def __getattr__(self, item: str) -> Any:
        return getattr(self._inner, item)


def build_embedding_function(model_name: str, *, device: str = "cpu") -> Any:
    """Construct the embedding function for ``model_name``.

    e5-family models get the symmetric prefix wrapper; everything else is
    the plain SentenceTransformer function, unchanged — so pinning the old
    model in settings restores exactly the previous behaviour.
    """
    from chromadb.utils import embedding_functions as _ef

    # Prefer the on-disk cache. `SentenceTransformer` otherwise asks
    # huggingface.co for the model's ETag on *every* cold build, even when
    # every file is already cached — and when the device has no uplink that
    # call does not fail fast, it goes through `huggingface_hub.http_backoff`,
    # which retries with growing sleeps. PHANTOM runs on hardware that is
    # routinely offline, and this sits under `strategic_memory._get_ef()`, so
    # the stall lands on ordinary memory writes.
    #
    # Chroma forwards **kwargs straight to SentenceTransformer, so
    # `local_files_only` reaches the loader. First run still needs the network
    # to fetch the model, hence the fallback.
    try:
        base = _ef.SentenceTransformerEmbeddingFunction(
            model_name=model_name, device=device, local_files_only=True
        )
    except Exception as exc:  # not cached yet — let it download
        logger.info(
            "embedding model %r not in the local cache (%s) — fetching it; "
            "subsequent loads stay offline.",
            model_name, type(exc).__name__,
        )
        base = _ef.SentenceTransformerEmbeddingFunction(
            model_name=model_name, device=device
        )
    if is_e5_model(model_name):
        return PrefixedEmbeddingFunction(base, E5_SYMMETRIC_PREFIX)
    return base


def read_store_fingerprint(chroma_path: str | Path) -> str | None:
    """The model a Chroma store's vectors were written with, if recorded."""
    path = Path(chroma_path) / FINGERPRINT_FILE
    try:
        value = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None
    return value or None


def write_store_fingerprint(chroma_path: str | Path, model_name: str) -> None:
    """Record which model wrote this store. Best-effort: a read-only data
    dir must not take the memory subsystem down."""
    directory = Path(chroma_path)
    try:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / FINGERPRINT_FILE).write_text(model_name, encoding="utf-8")
    except OSError as exc:
        logger.warning("embedding fingerprint not written to %s: %s", directory, exc)


def assert_store_matches_model(chroma_path: str | Path, model_name: str) -> bool:
    """Compare the store's fingerprint against the configured model.

    Returns True when the store is coherent (matching fingerprint, or a
    store that has no fingerprint *and* no vectors yet — the fresh-install
    case, which we adopt silently).

    On a real mismatch this logs an error loud enough to be actionable and
    returns False. It deliberately does **not** raise: refusing to start
    would strand an operator with no path back, whereas a degraded-but-
    running memory plus explicit instructions is recoverable.
    """
    directory = Path(chroma_path)
    recorded = read_store_fingerprint(directory)

    if recorded == model_name:
        return True

    if recorded is None:
        # No fingerprint. Either a brand-new store (adopt), or a store
        # written before fingerprinting existed (i.e. by all-MiniLM-L6-v2,
        # the only model this project ever shipped) — warn on that one.
        has_vectors = directory.exists() and any(
            child.is_dir() for child in directory.iterdir()
        )
        if not has_vectors:
            write_store_fingerprint(directory, model_name)
            return True
        logger.warning(
            "Chroma store at %s has no embedding fingerprint. If it was "
            "written before the multilingual-e5-small swap, its vectors are "
            "all-MiniLM-L6-v2 and will not match %s — both are 384-dim, so "
            "nothing will error, retrieval will just be wrong. Re-embed with "
            "`python scripts/reembed_memory.py` or pin the old model via the "
            "`embedding_model` setting.",
            directory,
            model_name,
        )
        write_store_fingerprint(directory, model_name)
        return False

    logger.error(
        "Embedding model mismatch: Chroma store at %s was written with %r but "
        "the configured model is %r. Both emit 384 dimensions, so Chroma will "
        "NOT reject the mismatch — queries will silently return poor matches. "
        "Run `python scripts/reembed_memory.py` to rebuild the vectors, or set "
        "the `embedding_model` setting back to %r.",
        directory,
        recorded,
        model_name,
        recorded,
    )
    return False
