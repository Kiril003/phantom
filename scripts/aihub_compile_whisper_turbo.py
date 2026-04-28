#!/usr/bin/env python3
"""
Submit a Whisper-Large-V3-Turbo compile job to Qualcomm AI Hub, targeting
the Dragonwing RB3 Gen 2 Vision Kit (Hexagon V68 / QCS6490) — same SoC as
the Radxa Dragon Q6A. Output: pre-compiled QNN context binary that bypasses
the local QNN runtime entirely (which fails CreateDevice on this image).

Usage:
    src/backend/.venv/bin/python scripts/aihub_compile_whisper_turbo.py \
        [--target-bundle src/backend/voice/models/whisper-small-qnn] \
        [--precision w8a16|float] [--components WhisperEncoder] \
        [--no-profile]

Auth:
    Token is read from ~/.qai_hub/client.ini (set via `qai-hub configure
    --api_token=...`). This script never accepts the token on the
    command line so it doesn't leak into shell history / process tables.

Output:
    A directory `export_assets/` with the compiled .bin per component.
    The encoder .bin is copied into ``<target-bundle>/encoder_int8.bin``
    so ``WhisperNPUProvider`` picks it up via ``ep.context_file_path``.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import types
from pathlib import Path

# Stub sounddevice — qai_hub_models.app imports it for an interactive
# recorder; we only need the compile path.
_sd = types.ModuleType("sounddevice")
_sd.rec = _sd.wait = _sd.stop = _sd.play = lambda *a, **k: None
class _Stream:
    def __init__(self, *a, **k): ...
    def start(self): ...
    def stop(self): ...
    def close(self): ...
_sd.InputStream = _sd.OutputStream = _Stream  # type: ignore[attr-defined]
sys.modules["sounddevice"] = _sd


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--target-bundle",
        type=Path,
        default=Path("src/backend/voice/models/whisper-small-qnn"),
        help="Bundle dir to drop the compiled encoder .bin into",
    )
    p.add_argument(
        "--device",
        default="Dragonwing RB3 Gen 2 Vision Kit",
        help="AI Hub device name (default matches QCS6490 / V68)",
    )
    p.add_argument(
        "--device-os",
        default="1.6",
        help="Device OS version filter for the chosen device",
    )
    p.add_argument(
        "--precision",
        choices=["w8a16", "w8a8", "float"],
        default="w8a16",
        help="Quantisation. w8a16 is the standard QNN HTP recipe.",
    )
    p.add_argument(
        "--no-profile",
        action="store_true",
        help="Skip on-device profile / inference jobs (faster turnaround).",
    )
    p.add_argument(
        "--output-dir",
        default="aihub_assets",
        help="Where qai-hub-models drops compiled .bin and logs.",
    )
    args = p.parse_args()

    import qai_hub as hub
    from qai_hub_models import Precision, TargetRuntime
    from qai_hub_models.models.whisper_large_v3_turbo import export

    # Resolve device — match by name + OS so the right hexagon arch is used.
    device = hub.Device(name=args.device, os=args.device_os)
    print(f"== Target device: {device.name} (os={args.device_os}) ==")

    precision = {
        "w8a16": Precision.w8a16,
        "w8a8": Precision.w8a8,
        "float": Precision.float,
    }[args.precision]
    print(f"== Precision: {args.precision} ==")
    print("== Target runtime: QNN context binary ==")
    print("Submitting compile job(s)... (turnaround ~10-30 min)")

    result = export.export_model(
        device=device,
        precision=precision,
        target_runtime=TargetRuntime.QNN_CONTEXT_BINARY,
        skip_compiling=False,
        skip_profiling=args.no_profile,
        skip_inferencing=args.no_profile,
        skip_downloading=False,
        skip_summary=False,
        output_dir=args.output_dir,
    )

    out_dir = Path(args.output_dir)
    print("\n== Compile finished ==")
    print(f"Assets: {out_dir.resolve()}")

    # The export drops one .bin per sub-component (encoder, decoder, ...).
    # We want only the encoder for our hybrid path (decoder stays CPU on
    # Optimum). Look for the encoder file specifically.
    bins = sorted(out_dir.glob("**/*.bin"))
    if not bins:
        print("WARN: no .bin files appeared in output_dir")
        return 1

    print("Compiled artefacts:")
    for b in bins:
        print(f"  {b.relative_to(out_dir)}  ({b.stat().st_size / 1e6:.1f} MB)")

    # Heuristic: pick the encoder. Filenames vary by qai-hub-models version
    # — try common patterns.
    encoder_candidates = [b for b in bins if "encoder" in b.name.lower()]
    if not encoder_candidates:
        encoder_candidates = bins  # pick the first if we can't identify
    enc = encoder_candidates[0]

    target = args.target_bundle.resolve() / "encoder_int8.bin"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(enc, target)
    print(f"\n→ Copied {enc.name} → {target}  ({target.stat().st_size / 1e6:.1f} MB)")
    print(
        "Restart backend (or PUT /api/v1/settings/voice_stt_npu_enabled with "
        "the same value to force reset_providers) and the encoder session "
        "will load this binary via ep.context_file_path."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
