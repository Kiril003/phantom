"""
Text-to-speech engine — PHANTOM OS voice pipeline.

Piper is the default Phase 07 provider — it has ARM64 wheels, ships with
bundled eSpeak-NG phonemisers (incl. Ukrainian), and consumes ~150 MB of
RAM for a medium-quality voice. StyleTTS2 is tracked in `UNIMPLEMENTED_KEYS`
for a later pass because it needs a ~2 GB checkpoint download and a
custom UA G2P.

All providers return a WAV `bytes` blob — the HTTP route serves it
as `audio/wav` without re-encoding.
"""
from __future__ import annotations

import asyncio
import importlib.util
import io
import logging
import os
import subprocess
import sys
import tempfile
import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from config import config

logger = logging.getLogger(__name__)


@dataclass
class TTSResult:
    audio_wav: bytes
    sample_rate: int
    engine: str
    voice: str

    def to_dict(self) -> dict:
        return {
            "engine": self.engine,
            "voice": self.voice,
            "sample_rate": self.sample_rate,
            "bytes": len(self.audio_wav),
        }


# ── Abstract provider ─────────────────────────────────────────────────────────


class TTSProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    async def synthesize(self, text: str, voice: str, speed: float) -> TTSResult:
        """Render `text` to a WAV byte string."""


# ── Silent provider (no TTS backend installed) ────────────────────────────────


def _silent_wav(sample_rate: int = 22_050, duration_ms: int = 100) -> bytes:
    """A tiny valid WAV so clients that expect audio/wav don't choke."""
    buf = io.BytesIO()
    frames = int(sample_rate * duration_ms / 1000)
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


class SilentTTSProvider(TTSProvider):
    """Returns ~100 ms of silence; used when voice_tts_enabled is False
    or when no backend engine is installed."""
    name = "silent"

    async def synthesize(self, text: str, voice: str, speed: float) -> TTSResult:
        return TTSResult(
            audio_wav=_silent_wav(),
            sample_rate=22_050,
            engine="silent",
            voice=voice,
        )


# ── Piper provider ────────────────────────────────────────────────────────────


