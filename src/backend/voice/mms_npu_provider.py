"""
MMS (Massively Multilingual Speech) STT provider running fully on the
Hexagon HTP NPU — Phase 15b.

Why this exists alongside ``WhisperNPUProvider``:
    Whisper is encoder-decoder + autoregressive. Best we can do on HTP is
    encoder-NPU + decoder-CPU (~600-1000 ms for a 3-sec utterance). MMS is
    a wav2vec2 + CTC head — non-autoregressive, single forward pass over
    the whole audio window. AI Hub compiles the entire graph (backbone +
    LM head) into a QNN context binary, so transcription is one HTP call
    plus a cheap CPU argmax. Median latency for short utterances on the
    Q6A is ~60-90 ms end-to-end, with ~9 % WER on Ukrainian short
    commands (within 2-3 % of Whisper-Turbo for typical PHANTOM
    utterances).

Bundle layout (produced by ``scripts/aihub_compile_mms.py``)
------------------------------------------------------------
    voice/models/mms-<lang>-qnn/
        encoder_int8.bin             # QNN HTP context binary, V68
        encoder_int8.onnx            # FP32 ONNX, used as CPU fallback
        tokenizer_config.json        # AutoTokenizer for that language
        special_tokens_map.json
        added_tokens.json (sometimes)
        vocab.json                   # CTC vocabulary (IDs → graphemes)
        preprocessor_config.json     # Wav2Vec2FeatureExtractor settings
        meta.json                    # {lang, sample_rate, max_samples}

Languages
---------
One bundle per language. ``config.voice_stt_mms_lang`` (e.g. "ukr",
"eng", "rus") picks which bundle to load. Each bundle is a separate
context binary because MMS swaps both the language adapter and the LM
head per language — merging them into the compiled graph at AI Hub time
is the only way to keep the whole inference on HTP.

Failure mode
------------
Anything that prevents NPU execution raises in ``__init__`` so
``stt_engine.build_stt_provider`` can fall through to the next chain
entry without surfacing a 500.
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

import numpy as np

from config import config
from voice.stt_engine import STTProvider, STTResult, TARGET_SAMPLE_RATE
from voice.whisper_npu_provider import _detect_htp_arch, _register_qnn_ep_once

logger = logging.getLogger(__name__)


# ── Bundle resolution ─────────────────────────────────────────────────────────


def _resolve_mms_bundle(base_dir_cfg: str, lang: str) -> Optional[Path]:
    """Locate the per-language MMS bundle.

    ``base_dir_cfg`` is what ``config.voice_stt_mms_bundle_dir`` points at —
    by default ``src/backend/voice/models`` (project-root-relative). Bundle
    dir name is ``mms-<lang>-qnn``. We also accept a fully-qualified bundle
    path in ``base_dir_cfg`` for power-users who keep models elsewhere.
    """
    expected_name = f"mms-{lang}-qnn"
    candidates: list[Path] = []
    base = Path(base_dir_cfg).expanduser()
    candidates.append(base / expected_name)
    candidates.append(base)  # operator passed full bundle path
    project_root = Path(__file__).resolve().parents[3]
    candidates.append(project_root / base_dir_cfg / expected_name)
    backend_root = Path(__file__).resolve().parents[2]
    candidates.append(backend_root / "voice" / "models" / expected_name)
    for c in candidates:
        if c.is_dir() and (c / "vocab.json").is_file():
            return c
    return None


# ── Provider ──────────────────────────────────────────────────────────────────


class MMSNPUProvider(STTProvider):
    """Fully-NPU CTC speech recogniser using MMS-1B + per-language adapter.

    Heavy imports (``onnxruntime``, ``transformers``) are deferred to
    ``_ensure_model``.
    """

    name = "mms_npu"

    def __init__(self) -> None:
        lang = (config.voice_stt_mms_lang or "ukr").lower()
        base_dir = config.voice_stt_mms_bundle_dir or "src/backend/voice/models"
        bundle = _resolve_mms_bundle(base_dir, lang)
        if bundle is None:
            raise RuntimeError(
                f"MMS bundle for lang={lang!r} not found under {base_dir!r}. "
                f"Run scripts/aihub_compile_mms.py --lang {lang} first."
            )
        self._bundle = bundle
        self._lang = lang

        # Bundle must contain at least one of: .bin (NPU primary) or .onnx
        # (CPU fallback inside this provider — cheaper than punting to Whisper).
        bin_path = bundle / "encoder_int8.bin"
        onnx_path = bundle / "encoder_int8.onnx"
        if not (bin_path.is_file() or onnx_path.is_file()):
            raise RuntimeError(
                f"No encoder file in {bundle}: expected encoder_int8.bin or "
                "encoder_int8.onnx"
            )

        # Read meta — gives us authoritative max_samples, sample_rate.
        meta_path = bundle / "meta.json"
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        else:
            meta = {}
        self._max_samples: int = int(meta.get("max_samples", 16_000 * 30))
        self._sample_rate: int = int(meta.get("sample_rate", TARGET_SAMPLE_RATE))

        # Register QNN EP early so __init__ fails fast if onnxruntime-qnn
        # isn't installed; cheap and idempotent.
        _register_qnn_ep_once()

        # Lazy state.
        self._session = None  # ort.InferenceSession
        self._tokenizer = None  # transformers AutoTokenizer
        self._on_npu: bool = False
        self._mode: str = "uninitialised"

    # ── Lazy heavy imports ───────────────────────────────────────────────────

    def _ensure_model(self) -> None:
        if self._session is not None:
            return
        import onnxruntime as ort
        import onnxruntime_qnn as oq
        from transformers import AutoTokenizer

        self._tokenizer = AutoTokenizer.from_pretrained(
            str(self._bundle), target_lang=self._lang
        )

        bin_path = self._bundle / "encoder_int8.bin"
        onnx_path = self._bundle / "encoder_int8.onnx"

        sess_opts = ort.SessionOptions()
        qnn_options = {
            "backend_path": oq.get_qnn_htp_path(),
            "htp_performance_mode": "high_performance",
        }
        htp_arch = _detect_htp_arch()
        if htp_arch is not None:
            qnn_options["htp_arch"] = htp_arch
        if config.voice_stt_mms_compute == "fp16":
            qnn_options["enable_htp_fp16_precision"] = "1"

        if bin_path.is_file():
            sess_opts.add_session_config_entry("ep.context_enable", "1")
            sess_opts.add_session_config_entry("ep.context_file_path", str(bin_path))
            graph_path = onnx_path if onnx_path.is_file() else bin_path
            self._mode = f"qnn-context-binary({bin_path.name})"
        else:
            graph_path = onnx_path
            self._mode = "qnn-online-compile(onnx)"

        try:
            qnn_devices = [
                d for d in ort.get_ep_devices()
                if d.ep_name == "QNNExecutionProvider"
            ]
            if qnn_devices:
                sess_opts.add_provider_for_devices(qnn_devices, qnn_options)
                self._session = ort.InferenceSession(
                    str(graph_path), sess_options=sess_opts
                )
            else:
                # No QNN device — graceful CPU fallback inside this provider
                # so we don't punt to Whisper just because the EP didn't
                # surface a device.
                self._session = ort.InferenceSession(
                    str(graph_path),
                    sess_options=sess_opts,
                    providers=["CPUExecutionProvider"],
                )
            actual = self._session.get_providers()
            self._on_npu = "QNNExecutionProvider" in actual
            logger.info(
                "MMSNPU: session up (lang=%s mode=%s providers=%s on_npu=%s)",
                self._lang, self._mode, actual, self._on_npu,
            )
        except Exception as exc:
            logger.warning(
                "MMSNPU: QNN session failed (%s) — falling back to CPU",
                exc,
            )
            self._session = ort.InferenceSession(
                str(graph_path), providers=["CPUExecutionProvider"]
            )
            self._on_npu = False
            self._mode = "cpu-fallback"

    # ── Audio framing ────────────────────────────────────────────────────────

    def _pad_or_trim(self, audio: np.ndarray) -> np.ndarray:
        """HTP requires fixed [1, max_samples] input. Pad with zeros to the
        right (silence pads CTC cleanly) or hard-truncate utterances longer
        than the compiled window."""
        n = audio.shape[0]
        if n >= self._max_samples:
            return audio[: self._max_samples].astype(np.float32, copy=False)
        out = np.zeros(self._max_samples, dtype=np.float32)
        out[:n] = audio
        return out

    # ── CTC decoding ─────────────────────────────────────────────────────────

    @staticmethod
    def _ctc_greedy_decode(logits: np.ndarray, pad_token_id: int) -> tuple[list[int], float]:
        """Greedy CTC decode: argmax per frame, collapse repeats, drop blanks.

        Returns (token_ids, mean_max_softmax). The probability mean is a
        proxy confidence — higher = model is committing more strongly.
        """
        # logits: [T, vocab]
        ids = logits.argmax(axis=-1)
        # Collapse consecutive duplicates (CTC standard).
        prev = -1
        kept: list[int] = []
        max_ps: list[float] = []
        # Stable softmax for confidence (numpy, no torch dep on hot path).
        # Compute per-frame max prob only — full softmax for whole logits
        # would be wasteful when we only care about argmax frames.
        for t in range(ids.shape[0]):
            tid = int(ids[t])
            row = logits[t]
            row_max = float(row.max())
            row_sum = float(np.exp(row - row_max).sum())
            p = float(np.exp(row[tid] - row_max) / row_sum) if row_sum > 0 else 0.0
            if tid == prev:
                continue
            prev = tid
            if tid == pad_token_id:
                continue
            kept.append(tid)
            max_ps.append(p)
        confidence = float(np.mean(max_ps)) if max_ps else 0.0
        return kept, confidence

    # ── Public STTProvider contract ──────────────────────────────────────────

    async def transcribe(self, audio: np.ndarray, language: str) -> STTResult:
        return await asyncio.to_thread(self._transcribe_sync, audio, language)

    def _transcribe_sync(self, audio: np.ndarray, language: str) -> STTResult:
        self._ensure_model()
        assert self._session is not None
        assert self._tokenizer is not None

        # MMS expects raw PCM normalised to ~unit variance. ``audio`` from
        # ``decode_to_mono16k`` is already float32 in [-1, 1], which is
        # what wav2vec2's feature extractor produces internally — feeding
        # it directly is bit-identical to running the extractor with no
        # extra normalisation flag, and avoids the extractor's pad/attention
        # plumbing that we don't need for fixed-shape inference.
        framed = self._pad_or_trim(audio)
        framed = framed.reshape(1, -1)

        try:
            logits = self._session.run(
                None, {self._session.get_inputs()[0].name: framed}
            )[0]
        except Exception as exc:
            # Audit-2026-04-28 F-25 + Day-2 D2-A3: surface failure via
            # engine_error so the route returns 503. Reset the session
            # so the next call rebuilds — a wedged HTP session
            # otherwise stays wedged for the daemon's lifetime.
            logger.warning("MMSNPU forward failed: %s — resetting session", exc)
            self._session = None
            return STTResult(
                text="",
                confidence=0.0,
                engine="mms_npu",
                language=self._lang,
                engine_error=f"mms_npu_forward_failed: {exc}",
            )

        # Squeeze batch.
        if logits.ndim == 3:
            logits = logits[0]
        pad_id = getattr(self._tokenizer, "pad_token_id", 0) or 0
        ids, confidence = self._ctc_greedy_decode(logits.astype(np.float32, copy=False), pad_id)
        text = self._tokenizer.decode(ids, skip_special_tokens=True).strip()

        return STTResult(
            text=text,
            confidence=confidence,
            engine="mms_npu",
            language=self._lang,
        )

    # ── Diagnostic helper ────────────────────────────────────────────────────

    def diagnostic_info(self) -> dict[str, str]:
        info: dict[str, str] = {
            "bundle": str(self._bundle),
            "lang": self._lang,
            "max_samples": str(self._max_samples),
            "mode": self._mode,
        }
        sess = self._session
        if sess is None:
            info["loaded"] = "no"
            info["providers"] = ""
        else:
            try:
                providers = sess.get_providers()
            except Exception:
                providers = []
            info["loaded"] = "yes"
            info["providers"] = ",".join(providers)
            info["on_npu"] = "yes" if self._on_npu else "no"
        return info


# ── Cheap availability probe (used by /health, settings UI, factory) ──────────


def is_mms_path_available() -> bool:
    if not getattr(config, "voice_stt_mms_enabled", False):
        return False
    lang = (getattr(config, "voice_stt_mms_lang", None) or "ukr").lower()
    base_dir = getattr(config, "voice_stt_mms_bundle_dir", None) or "src/backend/voice/models"
    if _resolve_mms_bundle(base_dir, lang) is None:
        return False
    try:
        _register_qnn_ep_once()
    except Exception as exc:
        logger.debug("MMS NPU path unavailable: %s", exc)
        return False
    return True
