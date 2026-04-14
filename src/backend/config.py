"""
PHANTOM OS — Backend Configuration
All settings come from environment, .env file, or SQLite DB overrides.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class PhantomConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Server ────────────────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8000"]

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./phantom.db"
    wardriving_db_path: str = "/data/wardriving.db"

    # ── ChromaDB ──────────────────────────────────────────────────────────────
    chroma_path: str = "./chroma_data"
    embedding_model: str = "all-MiniLM-L6-v2"
    memory_top_k: int = 5
    memory_importance_threshold: float = 0.3
    memory_tactical_window_h: int = 24
    memory_auto_archive_days: int = 90
    memory_max_facts_per_user: int = 10000

    # ── AI ────────────────────────────────────────────────────────────────────
    ai_primary_provider: Literal["gemini", "ollama"] = "gemini"
    ai_fallback_provider: Literal["gemini", "ollama", "none"] = "ollama"
    ai_timeout_s: float = 5.0
    ai_gemini_model: str = "gemini-2.0-flash"
    ai_gemini_api_key: str = ""
    ai_ollama_model: str = "gemma4:e4b"
    ai_ollama_host: str = "http://localhost:11434"
    ai_temperature: float = 0.7
    ai_max_tokens: int = 2048
    ai_top_p: float = 0.9
    ai_system_prompt_extra: str = ""
    ai_response_language: Literal["auto", "uk", "en", "ru"] = "auto"
    ai_initiative_enabled: bool = True
    ai_initiative_cooldown_s: int = 300
    ai_streaming: bool = True

    # ── Voice / STT ───────────────────────────────────────────────────────────
    voice_stt_mode: Literal["hybrid", "vosk", "whisper"] = "hybrid"
    voice_stt_vosk_model: str = "uk-v3-lgraph"
    voice_stt_whisper_model: Literal["small", "medium", "large-v3"] = "medium"
    voice_stt_whisper_device: Literal["auto", "cpu", "cuda"] = "auto"
    voice_stt_whisper_compute: Literal["int8", "float16", "float32"] = "int8"
    voice_stt_language: Literal["uk", "en", "auto"] = "uk"
    voice_stt_hybrid_threshold: float = 0.3
    voice_vad_silence_ms: int = 500
    voice_vad_speech_pad_ms: int = 200

    # ── Voice / TTS ───────────────────────────────────────────────────────────
    voice_tts_enabled: bool = True
    voice_tts_voice: str = "Марина"
    voice_tts_speed: float = 1.0
    voice_tts_alpha: float = 0.3
    voice_tts_beta: float = 0.7
    voice_tts_diffusion_steps: int = 5
    voice_tts_emotion_scale: float = 1.0
    voice_tts_state_adaptation: bool = True
    voice_wake_words: str = "фантом"
    voice_wake_word_enabled: bool = True
    voice_auto_listen_in_dialogue: bool = True

    # ── Sensors / Serial ──────────────────────────────────────────────────────
    sensor_batch_interval_ms: int = 500
    sensor_serial_port: str = "/dev/ttyUSB0"
    sensor_serial_baud: int = 921600
    sensor_wifi_scan_interval_s: int = 10
    sensor_wifi_scan_enabled: bool = True
    sensor_radar_sensitivity: int = 7
    sensor_radar_max_distance_cm: int = 300
    sensor_breathing_detection: bool = True
    sensor_gps_enabled: bool = True
    sensor_env_read_interval_s: int = 5
    sensor_oled_brightness: int = 128
    sensor_oled_timeout_s: int = 30
    sensor_haptic_intensity_ms: int = 200
    sensor_buzzer_volume: int = 50

    # ── UI ────────────────────────────────────────────────────────────────────
    ui_theme: Literal["dark", "light", "auto"] = "dark"
    ui_density: Literal["compact", "normal", "comfortable"] = "normal"
    ui_color_cyan: str = "#00D4FF"
    ui_color_warning: str = "#FF6B35"
    ui_color_success: str = "#39FF14"
    ui_color_danger: str = "#FF073A"
    ui_color_dream: str = "#9B8FD4"
    ui_animation_speed: float = 1.0
    ui_status_bar_height: int = 28
    ui_font_size: int = 14
    ui_chat_max_messages_visible: int = 50
    ui_map_default_zoom: int = 15
    ui_map_style: Literal["dark", "satellite", "streets"] = "dark"

    # ── Security ──────────────────────────────────────────────────────────────
    jwt_secret_key: str = ""  # REQUIRED: set via JWT_SECRET_KEY env var or .env
    jwt_algorithm: str = "HS256"
    security_auto_login: bool = True
    security_session_timeout_m: int = 480
    security_max_pin_attempts: int = 5
    security_lockout_duration_m: int = 15
    security_dangerous_cmd_confirm: bool = True
    security_ghost_auto_encrypt: bool = True
    security_rate_limit_ai: int = 10

    # ── Tools ─────────────────────────────────────────────────────────────────
    tools_calendar_first_day: Literal["mon", "sun"] = "mon"
    tools_work_hours_start: str = "09:00"
    tools_work_hours_end: str = "18:00"
    tools_alarm_sound: Literal["gentle", "alert", "custom"] = "gentle"
    tools_timer_sound: Literal["chime", "buzz", "voice"] = "chime"

    # ── System ────────────────────────────────────────────────────────────────
    system_hostname: str = "phantom"
    system_sensor_log_retention_days: int = 7
    system_backup_enabled: bool = True
    system_backup_interval_h: int = 24
    system_temporal_anchor_interval_s: int = 300

    def apply_db_overrides(self, overrides: dict[str, Any]) -> None:
        """Hot-apply settings from DB without restart."""
        for key, value in overrides.items():
            key_attr = key.replace(".", "_")
            if hasattr(self, key_attr):
                try:
                    setattr(self, key_attr, value)
                except Exception:
                    pass


# Singleton — loaded once at startup, mutated on hot-reload
config = PhantomConfig()
