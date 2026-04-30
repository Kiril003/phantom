"""
PHANTOM OS — Nuitka onefile entrypoint.

Compiled by ``scripts/build/nuitka_build.py`` into a single executable.
``main.py`` remains the dev/test entrypoint; this module exists solely to
sequence multiprocessing-freeze, env defaults, and ``sys.path`` priming
**before** any backend module loads. Order matters here — moving any block
will break Nuitka onefile on Windows or the data-path resolver on Linux.

Layout next to the produced binary (created at first launch):

    phantom-os(.exe)
    models/        — downloaded by ``download-models.py`` or first run
    data/          — sqlite + chroma runtime data
    frontend/      — vite build (if shipped alongside)
"""
from __future__ import annotations

import multiprocessing as _mp
import os
import sys
from pathlib import Path


def _binary_dir() -> Path:
    # Nuitka onefile sets ``sys.argv[0]`` to the user-facing binary while
    # ``__file__`` points into the (temporary) extracted bundle. We want the
    # *outer* directory the user sees, so prefer ``sys.argv[0]`` and fall
    # back to ``sys.executable`` for safety on edge cases (symlinks, sudo).
    candidates = [Path(sys.argv[0]).resolve(), Path(sys.executable).resolve()]
    for cand in candidates:
        if cand.is_file():
            return cand.parent
    return Path.cwd()


def _bootstrap_env() -> Path:
    root = _binary_dir()
    data_dir = root / "data"
    models_dir = root / "models"
    frontend_dir = root / "frontend"
    data_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)

    # Env defaults — only set when operator hasn't overridden. Backend
    # modules read these via ``config.py`` / ``paths.py``.
    os.environ.setdefault("PHANTOM_DATA_DIR", str(data_dir))
    os.environ.setdefault("PHANTOM_MODELS_DIR", str(models_dir))
    os.environ.setdefault("PHANTOM_FRONTEND_DIST", str(frontend_dir))
    os.environ.setdefault(
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{(data_dir / 'phantom.db').as_posix()}",
    )
    os.environ.setdefault("CHROMA_PATH", str(data_dir / "chroma"))

    # Hugging Face / transformers caches — keep them inside our models dir
    # so the portable folder is fully self-contained.
    hf_cache = models_dir / "hf_cache"
    hf_cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(hf_cache))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(hf_cache))
    os.environ.setdefault("TRANSFORMERS_CACHE", str(hf_cache))
    os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(models_dir / "st_cache"))

    # Reproducible logs + safe defaults
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("OMP_NUM_THREADS", "4")
    os.environ.setdefault("MKL_NUM_THREADS", "4")
    return root


def main() -> None:
    # Nuitka onefile + multiprocessing on Windows: ``freeze_support`` MUST run
    # before the first import that may spawn workers (sentence-transformers,
    # faster-whisper, chromadb HNSW indexer all spawn). Failing this turns
    # the binary into a fork bomb on Windows.
    _mp.freeze_support()
    if sys.platform == "win32":
        try:
            _mp.set_start_method("spawn", force=True)
        except RuntimeError:
            pass  # already set by an earlier import

    _bootstrap_env()

    # Make backend package layout (api, core, ai, ...) importable as
    # top-level modules — matches the dev layout used in ``main.py``.
    backend_dir = Path(__file__).resolve().parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    # Lazy imports AFTER env bootstrap so config picks up our paths.
    import uvicorn

    from config import config

    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        reload=False,
        log_level=config.log_level.lower(),
        access_log=False,
        loop="auto",
        http="auto",
        workers=1,
    )


if __name__ == "__main__":
    main()
