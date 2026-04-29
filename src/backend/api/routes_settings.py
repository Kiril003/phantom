"""
Settings routes — categorised live view of PhantomConfig plus runtime mutation.

Produces a shape that the frontend SettingsStore expects
(categories[] with settings[] using SettingDefinition contract).

Persistence contract:
  - PUT /settings/{key} writes to the `settings` DB table AND mutates the
    in-memory config so the change takes effect without restart.
  - POST /settings/reset deletes the corresponding DB rows AND re-loads
    defaults in memory, so on next restart the env/default values win.
  - POST /settings/import upserts each row, same as a batch of PUTs.
  - Startup loads every row via `db.settings_repo.load_all()` before any
    config-reading module initialises (see main.lifespan).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Iterable, Literal, get_args, get_origin

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from config import config
from db import settings_repo
from db.models import User
from security.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


SettingType = Literal[
    "string", "number", "boolean", "select", "range", "color", "text", "password"
]


class SettingDefinitionOut(BaseModel):
    key: str
    label: str
    description: str
    type: SettingType
    default: Any
    value: Any
    options: list[dict[str, str]] | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str | None = None
    requires_restart: bool = False
    category: str
    visible_to: list[str] = ["ROOT", "OPERATOR", "GUEST"]


class SettingsCategoryOut(BaseModel):
    id: str
    label: str
    icon: str
    settings: list[SettingDefinitionOut]


class CategoriesResponse(BaseModel):
    categories: list[SettingsCategoryOut]


class SetValueRequest(BaseModel):
    value: Any


class ResetRequest(BaseModel):
    category: str | None = None


class ImportRequest(BaseModel):
    settings: dict[str, Any]


# ─── Schema ──────────────────────────────────────────────────────────────

def _select_options_from_literal(field_type: Any) -> list[dict[str, str]] | None:
    if get_origin(field_type) is Literal:
        return [{"value": str(v), "label": str(v)} for v in get_args(field_type)]
    return None


def _infer_type(field_type: Any) -> SettingType:
    origin = get_origin(field_type)
    if origin is Literal:
        return "select"
    if field_type is bool:
        return "boolean"
    if field_type in (int, float):
        return "number"
    return "string"


# Human labels + grouping for the frontend.
CATEGORY_SPEC: list[dict[str, Any]] = [
    {
        "id": "general",
        "label": "Загальні",
        "icon": "⚙",
        "keys": [
            "system_hostname", "log_level", "debug", "serial_enabled",
            # Day-3 R-1 (audit-2026-04-30 D2-FE1): Day-2 productisation
            # added a JSON-formatter knob. Surfacing it here lets the
            # operator flip the format without redeploying.
            "log_json_enabled",
            # Day-3 R-2 (audit-2026-04-30 NEW-OPS-03): deployment-mode
            # gate. Surfaced read-only here so the operator can confirm
            # the daemon believes it's single-tenant.
            "deployment_mode",
        ],
    },
    {
        "id": "theme",
        "label": "Тема",
        "icon": "◐",
        "keys": [
            "ui_theme",
            "ui_density",
            "ui_color_cyan",
            "ui_color_warning",
            "ui_color_success",
            "ui_color_danger",
            "ui_color_dream",
            "ui_animation_speed",
            "ui_font_size",
        ],
    },
    {
        "id": "auth",
        "label": "Автентифікація",
        "icon": "🔒",
        "keys": [
            "security_auto_login",
            "security_session_timeout_m",
            "security_max_pin_attempts",
            "security_lockout_duration_m",
            "security_dangerous_cmd_confirm",
            "security_ghost_auto_encrypt",
            # Day-3 R-1 (audit-2026-04-30 D2-FE1 + D3-A-2): XFF
            # awareness lockout knobs land here so the operator can
            # tell the daemon "I have a reverse proxy in front; trust
            # X-Forwarded-For from this peer set".
            "security_trust_xff",
            "security_trusted_proxies",
        ],
    },
    # Day-3 R-1 (audit-2026-04-30 D2-FE1): chat tool-use knobs that
    # land with Phase 17b's `chat_pipeline`. The operator opts into
    # chat tools per-deploy (D2-I2 invariant) and tunes the per-call
    # + per-turn timeouts here without touching .env.
    {
        "id": "chat",
        "label": "Чат",
        "icon": "💬",
        "keys": [
            "chat_tools_enabled",
            "chat_tool_call_timeout_s",
            "chat_tool_max_total_ms",
            "chat_tool_max_calls_per_turn",
            "chat_prompt_logging_enabled",
            "chat_prompt_excerpt_max_chars",
        ],
    },
    {
        "id": "sensors",
        "label": "Сенсори",
        "icon": "◉",
        "keys": [
            "sensor_batch_interval_ms",
            "sensor_serial_port",
            "sensor_serial_baud",
            "sensor_radar_sensitivity",
            "sensor_radar_max_distance_cm",
            "sensor_breathing_detection",
            "sensor_gps_enabled",
            "sensor_wifi_scan_enabled",
            "sensor_wifi_scan_interval_s",
            "sensor_oled_brightness",
        ],
    },
    {
        "id": "ai",
        "label": "AI",
        "icon": "✦",
        "keys": [
            "ai_primary_provider",
            "ai_fallback_provider",
            "ai_timeout_s",
            "ai_gemini_model",
            "ai_gemini_api_key",
            "ai_ollama_model",
            "ai_ollama_host",
            "ai_temperature",
            "ai_max_tokens",
            "ai_top_p",
            "ai_response_language",
            "ai_initiative_enabled",
            "ai_streaming",
        ],
    },
    {
        "id": "voice",
        "label": "Голос",
        "icon": "♪",
        "keys": [
            "voice_stt_mode",
            "voice_stt_language",
            "voice_stt_whisper_model",
            "voice_stt_whisper_device",
            "voice_tts_enabled",
            "voice_tts_voice",
            "voice_tts_speed",
            "voice_tts_emotion_scale",
            "voice_tts_state_adaptation",
            "voice_wake_word_enabled",
            "voice_wake_words",
            # Phase 11b — always-on voice (legacy; voice_always_on_enabled is
            # a deprecated alias as of Phase 12.0 and ignored at runtime).
            "voice_always_on_enabled",
            "voice_wake_confidence_min",
            "voice_continuation_window_s",
            "voice_mic_duck_on_tts",
            # Phase 12.0 — VAD-driven voice modes
            "voice_mode",
            "voice_wake_phrase",
            "voice_silence_timeout_ms",
            # Phase 13b — streaming partials + Whisper refine.
            "voice_streaming_partials",
            "voice_partial_debounce_ms",
            "voice_refine_with_whisper",
            "voice_refine_diff_threshold",
            # Phase 15 — NPU (Hexagon HTP) Whisper encoder.
            "voice_stt_npu_enabled",
            "voice_stt_npu_model_path",
            "voice_stt_npu_compute",
            # Phase 15b — MMS (Meta) instant-tier CTC NPU.
            "voice_stt_mms_enabled",
            "voice_stt_mms_lang",
            "voice_stt_mms_bundle_dir",
            "voice_stt_mms_compute",
            "voice_stt_mms_refine_with_turbo",
            "voice_stt_mms_refine_confidence_min",
        ],
    },
    {
        "id": "vision",
        "label": "Зір · Обличчя",
        "icon": "◉",
        "keys": [
            "face_tracking_enabled",
            "face_tracking_auto_switch_profile",
            "face_tracking_privacy_mode",
            "face_recognition_threshold",
            "face_unknown_lockout_s",
            "oled_animation_enabled",
            "oled_animation_speed",
            "oled_brightness",
            "oled_frame_hz",
        ],
    },
    {
        "id": "agent",
        "label": "Агент",
        "icon": "🤖",
        "keys": [
            "agent_enabled",
            "agent_risk_tolerance",
            "agent_max_actions_per_task",
            "agent_max_llm_calls_per_task",
            "agent_proactive_enabled",
            "agent_standing_orders_enabled",
            "agent_episodic_memory_enabled",
            "agent_localization_enabled",
        ],
    },
    {
        "id": "map",
        "label": "Карта",
        "icon": "◎",
        "keys": [
            "ui_map_default_zoom",
            "ui_map_style",
            "agent_localization_enabled",
            "agent_browser_geolocation_enabled",
            "wardriving_cell_precision",
            "wardriving_heatmap_precision",
        ],
    },
    {
        "id": "about",
        "label": "Про систему",
        "icon": "ⓘ",
        "keys": [],  # virtual category, rendered without fields
    },
]

LABEL_OVERRIDES: dict[str, str] = {
    "system_hostname": "Hostname",
    "log_level": "Рівень логування",
    "debug": "Режим налагодження",
    "serial_enabled": "ESP32 serial bridge",
    "ui_theme": "Тема",
    "ui_density": "Щільність",
    "ui_color_cyan": "Accent (FOCUS)",
    "ui_color_warning": "Accent (DREAM)",
    "ui_color_success": "Accent (GHOST)",
    "ui_color_danger": "Accent (SENTINEL)",
    "ui_color_dream": "Накладка DREAM",
    "ui_animation_speed": "Швидкість анімацій",
    "ui_font_size": "Розмір шрифту",
    "security_auto_login": "Авто-логін",
    "security_session_timeout_m": "Таймаут сесії (хв)",
    "security_max_pin_attempts": "Максимум PIN спроб",
    "security_lockout_duration_m": "Блокування (хв)",
    "security_dangerous_cmd_confirm": "Підтвердження небезпечних команд",
    "security_ghost_auto_encrypt": "GHOST auto-encrypt",
    "sensor_batch_interval_ms": "Інтервал батчів (мс)",
    "sensor_serial_port": "Serial порт ESP32",
    "sensor_serial_baud": "Serial baud",
    "sensor_radar_sensitivity": "Чутливість радару",
    "sensor_radar_max_distance_cm": "Дальність радару (см)",
    "sensor_breathing_detection": "Детекція дихання",
    "sensor_gps_enabled": "GPS увімкнено",
    "sensor_wifi_scan_enabled": "WiFi сканування",
    "sensor_wifi_scan_interval_s": "Інтервал сканування (с)",
    "sensor_oled_brightness": "Яскравість OLED",
    "ai_primary_provider": "Головний провайдер",
    "ai_fallback_provider": "Резервний провайдер",
    "ai_timeout_s": "AI timeout (с)",
    "ai_gemini_model": "Gemini модель",
    "ai_gemini_api_key": "Gemini API key",
    "ai_ollama_model": "Ollama модель",
    "ai_ollama_host": "Ollama host",
    "ai_temperature": "Температура",
    "ai_max_tokens": "Max tokens",
    "ai_top_p": "Top-p",
    "ai_response_language": "Мова відповідей",
    "ai_initiative_enabled": "Проактивність",
    "ai_streaming": "Стрімінг",
    "voice_stt_mode": "STT режим",
    "voice_stt_language": "STT мова",
    "voice_stt_whisper_model": "Whisper модель",
    "voice_stt_whisper_device": "Whisper device",
    "voice_tts_enabled": "TTS увімкнено",
    "voice_tts_voice": "Голос TTS",
    "voice_tts_speed": "Швидкість TTS",
    "voice_tts_emotion_scale": "Емоційність",
    "voice_tts_state_adaptation": "Адаптація до стану",
    "voice_wake_word_enabled": "Wake-word",
    "voice_wake_words": "Wake-word фрази",
    "voice_always_on_enabled": "Always-on голос (deprecated)",
    "voice_wake_confidence_min": "Мін. впевненість wake",
    "voice_continuation_window_s": "Вікно продовження (с)",
    "voice_mic_duck_on_tts": "Заглушити мікрофон під час TTS",
    "voice_mode": "Голосовий режим",
    "voice_wake_phrase": "Wake-фраза",
    "voice_silence_timeout_ms": "Тиша до кінця фрази (мс)",
    "voice_streaming_partials": "Streaming partials (живий текст)",
    "voice_partial_debounce_ms": "Дебаунс partials (мс)",
    "voice_refine_with_whisper": "Whisper refine (advanced)",
    "voice_refine_diff_threshold": "Поріг різниці refine (0..1)",
    "voice_stt_npu_enabled": "STT на NPU (Hexagon)",
    "voice_stt_npu_model_path": "NPU модель — шлях",
    "voice_stt_npu_compute": "NPU precision (int8/fp16)",
    "voice_stt_mms_enabled": "MMS instant-tier (NPU)",
    "voice_stt_mms_lang": "MMS мова (ukr/eng/rus/...)",
    "voice_stt_mms_bundle_dir": "MMS bundle dir",
    "voice_stt_mms_compute": "MMS precision (int8/fp16)",
    "voice_stt_mms_refine_with_turbo": "Refine via Whisper-Turbo",
    "voice_stt_mms_refine_confidence_min": "MMS впевненість для refine (0..1)",
    "face_tracking_enabled": "Face tracking",
    "face_tracking_auto_switch_profile": "Auto-switch profile",
    "face_tracking_privacy_mode": "Privacy mode",
    "face_recognition_threshold": "Recognition threshold",
    "face_unknown_lockout_s": "Unknown lockout (s)",
    "oled_animation_enabled": "OLED-очі",
    "oled_animation_speed": "Швидкість OLED",
    "oled_brightness": "Яскравість OLED preview",
    "oled_frame_hz": "OLED FPS",
    "ui_map_default_zoom": "Zoom за замовч.",
    "ui_map_style": "Стиль карти",
    "wardriving_cell_precision": "Wardriving cell precision",
    "wardriving_heatmap_precision": "Heatmap precision",
    "wardriving_max_records_query": "Max query records",
    "agent_enabled": "Агент увімкнено",
    "agent_risk_tolerance": "Толерантність до ризику (1-7)",
    "agent_max_actions_per_task": "Макс. дій на задачу",
    "agent_max_llm_calls_per_task": "Ліміт викликів LLM",
    "agent_proactive_enabled": "Проактивна ініціатива",
    "agent_standing_orders_enabled": "Постійні протоколи (Standing Orders)",
    "agent_episodic_memory_enabled": "Епізодична пам'ять",
    "agent_localization_enabled": "Геолокація агента",
    "agent_browser_geolocation_enabled": "Використовувати GPS браузера",
}

PASSWORD_KEYS = {"ai_gemini_api_key", "jwt_secret_key"}

# Settings exposed in the UI whose underlying subsystem hasn't landed yet.
# They still persist via PUT and survive restart, but the label carries a
# "[soon]" badge so operators aren't misled into expecting behaviour that
# will only come online once the owning phase ships. Keep this list tight:
# a key that is actually wired must NOT appear here.
UNIMPLEMENTED_KEYS = {
    # Voice pipeline — Phase 07 shipped push-to-talk STT/TTS wiring;
    # Phase 11b shipped always-on wake word + continuous streaming, so
    # voice_wake_word_enabled / voice_wake_words / voice_always_on_* /
    # voice_wake_confidence_min / voice_continuation_window_s /
    # voice_mic_duck_on_tts now land too. What's still [soon]:
    #   - Whisper-specific knobs (faster-whisper kept for 11c multi-
    #     lang on-demand; the knobs themselves stay UI-only until 11c).
    #   - emotion_scale / state_adaptation → piper doesn't consume them.
    "voice_stt_whisper_model",
    "voice_stt_whisper_device",
    "voice_tts_emotion_scale",
    "voice_tts_state_adaptation",
    # ESP32-side sensors — need a command in firmware/protocol.h before
    # toggling them from the OS has any effect.
    "sensor_radar_sensitivity",
    "sensor_radar_max_distance_cm",
    "sensor_breathing_detection",
    "sensor_gps_enabled",
    "sensor_wifi_scan_interval_s",
    "sensor_oled_brightness",
    # Linux subsystem stubbed until Phase 09; GHOST pipeline not hooked yet.
    "security_ghost_auto_encrypt",
}


def _build_definition(key: str, category_id: str) -> SettingDefinitionOut | None:
    model_fields = type(config).model_fields
    if key not in model_fields:
        return None
    field_info = model_fields[key]
    annotation = field_info.annotation
    value = getattr(config, key)
    inferred = _infer_type(annotation)
    if key in PASSWORD_KEYS:
        inferred = "password"
        masked = "•" * 8 if value else ""
        display_value = masked
    else:
        display_value = value

    options = _select_options_from_literal(annotation)
    base_label = LABEL_OVERRIDES.get(key, key.replace("_", " ").title())
    label = f"{base_label} [soon]" if key in UNIMPLEMENTED_KEYS else base_label
    return SettingDefinitionOut(
        key=key,
        label=label,
        description="",
        type=inferred,
        default=field_info.default,
        value=display_value,
        options=options,
        requires_restart=False,
        category=category_id,
    )


def _collect_categories() -> list[SettingsCategoryOut]:
    """Return settings grouped by category. Phase 9.4c audit D4 — keys in
    ``UNIMPLEMENTED_KEYS`` are filtered out so the UI never renders rows
    whose toggle does nothing. They remain persistable via the REST API
    for operators who want to stage values ahead of a subsystem landing.
    """
    out: list[SettingsCategoryOut] = []
    for spec in CATEGORY_SPEC:
        defs = [
            d
            for key in spec["keys"]
            if key not in UNIMPLEMENTED_KEYS
            and (d := _build_definition(key, spec["id"])) is not None
        ]
        out.append(
            SettingsCategoryOut(
                id=spec["id"],
                label=spec["label"],
                icon=spec["icon"],
                settings=defs,
            )
        )
    return out


# ─── Routes ──────────────────────────────────────────────────────────────


@router.get("", response_model=CategoriesResponse)
async def get_all_settings(
    _user: User = Depends(get_current_user),  # Day-2 D2-A2 (audit F-09)
) -> CategoriesResponse:
    return CategoriesResponse(categories=_collect_categories())


@router.get("/_value/{key:path}")
async def get_setting(
    key: str,
    _user: User = Depends(get_current_user),  # Day-2 D2-A2 (audit F-09)
) -> dict[str, Any]:
    if not hasattr(config, key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown key: {key}")
    return {"key": key, "value": getattr(config, key)}


@router.put("/{key:path}")
async def set_setting(
    key: str,
    req: SetValueRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    if not hasattr(config, key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown key: {key}")

    # Phase 12.0 — voice_always_on_enabled is now a deprecated alias. The
    # 11c.5 write-lock is gone; the field still persists so existing rows
    # don't break, but routes_voice_stream.py reads voice_mode (off /
    # continuous / wake_word) instead. Logging the deprecation here helps
    # operators migrating off the old toggle.
    if key == "voice_always_on_enabled":
        logger.info(
            "settings: voice_always_on_enabled is deprecated as of Phase 12.0 "
            "— use voice_mode (off | continuous | wake_word) instead"
        )

    # Phase 9.4c audit D4 — the key may be staged ahead of its owning phase.
    # We still let the write through (persist survives a restart) but log a
    # warning so the operator knows the toggle has no runtime effect yet.
    if key in UNIMPLEMENTED_KEYS:
        logger.warning(
            "settings: %r is not wired to any runtime code yet — value persisted but inactive",
            key,
        )

    # Apply in-memory first so validation rejects bad values before we persist.
    before = getattr(config, key)
    try:
        config.apply_overrides({key: req.value})
    except Exception as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to set {key}: {exc}",
        ) from exc

    after = getattr(config, key)
    # Pydantic silently ignored the write (type mismatch / Literal miss).
    if after == before and req.value != before:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Rejected value for {key}: {req.value!r}",
        )

    try:
        await settings_repo.save(key, after, user_id=user.id)
    except Exception as exc:
        # Roll in-memory back so UI and DB don't diverge.
        config.apply_overrides({key: before})
        logger.exception("settings: failed to persist %s", key)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to persist {key}: {exc}",
        ) from exc

    # Phase 11c.4 — _apply_runtime_side_effect for voice_* keys calls
    # voice.pipeline.reset_providers() which acquires a threading.Lock.
    # That same lock is held by voice.pipeline.get_vosk_model() during a
    # ~10s+ Vosk model load on first /ws/voice connect. Running side_effect
    # synchronously on the event loop would block the entire loop (and
    # /health) waiting for that lock. Off-load to a worker thread so only
    # the worker waits while the event loop stays responsive.
    await asyncio.to_thread(_apply_runtime_side_effect, key, after)

    # Phase 9.3a (AD-02) — re-sync the singleton from DB so any row changed
    # out-of-band (sibling process, CLI, migration) also lands, then notify
    # live clients so dashboards can refresh without a reload.
    try:
        await config.reload_from_db()
    except Exception as exc:
        logger.debug("config.reload_from_db after PUT %s failed: %s", key, exc)
    try:
        from api.websocket_hub import hub
        await hub.broadcast(
            "settings", "config.reloaded",
            {"key": key, "value": after if key not in PASSWORD_KEYS else None},
        )
    except Exception as exc:
        logger.debug("config.reloaded broadcast failed: %s", exc)

    return {"key": key, "value": after, "requires_restart": False}


def _apply_runtime_side_effect(key: str, value: Any) -> None:
    """
    A handful of settings need to re-initialise subsystems on change so they
    take effect without a restart. Keep this list short and explicit — opaque
    hot-reload magic is worse than `requires_restart: true`.
    """
    if key == "log_level":
        logging.getLogger().setLevel(value)
    elif key == "ai_primary_provider":
        # Sync the ContextEngine snapshot immediately so the StatusBar flips
        # from the previous provider on the very next WS broadcast, rather
        # than waiting for either the next chat turn or the next context
        # tick (both can be >500 ms away).
        try:
            from core.context_engine import context_engine
            context_engine.set_ai_provider(value)
        except Exception as exc:
            logger.debug("context_engine.set_ai_provider failed: %s", exc)
    elif key == "system_hostname":
        # Keep the running logger formatter in sync so subsequent records carry
        # the new hostname without a restart.
        new_fmt = logging.Formatter(
            f"%(asctime)s [{value}] [%(levelname)s] %(name)s: %(message)s"
        )
        for h in logging.getLogger().handlers:
            h.setFormatter(new_fmt)
    elif key.startswith("voice_"):
        # Phase 12.0 — only reset providers when the key genuinely
        # invalidates a loaded model. Phase-12 mode keys (voice_mode,
        # voice_wake_phrase, voice_silence_timeout_ms) are runtime params
        # the orchestrator reads at WS connect time; resetting on them
        # would defeat the singleton preload (Bug 2). Reset only when
        # the STT engine, the Whisper config, the Vosk model path, or
        # the TTS voice changes.
        invalidating_keys = {
            "voice_stt_mode",
            "voice_stt_vosk_model",
            "voice_stt_whisper_model",
            "voice_stt_whisper_device",
            "voice_stt_whisper_compute",
            "voice_stt_language",
            "voice_tts_enabled",
            "voice_tts_voice",
            "voice_tts_voice_uk",
            "voice_tts_voice_en",
            # Phase 15 — toggling NPU re-routes the factory chain entirely;
            # rebuild on the next request so the new provider is used.
            "voice_stt_npu_enabled",
            "voice_stt_npu_model_path",
            "voice_stt_npu_compute",
            # Phase 15b — same logic for the MMS instant-tier path. Lang
            # change loads a different per-language bundle, so reset too.
            "voice_stt_mms_enabled",
            "voice_stt_mms_lang",
            "voice_stt_mms_bundle_dir",
            "voice_stt_mms_compute",
        }
        if key in invalidating_keys:
            try:
                from voice.pipeline import reset_providers
                reset_providers()
            except Exception as exc:
                logger.debug("voice.reset_providers() failed: %s", exc)


@router.post("/reset")
async def reset_settings(
    req: ResetRequest,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Restore defaults for a category (or all). Mutates in-memory config AND
    deletes DB overrides so next restart truly falls back to env/defaults.

    Audit smoke-test fix — pre-fix the loop did `setattr(config, key, fresh_value)`
    which re-triggered Pydantic `validate_assignment=True` for each field. The
    cross-field validators (e.g. ai_primary_provider != ai_fallback_provider)
    would see the half-applied config mid-loop and raise `ValidationError`,
    which surfaced as a bare 500 because the handler had no `except`. Fix:
    merge the target keys into a snapshot dict, validate the WHOLE snapshot
    once, then assign each field via `object.__setattr__` — bypassing
    per-field assignment validation since the merged dict was just proven
    consistent as a unit.
    """
    from pydantic import ValidationError

    from config import PhantomConfig

    fresh = PhantomConfig()
    target_keys: Iterable[str]
    if req.category:
        spec = next((c for c in CATEGORY_SPEC if c["id"] == req.category), None)
        target_keys = spec["keys"] if spec else []
    else:
        target_keys = [k for c in CATEGORY_SPEC for k in c["keys"]]
    target_keys = list(target_keys)

    # Build the post-reset snapshot in a dict, validate once, then apply.
    current_snapshot = config.model_dump()
    fresh_snapshot = fresh.model_dump()
    merged = {
        **current_snapshot,
        **{k: fresh_snapshot[k] for k in target_keys if k in fresh_snapshot},
    }
    try:
        validated = PhantomConfig.model_validate(merged)
    except ValidationError as exc:
        # Partial reset (one category) can leave cross-field invariants
        # broken — surface as 422, not 500, so the FE can show the actual
        # validation error rather than a bare "Internal Server Error".
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Reset would produce an invalid configuration",
                "errors": exc.errors(),
            },
        ) from exc

    reset_keys: list[str] = []
    for key in target_keys:
        if hasattr(validated, key):
            # Bypass `validate_assignment` — `validated` is the whole-model
            # validation result, so per-field re-validation isn't needed
            # and would re-introduce the cross-field crash.
            object.__setattr__(config, key, getattr(validated, key))
            reset_keys.append(key)

    try:
        await settings_repo.delete(reset_keys)
    except Exception as exc:
        logger.exception("settings: failed to clear DB overrides on reset")
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reset (DB clear) failed: {exc}",
        ) from exc

    return {"ok": True, "reset_count": len(reset_keys)}


