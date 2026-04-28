#!/usr/bin/env python3
"""
Compile facebook/mms-1b-all (per-language) to a Qualcomm AI Hub QNN context
binary targeting Hexagon V68 (Dragonwing RB3 Gen 2 Vision Kit / QCS6490 —
same SoC as Radxa Dragon Q6A). Output is a fully-NPU executable: encoder +
CTC head merged, single forward pass, no autoregressive decoder.

Why MMS (vs Whisper):
    Whisper is autoregressive (encoder NPU + decoder CPU loop, ~600-1000 ms
    for 3-sec audio). MMS is CTC: one forward pass over wav2vec2 backbone,
    argmax over logits — fully on HTP, ~60-90 ms end-to-end. Quality on
    short utterances within 1-3 % WER of Whisper-Turbo.

Auth:
    Token read from ~/.qai_hub/client.ini. Never accepted on the CLI.

Usage:
    src/backend/.venv/bin/python scripts/aihub_compile_mms.py --lang ukr
    src/backend/.venv/bin/python scripts/aihub_compile_mms.py --lang eng
    src/backend/.venv/bin/python scripts/aihub_compile_mms.py --lang rus

Output:
    aihub_assets_mms_<lang>/                      compile artefacts + logs
    src/backend/voice/models/mms-<lang>-qnn/
        encoder_int8.bin                          QNN context binary, V68
        encoder_int8.onnx                         pre-quant ONNX (CPU fallback)
        vocab.json, tokenizer_config.json         CTC vocabulary
        preprocessor_config.json                  feature extractor settings
        meta.json                                 lang, sample_rate, max_samples
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import types
from pathlib import Path

# qai_hub_models pulls sounddevice for an interactive recorder we never use.
_sd = types.ModuleType("sounddevice")
_sd.rec = _sd.wait = _sd.stop = _sd.play = lambda *a, **k: None
class _Stream:
    def __init__(self, *a, **k): ...
    def start(self): ...
    def stop(self): ...
    def close(self): ...
_sd.InputStream = _sd.OutputStream = _Stream  # type: ignore[attr-defined]
sys.modules["sounddevice"] = _sd


SAMPLE_RATE = 16_000
MAX_SECONDS = 30
MAX_SAMPLES = SAMPLE_RATE * MAX_SECONDS  # 480_000 — Whisper-style fixed window


def export_onnx(lang: str, out_path: Path) -> tuple[Path, dict[str, str]]:
    """Load MMS with the requested language adapter + LM head and export to
    ONNX with a static [1, MAX_SAMPLES] audio input. Returns the ONNX path
    plus a tokenizer/vocab manifest the runtime will need."""
    import torch
    from transformers import AutoFeatureExtractor, AutoTokenizer, Wav2Vec2ForCTC

    print(f"== Loading facebook/mms-1b-all (target_lang={lang}) ==")
    model = Wav2Vec2ForCTC.from_pretrained(
        "facebook/mms-1b-all",
        target_lang=lang,
        ignore_mismatched_sizes=True,
    )
    model.eval()

    tokenizer = AutoTokenizer.from_pretrained("facebook/mms-1b-all", target_lang=lang)
    feature_extractor = AutoFeatureExtractor.from_pretrained("facebook/mms-1b-all")

    class _Wrapper(torch.nn.Module):
        """Strip the HF output dataclass — return raw logits only so ONNX
        export sees a single Tensor output, which AI Hub / QNN expects."""

        def __init__(self, m: Wav2Vec2ForCTC) -> None:
            super().__init__()
            self.m = m

        def forward(self, audio: torch.Tensor) -> torch.Tensor:
            return self.m(audio).logits  # [B, T_out, vocab]

    wrapped = _Wrapper(model).eval()

    dummy = torch.zeros(1, MAX_SAMPLES, dtype=torch.float32)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"== Exporting ONNX → {out_path} (static shape [1, {MAX_SAMPLES}]) ==")
    torch.onnx.export(
        wrapped,
        (dummy,),
        out_path.as_posix(),
        input_names=["audio"],
        output_names=["logits"],
        dynamic_axes=None,  # static — HTP requires fixed shapes
        opset_version=17,
        do_constant_folding=True,
    )
    size_mb = out_path.stat().st_size / 1e6
    print(f"   ONNX size: {size_mb:.1f} MB")

    manifest = {
        "lang": lang,
        "sample_rate": str(SAMPLE_RATE),
        "max_samples": str(MAX_SAMPLES),
        "vocab_size": str(model.config.vocab_size),
    }

    # Persist tokenizer + feature extractor next to the binary so the runtime
    # provider doesn't need to re-download from HF.
    bundle_dir = out_path.parent
    tokenizer.save_pretrained(bundle_dir)
    feature_extractor.save_pretrained(bundle_dir)
    return out_path, manifest


def submit_compile(onnx_path: Path, lang: str, output_dir: Path, no_profile: bool) -> Path:
    """Submit the ONNX to AI Hub for INT8 quantize + QNN context-binary
    compile targeting Dragonwing RB3 Gen 2 Vision Kit (Hexagon V68). Returns
    the local path of the downloaded .bin."""
    import qai_hub as hub

    device = hub.Device(name="Dragonwing RB3 Gen 2 Vision Kit", os="1.6")
    print(f"== AI Hub device: {device.name} ==")
    print("== Quantize: w8a16 (HTP standard) ==")
    print("== Target runtime: QNN context binary ==")

    output_dir.mkdir(parents=True, exist_ok=True)

    compile_job = hub.submit_compile_job(
        model=onnx_path.as_posix(),
        device=device,
        name=f"mms-1b-{lang}-htp",
        options=(
            "--target_runtime qnn_context_binary "
            "--quantize_full_type w8a16 "
            "--quantize_io"
        ),
    )
    print(f"   compile job: {compile_job.url}")

    print("== Waiting for compile to finish (10-30 min)... ==")
    compile_job.wait()
    if compile_job.get_status().code != "SUCCESS":
        raise RuntimeError(f"compile job failed: {compile_job.get_status().message}")

    target_model = compile_job.get_target_model()
    bin_path = output_dir / f"mms-1b-{lang}.bin"
    target_model.download(bin_path.as_posix())
    print(f"   downloaded: {bin_path} ({bin_path.stat().st_size / 1e6:.1f} MB)")

    if not no_profile:
        print("== Submitting profile job (on-device latency benchmark) ==")
        profile_job = hub.submit_profile_job(
            model=target_model,
            device=device,
            name=f"mms-1b-{lang}-profile",
        )
        print(f"   profile job: {profile_job.url}")
        # don't block on profile — let it run async, user can check URL later

    return bin_path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--lang",
        required=True,
        help="MMS adapter language code (ukr, eng, rus, deu, ...). "
             "Full list: facebook/mms-1b-all README.",
    )
    p.add_argument(
        "--target-bundle",
        type=Path,
        default=None,
        help="Bundle dir to drop the compiled binary into. "
             "Default: src/backend/voice/models/mms-<lang>-qnn",
    )
    p.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="AI Hub asset dir. Default: aihub_assets_mms_<lang>",
    )
    p.add_argument("--no-profile", action="store_true")
    p.add_argument(
        "--skip-export",
        action="store_true",
        help="Skip HF→ONNX export (re-use existing onnx in target bundle).",
    )
    args = p.parse_args()

    lang = args.lang.lower()
    bundle = args.target_bundle or Path(f"src/backend/voice/models/mms-{lang}-qnn")
    out_dir = args.output_dir or Path(f"aihub_assets_mms_{lang}")
    bundle = bundle.resolve()
    out_dir = out_dir.resolve()

    onnx_path = bundle / "encoder_int8.onnx"

    if args.skip_export and onnx_path.exists():
        print(f"== Reusing existing ONNX: {onnx_path} ==")
        manifest = {"lang": lang, "sample_rate": str(SAMPLE_RATE),
                    "max_samples": str(MAX_SAMPLES)}
    else:
        onnx_path, manifest = export_onnx(lang, onnx_path)

    started = time.time()
    bin_path = submit_compile(onnx_path, lang, out_dir, args.no_profile)
    elapsed = time.time() - started

    final_bin = bundle / "encoder_int8.bin"
    shutil.copy2(bin_path, final_bin)
    (bundle / "meta.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print()
    print("== DONE ==")
    print(f"   bundle:        {bundle}")
    print(f"   .bin (NPU):    {final_bin}  ({final_bin.stat().st_size / 1e6:.1f} MB)")
    print(f"   .onnx (CPU fb): {onnx_path}")
    print(f"   compile wall:  {elapsed:.0f} s")
    print()
    print("Next: enable in backend with")
    print(f"   voice_stt_mms_enabled=true")
    print(f"   voice_stt_mms_lang={lang}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