def _resolve_piper_model(voice_name: str) -> Optional[Path]:
    """
    Locate a Piper `.onnx` voice model on disk. Piper distributes voices
    as individual .onnx + .onnx.json pairs; we accept either:
      - an absolute path to the .onnx file, or
      - a bare voice name like "uk_UA-ukrainian_tts-medium" searched under
        common install locations.
    """
    raw = (voice_name or "").strip()
    if not raw:
        return None
    if os.path.isabs(raw) and Path(raw).is_file():
        return Path(raw)
    # Normalise — Piper voices are named with a .onnx suffix in the registry.
    name = raw if raw.endswith(".onnx") else f"{raw}.onnx"
    candidates = [
        Path("/usr/share/piper-voices") / name,
        Path("/opt/piper-voices") / name,
        Path.home() / "piper-voices" / name,
        Path.cwd() / "piper_voices" / name,
        Path.cwd() / "voice_models" / name,
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def _find_any_piper_model() -> Optional[Path]:
    """Last-resort fallback: find any .onnx file in the standard search paths."""
    search_dirs = [
        Path("/usr/share/piper-voices"),
        Path("/opt/piper-voices"),
        Path.home() / "piper-voices",
        Path.cwd() / "piper_voices",
        Path.cwd() / "voice_models",
    ]
    for d in search_dirs:
        if not d.is_dir():
            continue
        for p in d.glob("*.onnx"):
            if p.is_file():
                return p
    return None


class PiperTTSProvider(TTSProvider):
    """
    Piper-TTS invoked as an external CLI subprocess — never imported
    in-process.

    LEGAL (master-plan P0): piper-tts (the `piper1-gpl` distribution on
    PyPI) is GPL-3.0-or-later. Loading it into this process via
    `import piper` would make this proprietary backend a derivative
    work subject to the GPL. Shelling out to `python -m piper` as a
    separate OS process is mere aggregation and carries no copyleft
    obligation. DO NOT add `import piper` / `from piper import ...`
    anywhere in this file (or elsewhere in the codebase) — the CLI via
    `subprocess` is the only permitted integration point.

    Known cost: every call spawns a fresh `python -m piper` process,
    so each synthesis pays full model load time (~0.5-2s) in addition
    to inference, since nothing is kept warm between calls. A
    persistent-subprocess pool (or a swap to a non-GPL engine such as
    Supertonic-3) is tracked as a later milestone; this provider trades
    some latency for license safety today.
    """
    name = "piper"

    def __init__(self) -> None:
        if importlib.util.find_spec("piper") is None:
            # Spec lookup only checks importability — it does not execute
            # or link the GPL package, so this stays subprocess-safe.
            raise RuntimeError("piper-tts is not installed (no 'piper' module found)")
        self._voice_path: Optional[Path] = None
        self._resolved_for: Optional[str] = None  # cache key: last requested voice name

    def _resolve_voice(self, requested: str) -> Path:
        """Resolve `requested` to an on-disk .onnx model path, with the
        same fallback chain as before. The resolved path is cached
        against the requested voice name so repeated calls for the same
        voice don't re-scan the filesystem."""
        if self._voice_path is not None and self._resolved_for == requested:
            return self._voice_path

        path = _resolve_piper_model(requested)
        if path is None and requested != config.voice_tts_voice:
            logger.warning("Voice %s not found, falling back to default %s", requested, config.voice_tts_voice)
            path = _resolve_piper_model(config.voice_tts_voice)

        if path is None:
            # Phase 13 — Extreme Resilience
            # If default is also missing, try English fallback, then Ukrainian fallback specifically
            fallbacks = [config.voice_tts_voice_en, config.voice_tts_voice_uk, "en_US-lessac-medium"]
            for f in fallbacks:
                path = _resolve_piper_model(f)
                if path:
                    logger.warning("Default voice missing, found fallback: %s", f)
                    break

        if path is None:
            logger.warning("All configured fallbacks missing, searching for any available Piper model...")
            path = _find_any_piper_model()

        if path is None:
            raise RuntimeError(
                "No Piper voice models found in any search path. "
                "Voice subsystem is non-functional. "
                "Please install at least one .onnx model to ~/piper-voices/"
            )

        self._voice_path = path
        self._resolved_for = requested
        return path

    async def synthesize(self, text: str, voice: str, speed: float) -> TTSResult:
        return await asyncio.to_thread(self._synthesize_sync, text, voice, speed)

    def _synthesize_sync(self, text: str, voice: str, speed: float) -> TTSResult:
        model_path = self._resolve_voice(voice)
        # Piper's length_scale maps inversely to "speed" — >1 slower, <1 faster.
        # We present speed in the UI (1.0 = natural), so convert.
        length_scale = 1.0 / max(speed, 0.1)

        tmp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp_path = Path(tmp_file.name)
        tmp_file.close()
        try:
            proc = subprocess.run(
                [
                    sys.executable, "-m", "piper",
                    "-m", str(model_path),
                    "--output-file", str(tmp_path),
                    "--length-scale", str(length_scale),
                ],
                input=text,
                text=True,
                capture_output=True,
                timeout=120,
            )
            if proc.returncode != 0:
                stderr_tail = (proc.stderr or "").strip()[-2000:]
                raise RuntimeError(
                    f"piper subprocess exited with code {proc.returncode}: {stderr_tail}"
                )

            data = tmp_path.read_bytes()
            # Pull the sample rate back out of the WAV header so clients
            # know what they're playing.
            with wave.open(io.BytesIO(data), "rb") as rb:
                sr = rb.getframerate()
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass

        return TTSResult(
            audio_wav=data,
            sample_rate=sr,
            engine="piper",
            voice=voice,
        )


# ── Factory ───────────────────────────────────────────────────────────────────


class SupertonicTTSProvider(TTSProvider):
    """Supertonic-3 — нейронний голос у самому процесі.

    ЧОМУ ЙОГО МОЖНА ІМПОРТУВАТИ, на відміну від Piper. Пакет `supertonic`
    поширюється під **MIT**, тож застереження, що стоїть у `PiperTTSProvider`
    (GPL-3.0 і похідний твір), сюди не стосується. Це і є та «пізніша віха»,
    про яку там написано: перехід на не-GPL рушій.

    ВАГИ — ОКРЕМИЙ ТВІР, і ліцензія в них інша: **BigScience Open RAIL-M**,
    з переліком заборонених застосувань (Attachment A). Тому ваги в пакунок
    НЕ кладуться: вони живуть у `~/.cache/supertonic3` на машині власника.
    У пакунок їде лише MIT-пакет.

    `auto_download=False` — навмисно й обовʼязково. Продукт не має права сам
    ходити в мережу по 400 МБ: або ваги вже на машині, або голосу немає, і
    тоді ми чесно падаємо в тишу, а не тягнемо щось за спиною власника.

    Рушій піднімається ЛІНИВО: конструктор коштує ~3 с, і платити їх під час
    вибору провайдера означало б гальмувати старт заради голосу, якого,
    можливо, ніхто сьогодні не попросить.
    """

    name = "supertonic"

    #: Виміряно 31.08 на цій машині: підняття 3.1 с, синтез фрази 5.0 с.
    _MODEL = "supertonic-3"
    _SAMPLE_RATE = 44_100

    def __init__(self) -> None:
        if importlib.util.find_spec("supertonic") is None:
            raise RuntimeError("supertonic не встановлено")
        # Ці чотири ключі лежали в конфігу з нульовою кількістю читачів —
        # той самий клас, що ховав сам Supertonic. Я спершу зашив шлях і
        # голос жорстко, не помітивши їх; вони знають більше за мене:
        # типовий голос тут M1, а не F1, і біля потоків стоїть ВИМІР —
        # «12 потоків ORT удвічі повільніші».
        self._voice = getattr(config, "voice_tts_supertonic_voice", "M1")
        self._steps = int(getattr(config, "voice_tts_supertonic_steps", 8))
        self._threads = int(getattr(config, "voice_tts_supertonic_threads", 4))
        self._dir = self._weights_dir()
        if self._dir is None:
            raise RuntimeError(
                "ваги Supertonic не знайдено — очікую ~/.cache/supertonic3 "
                "(пакунок їх не несе: ліцензія ваг RAIL-M, вони лишаються на машині)"
            )
        self._tts = None  # ліниво

    @staticmethod
    def _weights_dir() -> Optional[Path]:
        configured = getattr(config, "voice_tts_supertonic_model_dir", "") or ""
        for cand in (
            Path(configured) if configured else None,
            Path(os.environ["SUPERTONIC_MODEL_DIR"]) if os.environ.get("SUPERTONIC_MODEL_DIR") else None,
            Path.home() / ".cache" / "supertonic3",
        ):
            if cand and (cand / "onnx").is_dir() and (cand / "voice_styles").is_dir():
                return cand
        return None

    def _engine(self):
        if self._tts is None:
            from supertonic import TTS  # MIT — імпорт у процесі дозволений
            self._tts = TTS(
                model=self._MODEL,
                model_dir=str(self._dir),
                auto_download=False,
                # Не типове значення ORT: біля цього ключа в конфігу стоїть
                # виміряне «12 потоків удвічі повільніші за 4».
                intra_op_num_threads=self._threads,
            )
        return self._tts

    async def synthesize(self, text: str, voice: str, speed: float) -> TTSResult:
        def _run() -> bytes:
            tts = self._engine()
            name = voice if voice in _SUPERTONIC_VOICES else self._voice
            audio, _ = tts.synthesize(
                text,
                tts.get_voice_style(name),
                lang="uk",
                speed=speed or 1.0,
                total_steps=self._steps,
            )
            import numpy as np

            arr = np.asarray(audio, dtype="float32").reshape(-1)
            pcm = (np.clip(arr, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
            buf = io.BytesIO()
            with wave.open(buf, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(self._SAMPLE_RATE)
                w.writeframes(pcm)
            return buf.getvalue()

        wav = await asyncio.to_thread(_run)
        return TTSResult(
            audio_wav=wav,
            sample_rate=self._SAMPLE_RATE,
            engine=self.name,
            voice=voice,
        )


#: Десять вбудованих голосів Supertonic-3, як їх називає сам пакет.
_SUPERTONIC_VOICES = {f"{g}{i}" for g in ("F", "M") for i in range(1, 6)}


def build_tts_provider() -> TTSProvider:
    """
    Choose a TTS provider. If voice_tts_enabled is off we short-circuit
    to Silent — this keeps the HTTP contract (always returns audio/wav)
    while telling the front-end via the engine name that TTS is disabled.
    """
    if not config.voice_tts_enabled:
        return SilentTTSProvider()

    # Опція `voice_tts_engine` існувала в конфізі з трьома значеннями і
    # **не читалася ніким** — тобто налаштування, яке нічого не робить.
    # Тепер читається; `auto` пробує рушії за якістю, а не за алфавітом.
    wanted = getattr(config, "voice_tts_engine", "auto")

    order: list[type[TTSProvider]]
    if wanted == "silent":
        return SilentTTSProvider()
    elif wanted == "supertonic":
        order = [SupertonicTTSProvider]
    elif wanted == "piper":
        order = [PiperTTSProvider]
    else:  # auto
        # Supertonic перший навмисно: він у процесі (MIT), тримається теплим
        # і не платить запуском окремого процесу на кожну фразу, як Piper.
        order = [SupertonicTTSProvider, PiperTTSProvider]

    for cls in order:
        try:
            provider = cls()
            logger.info("TTS: обрано %s", provider.name)
            return provider
        except Exception as exc:  # noqa: BLE001
            # Не `debug`: мовчазне падіння в тишу — саме те, через що продукт
            # пів року не говорив, маючи робочий голос на диску.
            logger.warning("TTS %s недоступний: %s", cls.__name__, exc)
    logger.warning("TTS: жоден рушій не піднявся — лишається тиша")
    return SilentTTSProvider()


# ── Phase 9.2 — language-aware voice selection ────────────────────────────────


def _cyrillic_ratio(text: str) -> float:
    """Fraction of letters in `text` that are Cyrillic. Spaces+punct ignored."""
    if not text:
        return 0.0
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    cyrillic = sum(
        1 for c in letters
        if "\u0400" <= c <= "\u04FF" or "\u0500" <= c <= "\u052F"
    )
    return cyrillic / len(letters)


def select_voice_for_text(text: str) -> str:
    """Pick UA or EN Piper voice based on Cyrillic content ratio.

    >50% Cyrillic → UA voice. Else EN voice. When auto-detection is off,
    return the configured `voice_tts_voice`.
    """
    if not getattr(config, "voice_tts_auto_language", True):
        return config.voice_tts_voice
    return (
        config.voice_tts_voice_uk
        if _cyrillic_ratio(text) > 0.5
        else config.voice_tts_voice_en
    )


__all__ = [
    "TTSProvider", "TTSResult", "SilentTTSProvider", "PiperTTSProvider",
    "build_tts_provider", "select_voice_for_text", "_cyrillic_ratio",
]
