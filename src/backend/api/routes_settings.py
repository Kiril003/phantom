"""
Settings routes — categorised live view of PhantomConfig plus runtime mutation.

Produces a shape that the frontend SettingsStore expects
(categories[] with settings[] using SettingDefinition contract).

Phase-03 full DB persistence will land later; for now PUT mutates the in-memory
config via `apply_db_overrides`, which hot-applies the new value without restart.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Literal, get_args, get_origin

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from config import config

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
        "keys": ["system_hostname", "log_level", "debug", "serial_enabled"],
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
        ],
    },
    {
        "id": "map",
        "label": "Карта",
        "icon": "◎",
        "keys": [
            "ui_map_default_zoom",
            "ui_map_style",
            "wardriving_cell_precision",
            "wardriving_heatmap_precision",
            "wardriving_max_records_query",
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
    "log_level": "Log level",
    "debug": "Debug mode",
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
    "ui_map_default_zoom": "Zoom за замовч.",
    "ui_map_style": "Стиль карти",
    "wardriving_cell_precision": "Wardriving cell precision",
    "wardriving_heatmap_precision": "Heatmap precision",
    "wardriving_max_records_query": "Max query records",
}

PASSWORD_KEYS = {"ai_gemini_api_key", "jwt_secret_key"}


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
    return SettingDefinitionOut(
        key=key,
        label=LABEL_OVERRIDES.get(key, key.replace("_", " ").title()),
        description="",
        type=inferred,
        default=field_info.default,
        value=display_value,
        options=options,
        requires_restart=False,
        category=category_id,
    )


def _collect_categories() -> list[SettingsCategoryOut]:
    out: list[SettingsCategoryOut] = []
    for spec in CATEGORY_SPEC:
        defs = [
            d
            for key in spec["keys"]
            if (d := _build_definition(key, spec["id"])) is not None
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
async def get_all_settings() -> CategoriesResponse:
    return CategoriesResponse(categories=_collect_categories())


@router.get("/_value/{key:path}")
async def get_setting(key: str) -> dict[str, Any]:
    if not hasattr(config, key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown key: {key}")
    return {"key": key, "value": getattr(config, key)}


@router.put("/{key:path}")
async def set_setting(key: str, req: SetValueRequest) -> dict[str, Any]:
    if not hasattr(config, key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown key: {key}")
    try:
        config.apply_db_overrides({key: req.value})
    except Exception as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to set {key}: {exc}",
        ) from exc
    return {"key": key, "value": getattr(config, key), "requires_restart": False}


@router.post("/reset")
async def reset_settings(req: ResetRequest) -> dict[str, Any]:
    # In-memory reset — re-instantiate from env/defaults.
    from config import PhantomConfig

    fresh = PhantomConfig()
    target_keys: Iterable[str]
    if req.category:
        spec = next((c for c in CATEGORY_SPEC if c["id"] == req.category), None)
        target_keys = spec["keys"] if spec else []
    else:
        target_keys = [k for c in CATEGORY_SPEC for k in c["keys"]]
    reset_count = 0
    for key in target_keys:
        if hasattr(fresh, key):
            setattr(config, key, getattr(fresh, key))
            reset_count += 1
    return {"ok": True, "reset_count": reset_count}


@router.post("/export")
async def export_settings() -> dict[str, Any]:
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
async def import_settings(req: ImportRequest) -> dict[str, Any]:
    imported, skipped = 0, 0
    for key, value in req.settings.items():
        if hasattr(config, key):
            try:
                config.apply_db_overrides({key: value})
                imported += 1
            except Exception:
                skipped += 1
        else:
            skipped += 1
    return {"ok": True, "imported_count": imported, "skipped": skipped}
