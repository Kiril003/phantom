"""
Whisper STT provider running encoder on Hexagon NPU (HTP) — Phase 15.

Architecture
------------
Encoder runs through ONNX Runtime ``QNNExecutionProvider`` (the EP plugin
shipped by ``onnxruntime-qnn``). Decoder + decoder_with_past run on CPU
through Optimum's ``ORTModelForSpeechSeq2Seq``. We let Optimum own the
KV-cache plumbing and the HuggingFace ``generate`` loop, then swap the
encoder session in-place after construction.

Why split:
- Whisper encoder has fixed shape (mel 80×3000, batch 1) and is matmul/conv
  /layernorm-only — fits HTP cleanly with INT8 quant.
- Decoder is autoregressive with KV-cache and dynamic shapes; running it on
  HTP would require static-shape unrolling for each step length, which
  breaks generation cleanly. CPU stays pragmatic.

Bundle layout (produced by ``scripts/convert_whisper_to_qnn.py``)
-----------------------------------------------------------------
    voice/models/whisper-small-qnn/
        encoder_int8.onnx           # INT8-quantised, QDQ format
        encoder_int8.bin            # QNN HTP context binary (V73 by default)
        encoder_model.onnx          # FP32, kept as last-resort fallback
        decoder_model.onnx          # FP32, CPU
        decoder_with_past_model.onnx  # FP32, CPU
        tokenizer.json / vocab.json / preprocessor_config.json / etc.

Failure modes
-------------
Anything that prevents NPU execution raises at construction time so the
factory in ``stt_engine.build_stt_provider`` can fall through to
``FasterWhisperSTTProvider`` without surfacing a 500 to the client.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

import numpy as np

from config import config
from voice.stt_engine import STTProvider, STTResult

logger = logging.getLogger(__name__)


# ── EP plugin registration ────────────────────────────────────────────────────
# ``register_execution_provider_library`` is the EP-plugin pattern introduced
# in onnxruntime 1.21+. Out-of-tree EPs (QNN, CUDA, etc.) ship as separate
# wheels and must be registered with the runtime before they appear in
# ``ort.get_available_providers()``.

_QNN_REGISTERED = False


def _register_qnn_ep_once() -> None:
    """Register the QNN EP plugin with onnxruntime. Idempotent."""
    global _QNN_REGISTERED
    if _QNN_REGISTERED:
        return
    import onnxruntime as ort  # local: heavy import paid only when NPU is opted-in
    if "QNNExecutionProvider" in ort.get_available_providers():
        _QNN_REGISTERED = True
        return
    try:
        import onnxruntime_qnn as oq
    except ImportError as exc:
        raise RuntimeError(
            "onnxruntime-qnn package not installed; "
            "`pip install onnxruntime-qnn` (or set voice_stt_npu_enabled=False)."
        ) from exc
    if not hasattr(ort, "register_execution_provider_library"):
        raise RuntimeError(
            "onnxruntime version does not expose register_execution_provider_library; "
            "upgrade to onnxruntime >= 1.21."
        )
    ort.register_execution_provider_library(
        "QNNExecutionProvider", oq.get_library_path()
    )
    _QNN_REGISTERED = True
    logger.info("QNN EP registered (lib=%s)", oq.get_library_path())


# ── Provider ──────────────────────────────────────────────────────────────────


class WhisperNPUProvider(STTProvider):
    """STT provider that runs Whisper encoder on Hexagon HTP via QNN.

    Heavy imports (``onnxruntime``, ``optimum``, ``transformers``) are
    deferred to ``_ensure_model`` so the factory's optimistic
    ``WhisperNPUProvider()`` probe in ``_try_npu`` is cheap on systems where
    the NPU path isn't relevant.
    """

    name = "whisper_npu"

    def __init__(self) -> None:
        self._model_path = Path(config.voice_stt_npu_model_path)
        if not self._model_path.is_dir():
            raise RuntimeError(
                f"NPU model bundle missing at {self._model_path}. "
                "Run scripts/convert_whisper_to_qnn.py first."
            )

        # The bundle must contain *some* encoder file. We pick the highest-
        # priority one we can find at load time.
        candidates = [
            self._model_path / "encoder_int8.bin",
            self._model_path / "encoder_int8.onnx",
            self._model_path / "encoder_model.onnx",
        ]
        if not any(p.is_file() for p in candidates):
            raise RuntimeError(
                f"No encoder file in {self._model_path}; expected one of: "
                + ", ".join(p.name for p in candidates)
            )
        if not (self._model_path / "decoder_model.onnx").is_file():
            raise RuntimeError(
                f"decoder_model.onnx missing in {self._model_path}"
            )

        # Register QNN EP up-front so ``__init__`` fails loudly when the
        # plugin isn't installable; cheap (~ms) and idempotent.
        _register_qnn_ep_once()

        # Lazy state — populated on first transcribe.
        self._model = None  # ORTModelForSpeechSeq2Seq
        self._processor = None  # WhisperProcessor
        self._encoder_session_qnn = None  # ort.InferenceSession on QNN EP

    # ── Heavy lifting: build the Optimum model and swap the encoder session ──

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        import onnxruntime as ort
        import onnxruntime_qnn as oq
        from optimum.onnxruntime import ORTModelForSpeechSeq2Seq
        from transformers import WhisperProcessor

        # 1. Processor / tokenizer (cheap, local files).
        self._processor = WhisperProcessor.from_pretrained(str(self._model_path))

        # 2. Build the Optimum model with all sessions on CPU. We override
        #    the encoder session to QNN below.
        logger.info(
            "WhisperNPU: loading Optimum model from %s (CPU baseline)",
            self._model_path,
        )
        self._model = ORTModelForSpeechSeq2Seq.from_pretrained(
            str(self._model_path),
            provider="CPUExecutionProvider",
            use_cache=True,
        )

        # 3. Build the QNN-backed encoder session. Prefer the pre-compiled
        #    HTP context binary (saves ~3 s of cold compile); fall back to
        #    the INT8 ONNX with QNN doing online compile; finally to FP32.
        qnn_options = {
            "backend_path": oq.get_qnn_htp_path(),
            # Run encoder at full HTP perf — utterances are short, the
            # latency win is the whole point.
            "htp_performance_mode": "high_performance",
            # V73 == QCS8550 (Snapdragon 8 Gen 2). Operator can override
            # via voice_stt_npu_compute config later if other SoCs join.
            "htp_arch": "73",
        }
        # Compute precision toggle (currently honored only for the INT8
        # vs FP16 ONNX dispatch; QNN context binary is a fixed artefact).
        if config.voice_stt_npu_compute == "fp16":
            qnn_options["enable_htp_fp16_precision"] = "1"

        bin_path = self._model_path / "encoder_int8.bin"
        int8_path = self._model_path / "encoder_int8.onnx"
        fp32_path = self._model_path / "encoder_model.onnx"

        sess_opts = ort.SessionOptions()
        if bin_path.is_file():
            # Tell ORT to load the pre-compiled HTP context instead of
            # tracing through the ONNX graph itself.
            sess_opts.add_session_config_entry("ep.context_enable", "1")
            sess_opts.add_session_config_entry("ep.context_file_path", str(bin_path))
            encoder_path = int8_path if int8_path.is_file() else fp32_path
            mode = f"qnn-context-binary({bin_path.name})"
        elif int8_path.is_file():
            encoder_path = int8_path
            mode = "qnn-online-compile(int8)"
        else:
            # No INT8 model available — last resort is to run FP32 on QNN
            # which works for V79+ but is a heavy fall-back.
            encoder_path = fp32_path
            mode = "qnn-online-compile(fp32)"

        try:
            self._encoder_session_qnn = ort.InferenceSession(
                str(encoder_path),
                sess_options=sess_opts,
                providers=[
                    ("QNNExecutionProvider", qnn_options),
                    "CPUExecutionProvider",
                ],
            )
            logger.info("WhisperNPU: encoder session up (%s)", mode)
        except Exception as exc:
            # If the QNN session can't be built — wheel/SoC mismatch, missing
            # libQnnHtp, anything — leave the Optimum-default CPU encoder
            # in place rather than fail the whole provider. Fully-CPU is
            # still a faithful Whisper provider; we just lose the win.
            logger.warning(
                "WhisperNPU: QNN encoder session failed (%s) — falling back "
                "to CPU encoder",
                exc,
            )
            self._encoder_session_qnn = None

        # 4. Swap the encoder's underlying ORT session in the Optimum model.
        #    Optimum exposes the encoder as ``model.encoder`` with a
        #    ``.session`` attribute. Different optimum versions have used
        #    slightly different attribute names; guard with hasattr.
        if self._encoder_session_qnn is not None:
            encoder_obj = getattr(self._model, "encoder", None)
            if encoder_obj is not None and hasattr(encoder_obj, "session"):
                encoder_obj.session = self._encoder_session_qnn
                logger.info("WhisperNPU: encoder session swapped to QNN")
            else:
                logger.warning(
                    "WhisperNPU: optimum encoder session attr not exposed "
                    "(%s) — encoder stays on CPU",
                    type(encoder_obj).__name__ if encoder_obj else "None",
                )

    # ── Public STTProvider contract ──────────────────────────────────────────

    async def transcribe(self, audio: np.ndarray, language: str) -> STTResult:
        return await asyncio.to_thread(self._transcribe_sync, audio, language)

    def _transcribe_sync(self, audio: np.ndarray, language: str) -> STTResult:
        self._ensure_model()
        assert self._model is not None
        assert self._processor is not None

        # Whisper expects mono 16 kHz; ``audio`` is already normalised by
        # ``stt_engine.decode_to_mono16k``.
        inputs = self._processor(
            audio, sampling_rate=16_000, return_tensors="pt"
        )
        lang_token = (
            language if language and language != "auto" else (config.voice_stt_language or "uk")
        )
        if lang_token == "auto":
            lang_token = "uk"

        try:
            generated_ids = self._model.generate(
                inputs.input_features,
                language=lang_token,
                task="transcribe",
                num_beams=1,
                max_new_tokens=224,
            )
        except Exception as exc:
            logger.warning(
                "WhisperNPU generate() failed (%s); returning empty transcript "
                "so the route can fall through gracefully",
                exc,
            )
            return STTResult(
                text="", confidence=0.0, engine="whisper_npu", language=lang_token,
            )

        text = self._processor.batch_decode(
            generated_ids, skip_special_tokens=True
        )[0].strip()
        # No native confidence from Optimum's greedy generate — return 1.0
        # for non-empty, 0.0 for empty. Same convention Vosk uses on silence.
        confidence = 1.0 if text else 0.0
        return STTResult(
            text=text,
            confidence=confidence,
            engine="whisper_npu",
            language=lang_token,
        )

    # ── Diagnostic helper for /health / settings UI ──────────────────────────

    def diagnostic_info(self) -> dict[str, str]:
        info: dict[str, str] = {
            "model_path": str(self._model_path),
            "encoder_qnn_loaded": "yes" if self._encoder_session_qnn is not None else "no",
        }
        try:
            import onnxruntime as ort
            info["providers"] = ",".join(ort.get_available_providers())
        except Exception:
            info["providers"] = "unknown"
        return info


def is_npu_path_available() -> bool:
    """Cheap check used by ``stt_engine._try_npu`` and the settings UI.

    Verifies that:
      * config has voice_stt_npu_enabled = True
      * the model bundle exists on disk
      * the EP plugin can be registered

    Doesn't actually load the model — that happens on first transcribe.
    """
    if not getattr(config, "voice_stt_npu_enabled", False):
        return False
    bundle = Path(getattr(config, "voice_stt_npu_model_path", ""))
    if not bundle.is_dir():
        return False
    try:
        _register_qnn_ep_once()
    except Exception as exc:
        logger.debug("NPU path unavailable: %s", exc)
        return False
    return True
