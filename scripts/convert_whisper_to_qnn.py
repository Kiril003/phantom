#!/usr/bin/env python3
"""
Convert HuggingFace Whisper to ONNX → INT8 quant → QNN HTP context binary.

Phase 15. Output is a self-contained directory consumable by
``WhisperNPUProvider`` at runtime.

Pipeline
--------
1. ``optimum-cli export onnx`` — turn the HF checkpoint into the standard
   3-file ONNX layout (encoder, decoder, decoder_with_past).
2. ``onnxruntime.quantization.quantize_static`` — INT8-quantise the
   *encoder only*. Decoder stays FP32 because autoregressive KV-cache
   quantisation deteriorates Whisper output disproportionately.
3. ``qnn-context-binary-generator`` — pre-compile the INT8 encoder for the
   target HTP arch (V73 for QCS8550 / Snapdragon 8 Gen 2, default).

Usage
-----
    ./convert_whisper_to_qnn.py \\
        --src openai/whisper-small \\
        --out src/backend/voice/models/whisper-small-qnn \\
        --htp-arch 73 \\
        --calibration scripts/calibration/whisper_uk

A ready calibration set isn't required to *run* the script — if absent we
fall back to synthetic dummy inputs (Gaussian noise + silence). For
production runs with the best WER, point ``--calibration`` at a directory
of representative ``*.wav`` files (≥ 5 s each, mono 16 kHz preferred).

Exit codes
----------
0  success
1  prerequisite missing (binary, dependency)
2  conversion step failed
"""
from __future__ import annotations

import argparse
import logging
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable, List, Optional

logger = logging.getLogger("convert_whisper_to_qnn")
logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")

# Tools must be on PATH (libqnn-tools 2.43+ provides this binary).
QNN_CONTEXT_GEN = "qnn-context-binary-generator"
QNN_HTP_BACKEND_NAME = "libQnnHtp.so"   # resolved against onnxruntime_qnn install dir

# Filenames used inside the output directory.
ENCODER_FP32 = "encoder_model.onnx"
DECODER_FP32 = "decoder_model.onnx"
DECODER_PAST_FP32 = "decoder_with_past_model.onnx"
ENCODER_INT8 = "encoder_int8.onnx"
ENCODER_QNN_BIN = "encoder_int8.bin"


# ── Step 0: arg parsing ───────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--src",
        default="openai/whisper-small",
        help="HF model id or local path to a Whisper checkpoint (default: openai/whisper-small)",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path("src/backend/voice/models/whisper-small-qnn"),
        help="Output directory for the converted bundle",
    )
    p.add_argument(
        "--htp-arch",
        default="73",
        choices=["68", "69", "73", "75", "79", "81"],
        help="Hexagon HTP arch version (73=QCS8550/SM8550, default)",
    )
    p.add_argument(
        "--calibration",
        type=Path,
        default=None,
        help="Directory of *.wav files to use as quant calibration data",
    )
    p.add_argument(
        "--skip-quant",
        action="store_true",
        help="Skip INT8 quant step (encoder stays FP32; QNN context gen also skipped)",
    )
    p.add_argument(
        "--skip-qnn",
        action="store_true",
        help="Stop after INT8 quant; do not invoke qnn-context-binary-generator",
    )
    return p.parse_args()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _which_or_die(binary: str) -> str:
    path = shutil.which(binary)
    if path is None:
        logger.error("Required binary not on PATH: %s", binary)
        logger.error("Install via: sudo apt install qnn-tools (Ubuntu Radxa images)")
        sys.exit(1)
    return path


def _run(cmd: List[str], cwd: Optional[Path] = None) -> None:
    """Run subprocess, stream output, exit(2) on non-zero."""
    logger.info("$ %s", " ".join(str(c) for c in cmd))
    proc = subprocess.run(cmd, cwd=cwd, check=False)
    if proc.returncode != 0:
        logger.error("Command failed (rc=%s)", proc.returncode)
        sys.exit(2)


# ── Step 1: HF → ONNX ─────────────────────────────────────────────────────────


