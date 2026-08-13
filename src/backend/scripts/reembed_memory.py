#!/usr/bin/env python3
"""
Re-embed every Chroma collection with the currently configured model.

Needed because ``all-MiniLM-L6-v2`` and ``intfloat/multilingual-e5-small``
both emit 384 dimensions: Chroma accepts a model swap without complaint, and
the store keeps answering queries — just with vectors from a different
geometry than the query. Nothing errors; recall quietly rots. This script
rewrites the vectors so the store and the model agree again.

Documents and metadata are preserved verbatim; only the embeddings change.
Re-embedding is done in place, collection by collection, then the store
fingerprint is updated so ``assert_store_matches_model`` goes quiet.

    python scripts/reembed_memory.py --dry-run     # report, change nothing
    python scripts/reembed_memory.py               # rewrite the vectors

Runs on CPU. No GPU, no training — this is inference over stored text.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python scripts/reembed_memory.py` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import config  # noqa: E402
from memory.embedding_fn import (  # noqa: E402
    build_embedding_function,
    read_store_fingerprint,
    write_store_fingerprint,
)

BATCH = 128


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be re-embedded without writing",
    )
    args = parser.parse_args()

    import chromadb

    model_name = config.embedding_model
    recorded = read_store_fingerprint(config.chroma_path)
    print(f"store:      {config.chroma_path}")
    print(f"written by: {recorded or '(unrecorded — assume all-MiniLM-L6-v2)'}")
    print(f"target:     {model_name}")

    if recorded == model_name and not args.dry_run:
        print("Store already matches the configured model. Nothing to do.")
        return 0

    # Same opt-out as the runtime client — see memory.strategic_memory.
    from memory.strategic_memory import _chroma_settings

    client = chromadb.PersistentClient(
        path=config.chroma_path, settings=_chroma_settings(),
    )
    ef = build_embedding_function(model_name)

    total_docs = 0
    for descriptor in client.list_collections():
        name = descriptor.name if hasattr(descriptor, "name") else str(descriptor)
        collection = client.get_collection(name=name, embedding_function=ef)
        count = collection.count()
        total_docs += count
        print(f"  {name}: {count} document(s)")
        if args.dry_run or count == 0:
            continue

        offset = 0
        while offset < count:
            page = collection.get(
                limit=BATCH,
                offset=offset,
                include=["documents", "metadatas"],
            )
            ids = page.get("ids") or []
            if not ids:
                break
            documents = page.get("documents") or []
            metadatas = page.get("metadatas") or [None] * len(ids)
            # Passing documents without embeddings makes Chroma call the new
            # embedding function — that recompute is the whole point.
            collection.update(
                ids=ids,
                documents=documents,
                metadatas=metadatas,
            )
            offset += len(ids)
            print(f"    re-embedded {offset}/{count}", end="\r", flush=True)
        print(f"    re-embedded {count}/{count}      ")

    if args.dry_run:
        print(f"\nDry run: {total_docs} document(s) would be re-embedded.")
        return 0

    write_store_fingerprint(config.chroma_path, model_name)
    print(f"\nDone. {total_docs} document(s) now embedded with {model_name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