@router.post("/export")
async def export_settings(
    _user: User = Depends(get_current_user),  # Day-2 D2-A2 (audit F-09)
) -> dict[str, Any]:
    exportable: dict[str, Any] = {}
    for spec in CATEGORY_SPEC:
        for key in spec["keys"]:
            if key in PASSWORD_KEYS:
                continue
            if hasattr(config, key):
                exportable[key] = getattr(config, key)
    return {
        "settings": exportable,
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/import")
async def import_settings(
    req: ImportRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    imported, skipped = 0, 0
    for key, value in req.settings.items():
        if not hasattr(config, key):
            skipped += 1
            continue
        before = getattr(config, key)
        try:
            config.apply_overrides({key: value})
            after = getattr(config, key)
            if after == before and value != before:
                skipped += 1
                continue
            await settings_repo.save(key, after, user_id=user.id)
            imported += 1
        except Exception as exc:
            # Best-effort rollback of in-memory mutation. Audit-2026-04-28
            # F-42: surface the failure so operators can tell which rows
            # actually didn't roll back instead of just bumping the
            # "skipped" count opaquely.
            logger.warning(
                "settings.import: failed for key=%r value=%r — %s",
                key, value, exc,
            )
            try:
                config.apply_overrides({key: before})
            except Exception as rb_exc:
                logger.warning(
                    "settings.import: rollback failed for key=%r — %s",
                    key, rb_exc,
                )
            skipped += 1
    return {"ok": True, "imported_count": imported, "skipped": skipped}