def export_hf_to_onnx(src: str, out_dir: Path) -> None:
    """``optimum-cli export onnx`` wrapper.

    The CLI writes encoder/decoder/decoder_with_past split out of the box for
    speech-to-text task type. We force ``--device cpu`` because we may run on
    a headless Radxa where torch.cuda is absent.
    """
    optimum_cli = _which_or_die("optimum-cli")
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        optimum_cli, "export", "onnx",
        "--model", src,
        "--task", "automatic-speech-recognition",
        "--device", "cpu",
        str(out_dir),
    ]
    _run(cmd)
    if not (out_dir / ENCODER_FP32).is_file():
        logger.error("Expected %s after export, not found", ENCODER_FP32)
        sys.exit(2)


# ── Step 2: INT8 quant (encoder only) ─────────────────────────────────────────


def _gather_calibration_wavs(calib_dir: Optional[Path]) -> List[Path]:
    if calib_dir is None or not calib_dir.is_dir():
        return []
    return sorted(calib_dir.glob("*.wav"))


def _make_dummy_calibration(n: int = 8) -> List["object"]:
    """Synthetic mel inputs when no real wavs are provided.

    Whisper expects ``input_features`` of shape (batch=1, mel=80, frames=3000).
    Mix Gaussian noise (≈ speech-like spectrum) and zeros (silence) so the
    quantiser sees both regimes.
    """
    import numpy as np
    inputs = []
    for i in range(n):
        if i % 2 == 0:
            arr = np.random.randn(1, 80, 3000).astype("float32") * 0.5
        else:
            arr = np.zeros((1, 80, 3000), dtype="float32")
        inputs.append(arr)
    return inputs


def _wav_to_mel(wav_path: Path, processor) -> "object":
    """Resample to 16k mono and run the Whisper feature extractor."""
    import numpy as np
    import soundfile as sf
    audio, sr = sf.read(str(wav_path), dtype="float32", always_2d=False)
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if sr != 16_000:
        # Cheap linear resample — fine for calibration (we only need
        # representative spectra, not high-fidelity audio).
        ratio = 16_000 / sr
        new_len = int(round(len(audio) * ratio))
        x_old = np.linspace(0, 1, num=len(audio), endpoint=False, dtype=np.float32)
        x_new = np.linspace(0, 1, num=new_len, endpoint=False, dtype=np.float32)
        audio = np.interp(x_new, x_old, audio).astype(np.float32)
    feats = processor(
        audio, sampling_rate=16_000, return_tensors="np"
    ).input_features
    return feats.astype("float32")


class _WhisperCalibrationReader:
    """Yields {input_features: ndarray} dicts to onnxruntime quantizer."""

    def __init__(self, src: str, calib_wavs: Iterable[Path]) -> None:
        from transformers import WhisperProcessor
        self._processor = WhisperProcessor.from_pretrained(src)
        self._wavs = list(calib_wavs)
        self._dummy = _make_dummy_calibration() if not self._wavs else []
        self._idx = 0

    def get_next(self):  # type: ignore[override]
        if self._idx < len(self._wavs):
            mel = _wav_to_mel(self._wavs[self._idx], self._processor)
            self._idx += 1
            return {"input_features": mel}
        synthetic_idx = self._idx - len(self._wavs)
        if synthetic_idx < len(self._dummy):
            self._idx += 1
            return {"input_features": self._dummy[synthetic_idx]}
        return None


def quantise_encoder(out_dir: Path, src: str, calib_dir: Optional[Path]) -> None:
    """Static-quantise encoder_model.onnx → encoder_int8.onnx."""
    from onnxruntime.quantization import quantize_static, QuantType, QuantFormat
    encoder_in = out_dir / ENCODER_FP32
    encoder_out = out_dir / ENCODER_INT8
    if not encoder_in.is_file():
        logger.error("Encoder ONNX missing: %s", encoder_in)
        sys.exit(2)
    wavs = _gather_calibration_wavs(calib_dir)
    logger.info("Calibration: %d real wavs + dummy padding", len(wavs))
    reader = _WhisperCalibrationReader(src, wavs)
    quantize_static(
        model_input=str(encoder_in),
        model_output=str(encoder_out),
        calibration_data_reader=reader,
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QUInt8,
        weight_type=QuantType.QInt8,
        per_channel=True,
        # QNN HTP wants channel-aligned weights; this op-set is the most
        # conservative-compatible.
        op_types_to_quantize=["MatMul", "Conv", "Gemm"],
    )
    if not encoder_out.is_file():
        logger.error("Quantisation produced no output")
        sys.exit(2)
    logger.info("INT8 encoder: %s (%.1f MB)", encoder_out, encoder_out.stat().st_size / 1e6)


