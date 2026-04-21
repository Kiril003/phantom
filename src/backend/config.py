"""
PHANTOM OS — Backend Configuration
All settings come from environment, .env file, or SQLite DB overrides.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class PhantomConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        # Phase 9.3a (AD-02) — validate on setattr so apply_overrides() and
        # reload_from_db() actually reject values that don't match the field's
        # declared type. Without this, Pydantic v2 BaseSettings lets any
        # type-mismatched value sneak through setattr silently.
        validate_assignment=True,
    )

    # ── Server ────────────────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8000"]

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./phantom.db"

    # ── ChromaDB ──────────────────────────────────────────────────────────────
    chroma_path: str = "./chroma_data"
    embedding_model: str = "all-MiniLM-L6-v2"
    memory_top_k: int = 5
    memory_importance_threshold: float = 0.3
    memory_tactical_window_h: int = 24
    memory_auto_archive_days: int = 90
    memory_max_facts_per_user: int = 10000

    # ── AI ────────────────────────────────────────────────────────────────────
    # ai_primary_provider accepts either AI_PRIMARY_PROVIDER or the shorter AI_PROVIDER.
    ai_primary_provider: Literal["gemini", "ollama"] = Field(
        default="gemini",
        validation_alias=AliasChoices("AI_PRIMARY_PROVIDER", "AI_PROVIDER"),
    )
    ai_fallback_provider: Literal["gemini", "ollama", "none"] = "ollama"
    ai_timeout_s: float = 120.0
    ai_gemini_model: str = "gemini-2.5-flash"
    ai_gemini_api_key: str = ""
    ai_ollama_model: str = "llama3.2:3b"
    ai_ollama_host: str = "http://localhost:11434"
    ai_ollama_num_ctx: int = 8192
    ai_temperature: float = 0.7
    ai_max_tokens: int = 2048
    ai_top_p: float = 0.9
    ai_system_prompt_extra: str = ""
    ai_response_language: Literal["auto", "uk", "en", "ru"] = "auto"
    ai_initiative_enabled: bool = True
    ai_initiative_cooldown_s: int = 300
    ai_streaming: bool = True
    # Phase 9.2 — total retries across primary+fallback for tool-use calls.
    ai_tool_use_max_total_retries: int = 5
    # Phase 9.2.1 — minimum interval between successive LLM calls per provider.
    # 3000ms keeps us well under Gemini 2.5-flash free-tier 10 RPM ceiling
    # while still letting paid-tier deployments raise it via settings.
    ai_call_min_interval_ms: int = 3000

    # Chat (Phase 5) — WS stream emission cadence
    chat_stream_chunk_chars: int = 24
    chat_stream_delay_s: float = 0.05
    chat_max_session_history: int = 50

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
    # Master switch for the ESP32 serial bridge. Disable on dev machines where
    # no ESP32 is attached to avoid noisy reconnect logs.
    serial_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("PHANTOM_SERIAL_ENABLED", "SERIAL_ENABLED"),
    )
    sensor_wifi_scan_interval_s: int = 10
    sensor_wifi_scan_enabled: bool = True
    wardriving_cell_precision: int = 4  # decimal digits ≈ 11 m cells
    wardriving_heatmap_precision: int = 3  # decimal digits ≈ 110 m cells for heatmap
    wardriving_max_records_query: int = 5000
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

    # ── Vision / Face / OLED (Phase 08) ──────────────────────────────────────
    # Browser-side MediaPipe FaceLandmarker produces landmark arrays; backend
    # stores per-user averaged embeddings in User.preferences_json["face"].
    # privacy_mode gates what the camera stream is ALLOWED to extract:
    #   off        — camera completely disabled (same as tracking_enabled=False)
    #   landmarks  — only geometric landmarks (no raw frames leave the device)
    #   full       — landmarks + bounding box + head-pose (frames still local)
    # Embeddings are NEVER sent to AI providers and NEVER leave the device.
    face_tracking_enabled: bool = True
    face_tracking_auto_switch_profile: bool = True
    face_tracking_privacy_mode: Literal["off", "landmarks", "full"] = "landmarks"
    face_recognition_threshold: float = 0.75
    face_unknown_lockout_s: int = 10
    # OLED face animator — mock WS channel "oled" drives a preview UI chip.
    # On production this same frame stream flows over serial to ESP32 SH1106.
    oled_animation_enabled: bool = True
    oled_animation_speed: float = 1.0  # 0.1-3.0; scales state-transition duration
    oled_brightness: int = 200          # 0-255 UI preview dimming
    oled_frame_hz: int = 30

    # ── Agent (Phase 9.1 Cognitive Seed) ─────────────────────────────────────
    agent_enabled: bool = True
    agent_risk_tolerance: int = 5            # caps executable actions: 1/3/5/7
    agent_workspace_dir: str = "~/phantom/workspace"
    agent_max_actions_per_task: int = 20
    agent_max_elapsed_s_per_task: int = 600
    agent_max_elapsed_s_per_action: int = 120
    agent_max_consecutive_identical_errors: int = 3
    # Phase 9.2.1 — per-task LLM-call budget. Hard cap fails the task; warn
    # threshold emits a WS event so UIs can show the user before exhaustion.
    agent_max_llm_calls_per_task: int = 50
    agent_warn_llm_calls_per_task: int = 30
    # Phase 9.4a — background track runs under tighter limits than foreground:
    # smaller per-task LLM-call cap + harder wall-clock timeout. Rationale:
    # background work is best-effort "watch and act"; it must not burn the
    # provider budget or dominate the single background slot for >5 min.
    # Both hot-reloadable.
    agent_max_llm_calls_per_background_task: int = 10
    agent_warn_llm_calls_per_background_task: int = 6
    agent_background_task_timeout_s: int = 300
    agent_background_queue_max: int = 20
    # Phase 9.4c audit E1 — foreground queue is never enqueued in current
    # code (foreground refuses when busy) but the deque is bounded so a
    # future code path can't blow memory.
    agent_foreground_queue_max: int = 50
    # Phase 9.2.2 — when True, LLM calls without task_id log a WARNING.
    agent_require_task_id_for_budget: bool = True
    # Phase 9.2.2 — blocked_quota probe cadence + adaptive backoff ceiling.
    agent_blocked_quota_probe_s: int = 60
    agent_blocked_quota_probe_max_s: int = 600
    # Phase 9.2.3 (F-17) — max seconds the loop will block on
    # intervention_queue.get() for a risky-action consent prompt or an
    # ask_user precondition before timing out and rejecting the step. Stops
    # tasks from hanging forever if the operator walks away from the console.
    agent_user_consent_timeout_s: int = 300
    # Phase 9.3a — structured emotional state decay cadence. Every
    # `agent_emotion_decay_interval_s` seconds a background loop drifts each
    # EmotionVector axis toward its baseline by `agent_emotion_decay_rate`
    # of the distance. Both values are hot-reloadable (AD-02) so operators
    # can tune responsiveness without a restart.
    agent_emotion_enabled: bool = True
    agent_emotion_decay_interval_s: int = 60
    agent_emotion_decay_rate: float = 0.05
    # Phase 9.3b — proactive loop (background "should I speak unprompted?"
    # evaluator). Default ENABLED as of phase-09.4c consolidation (audit G2):
    # PHANTOM initiates conversation on long-silence / high-fatigue triggers.
    # All keys hot-reloadable via AD-02 reload_from_db.
    agent_proactive_enabled: bool = True
    agent_proactive_interval_s: int = 60
    agent_proactive_interval_min_s: int = 30
    agent_proactive_interval_max_s: int = 300
    agent_proactive_cooldown_s: int = 300
    agent_proactive_long_silence_threshold_min: int = 120
    agent_proactive_require_recent_chat: bool = True
    # Phase 9.3b — standing orders (persistent triggers). Runner checks every
    # `agent_standing_orders_poll_s` seconds; disabled by default so nothing
    # fires without operator opt-in. Hot-reloadable.
    agent_standing_orders_enabled: bool = True
    agent_standing_orders_poll_s: int = 10
    # Phase 9.3b — inner monologue channel rate limit (events per second).
    agent_monologue_rate_limit_eps: int = 10
    agent_reflection_every_n_actions: int = 5
    agent_thought_budget_force_reflect_ratio: float = 2.0
    agent_strategic_warn_actions: int = 30
    agent_browser_user_agent: str = (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )

    # ── Agent (Phase 9.2 Grounded Mind) ──────────────────────────────────────
    # Episodic memory — uses Phase 3 ChromaDB (chroma_path) with extra collection.
    agent_episodic_memory_enabled: bool = True
    agent_episodic_collection: str = "agent_episodes"
    agent_episodic_top_k: int = 3
    # Visual grounding (OmniParser V2 wrapper)
    agent_grounding_enabled: bool = True
    agent_grounding_min_confidence: float = 0.5
    # MCP — empty = no MCP servers active. Each entry:
    # {"name": str, "transport": "stdio"|"http", "command"?: str, "url"?: str,
    #  "default_risk": int 1..7, "enabled": bool}
    agent_mcp_servers: list[dict] = []
    # Native tool-use vs fall back to free-form JSON. Tactical planner respects
    # this — tests can flip to False to bypass without unmocking the providers.
    agent_use_native_tool_calling: bool = True
    # Persona — Ukrainian primary, English technical-term fallback.
    agent_language_primary: Literal["uk", "en"] = "uk"
    agent_language_fallback: Literal["uk", "en"] = "en"

    # ── Voice / TTS — language-aware (Phase 9.2) ─────────────────────────────
    voice_tts_voice_uk: str = "uk_UA-lada-x_low"
    voice_tts_voice_en: str = "en_US-amy-low"
    voice_tts_auto_language: bool = True

    # ── Localization (Phase 9.4b — spatial intelligence) ─────────────────────
    # Pluggable LocalizationSource chain. Sources query in trust_level order:
    # hardware GPS (95) > user-stated (80) > browser geolocation (70) > IP (30).
    # Sanity guard rejects any estimate that would require implausible velocity
    # from the last accepted fix (default 1080 km/h, i.e. faster than any
    # commercial flight — a sane ceiling for "this can't be real" filtering).
    agent_localization_enabled: bool = True
    agent_localization_sanity_max_speed_kmh: float = 1080.0
    # Browser geolocation — frontend watchPosition stream, POSTed to
    # /map/geolocation/submit. Freshness window gates how stale a submission
    # can be before the source treats itself as unavailable.
    agent_browser_geolocation_enabled: bool = True
    agent_browser_geolocation_freshness_s: float = 60.0
    # IP-based localization via ipapi.co — coarse city-level fallback. Free
    # tier is 1000 req/day; we default to 900 for headroom. 10 min cache
    # inside the adapter keeps most workloads under 150 req/day.
    agent_ip_locator_enabled: bool = True
    agent_ip_locator_rate_per_day: int = 900
    # User-stated location ("я в Одесі") lives 24 h by default.
    agent_user_stated_ttl_s: int = 24 * 3600
    # Reverse / forward geocoding via Nominatim (OpenStreetMap). 1 req/s
    # enforced by the adapter (their policy); cache TTL is 7 days for
    # forward geocodes of static place names.
    agent_nominatim_enabled: bool = True
    agent_nominatim_user_agent: str = "PHANTOM-OS/0.9 (localhost)"
    agent_nominatim_cache_ttl_s: int = 7 * 24 * 3600
    # Overpass API — nearby OSM features. Cached 24 h per (lat,lon,radius).
    agent_overpass_enabled: bool = True
    agent_overpass_cache_ttl_s: int = 24 * 3600
    # Memory-to-geo bridge (spaCy NER). Disable if the model is unavailable.
    agent_geo_extractor_enabled: bool = True
    agent_geo_extractor_min_entity_length: int = 3
    # LocationHistory writer / enricher cadence + retention.
    agent_location_history_enabled: bool = True
    agent_location_history_min_distance_m: float = 50.0
    agent_location_history_min_interval_s: int = 300
    agent_location_history_retention_days: int = 90
    agent_location_history_enricher_interval_s: int = 3600
    # NEAR_REMEMBERED_PLACE dedup — one trigger per hour max.
    agent_near_remembered_dedup_s: int = 3600
    agent_near_remembered_radius_m: float = 200.0

    # ── System ────────────────────────────────────────────────────────────────
    system_hostname: str = "phantom"
    system_sensor_log_retention_days: int = 7
    system_backup_enabled: bool = True
    system_backup_interval_h: int = 24
    system_temporal_anchor_interval_s: int = 300

    def apply_overrides(self, overrides: dict[str, Any]) -> None:
        """
        In-place mutate config fields. Values that fail Pydantic validation are
        silently skipped (kept as the existing value) so a single bad override
        can't crash startup.

        Persistence is handled separately by `db.settings_repo.save(...)`.
        """
        for key, value in overrides.items():
            key_attr = key.replace(".", "_")
            if hasattr(self, key_attr):
                try:
                    setattr(self, key_attr, value)
                except Exception:
                    pass

    # Back-compat alias — the old name lied (it never touched the DB).
    apply_db_overrides = apply_overrides

    async def reload_from_db(self) -> dict[str, Any]:
        """
        Phase 9.3a (AD-02) — re-read the `settings` table and apply every row
        to the in-memory singleton. Safe to call repeatedly. Returns a dict
        of {key: new_value} for the rows that were actually applied so a
        caller can emit a `config.reloaded` WS event per key.

        Use this after an out-of-band DB write (sqlite3 CLI, live-test
        tooling, Settings UI on a sibling process) to push the new values
        through without a uvicorn restart. The live-update rules that
        subsystems register via `_apply_runtime_side_effect` still fire
        elsewhere — this method only syncs the singleton's values.
        """
        from db.settings_repo import load_all as _load_all

        try:
            overrides = await _load_all()
        except Exception:
            return {}
        applied: dict[str, Any] = {}
        for key, value in overrides.items():
            key_attr = key.replace(".", "_")
            if not hasattr(self, key_attr):
                continue
            before = getattr(self, key_attr)
            try:
                setattr(self, key_attr, value)
            except Exception:
                continue
            after = getattr(self, key_attr)
            if after != before:
                applied[key_attr] = after
        return applied


# Singleton — loaded once at startup, mutated on hot-reload
config = PhantomConfig()