# ── Step 3: ONNX INT8 → QNN context binary ────────────────────────────────────


def _resolve_qnn_htp_backend() -> Path:
    """Find libQnnHtp.so shipped with onnxruntime-qnn (preferred over /usr/lib
    so the EP and the backend match versions)."""
    try:
        import onnxruntime_qnn as oq
    except ImportError:
        logger.error("onnxruntime-qnn package not installed in this venv")
        sys.exit(1)
    htp = Path(oq.get_qnn_htp_path())
    if not htp.is_file():
        logger.error("libQnnHtp.so not found at %s", htp)
        sys.exit(1)
    return htp


def gen_qnn_context(out_dir: Path, htp_arch: str) -> None:
    """``qnn-context-binary-generator`` — pre-compile encoder for the target
    HTP arch. Output ``encoder_int8.bin`` is loaded directly by ORT QNN EP at
    runtime, skipping online compilation (saves ~3 s on cold start)."""
    qnn_bin = _which_or_die(QNN_CONTEXT_GEN)
    htp_backend = _resolve_qnn_htp_backend()
    encoder_int8 = out_dir / ENCODER_INT8
    if not encoder_int8.is_file():
        logger.error("INT8 encoder not found at %s — run quant step first", encoder_int8)
        sys.exit(2)

    with tempfile.TemporaryDirectory(prefix="qnn-ctx-") as tmp:
        tmp_path = Path(tmp)
        cmd = [
            qnn_bin,
            "--backend", str(htp_backend),
            "--model", str(encoder_int8),
            "--output_dir", str(tmp_path),
            "--binary_file", "encoder_int8",
            "--htp_arch", htp_arch,
        ]
        _run(cmd)
        produced = tmp_path / "encoder_int8.bin"
        if not produced.is_file():
            logger.error("qnn-context-binary-generator did not produce encoder_int8.bin")
            sys.exit(2)
        target = out_dir / ENCODER_QNN_BIN
        shutil.move(str(produced), target)
        logger.info(
            "QNN context binary: %s (%.1f MB) for HTP V%s",
            target, target.stat().st_size / 1e6, htp_arch,
        )


# ── Step 4: bundle tokenizer + preprocessor ───────────────────────────────────


def copy_tokenizer_assets(src: str, out_dir: Path) -> None:
    """Snapshot tokenizer + preprocessor next to the ONNX models so runtime
    doesn't need network access. ``optimum-cli export`` already copies these
    in most cases — this is the safety net for the few that miss
    preprocessor_config.json."""
    from transformers import WhisperProcessor
    processor = WhisperProcessor.from_pretrained(src)
    processor.save_pretrained(str(out_dir))


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> int:
    args = parse_args()
    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    logger.info("== Phase 15 Whisper→QNN conversion ==")
    logger.info("Source       : %s", args.src)
    logger.info("Output dir   : %s", out_dir.resolve())
    logger.info("HTP arch     : V%s", args.htp_arch)
    logger.info("Calibration  : %s", args.calibration or "(synthetic)")

    # Step 1: HF → ONNX (skip if encoder already there from a prior run)
    if not (out_dir / ENCODER_FP32).is_file():
        export_hf_to_onnx(args.src, out_dir)
    else:
        logger.info("[1/4] ONNX export skipped (encoder_model.onnx already present)")

    # Step 2: INT8 quant
    if args.skip_quant:
        logger.info("[2/4] INT8 quant skipped (--skip-quant)")
    else:
        quantise_encoder(out_dir, args.src, args.calibration)

    # Step 3: QNN context binary
    if args.skip_qnn or args.skip_quant:
        logger.info("[3/4] QNN context binary skipped")
    else:
        gen_qnn_context(out_dir, args.htp_arch)

    # Step 4: tokenizer + preprocessor snapshot
    copy_tokenizer_assets(args.src, out_dir)
    logger.info("[4/4] Tokenizer/preprocessor saved to %s", out_dir)

    logger.info("== Done. Bundle ready at %s ==", out_dir.resolve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
