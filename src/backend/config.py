"""
PHANTOM OS — Backend Configuration
All settings come from environment, .env file, or SQLite DB overrides.
"""
from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_logger = logging.getLogger(__name__)


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
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:8000",
        "http://localhost",
        "https://localhost",
        "capacitor://localhost",
        "http://phantom.local:5173",
        "http://phantom.local:8000",
        "http://phantom.local",
        "http://158.196.114.238:5173",
        "http://158.196.114.238:8000",
        "http://158.196.114.238",
    ]
    # Hostname embedded in pairing QR codes. Phones dial back to this
    # host during /pair/claim. Defaults to mDNS; operators on networks
    # without mDNS (university WiFi, cellular hotspot, anything where
    # `phantom.local` doesn't resolve) MUST override via env PAIR_HOST.
    pair_host: str = "phantom.local"

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = Field(
        default_factory=lambda: f"sqlite+aiosqlite:///{__import__('paths').resolve_data_dir('sqlite') / 'phantom.db'}"
    )

    # ── ChromaDB ──────────────────────────────────────────────────────────────
    chroma_path: str = Field(
        default_factory=lambda: str(__import__('paths').resolve_data_dir('chroma'))
    )
    embedding_model: str = "all-MiniLM-L6-v2"
    memory_top_k: int = 5
    memory_importance_threshold: float = 0.3
    memory_tactical_window_h: int = 24
    memory_auto_archive_days: int = 90
    memory_max_facts_per_user: int = 10000

    # ── Cognitive Memory Engine (Phase 12) ────────────────────────────────────
    cognitive_memory_enabled: bool = True
    cognitive_memory_decay_half_life_days: float = 30.0
    cognitive_memory_semantic_similarity_threshold: float = 0.90
    cognitive_memory_idle_timeout_min: int = 20
    cognitive_memory_consolidation_interval_min: int = 60
    cognitive_memory_min_importance: float = 0.3
    cognitive_memory_disclosure_threshold: float = 0.5
    cognitive_memory_semantic_weight: float = 0.60
    cognitive_memory_recency_weight: float = 0.15
    cognitive_memory_recall_weight: float = 0.15
    cognitive_memory_sentiment_weight: float = 0.10
    cognitive_memory_state_weight: float = 0.0

    # ── AI ────────────────────────────────────────────────────────────────────
    # ai_primary_provider accepts either AI_PRIMARY_PROVIDER or the shorter AI_PROVIDER.
    ai_primary_provider: Literal["anthropic", "gemini", "ollama"] = Field(
        default="gemini",
        validation_alias=AliasChoices("AI_PRIMARY_PROVIDER", "AI_PROVIDER"),
    )
    ai_fallback_provider: Literal["anthropic", "gemini", "ollama", "none"] = "none"
    ai_timeout_s: float = 180.0 # Increased for Deep Think models
    
    # Tiered Gemini models (Phase 30 upgrade — EXACT API IDs)
    # If set to "auto", they follow ai_gemini_model.
    ai_gemini_model: str = "gemini-2.5-flash"
    ai_gemini_api_key: str = ""

    # Chat tier routing — conversational vs complex vs background.
    # Verified live (2026-06): 2.0/2.0-lite are quota-exhausted; 1.5 retired (404).
    # 2.5-flash + 3.5-flash + flash-lite-latest have quota and valid IDs.
    ai_conversational_model: str = "gemini-2.5-flash"        # live chat — fast + smart, has quota
    ai_reasoning_model: str = "gemini-3.5-flash"             # complex queries + tools — smartest flash
    ai_background_model: str = "gemini-flash-lite-latest"    # background synthesis — cheap + fast

    # Specific tier overrides (set to "auto" to follow system model)
    ai_planner_model: str = "auto"
    ai_reflector_model: str = "auto"
    ai_tactical_model: str = "auto"
    ai_long_context_model: str = "auto"
    ai_artifact_model: str = "auto"

    # Anthropic Claude
    ai_anthropic_model: str = "claude-3-7-sonnet-20250219"
    ai_anthropic_api_key: str = ""
    
    ai_ollama_model: str = "llama3.1:8b" # Upgraded from 3b just in case
    ai_ollama_host: str = "http://localhost:11434"
    ai_ollama_num_ctx: int = 32768
    
    ai_temperature: float = 0.7
    ai_max_tokens: int = 4096
    ai_top_p: float = 0.9
    ai_system_prompt_extra: str = ""
    ai_response_language: Literal["auto", "uk", "en", "ru"] = "auto"
    ai_initiative_enabled: bool = True
    ai_initiative_cooldown_s: int = 300
    ai_streaming: bool = True
    # Phase 9.2 — total retries across primary+fallback for tool-use calls.
    ai_tool_use_max_total_retries: int = 3
    # Phase 9.2.1 — minimum interval between successive LLM calls per provider.
    ai_call_min_interval_ms: int = 200 # Reduced for Flash performance

    # Chat (Phase 5) — WS stream emission cadence.
    # Day-4 Wave-2 W-5 (audit U8-PERF-C2): default chat_stream_delay_s
    # FLIPPED 0.05 → 0.0. The 50 ms inter-chunk sleep was inserting
    # 250-500 ms of artificial latency per response (5-10 chunks per
    # turn). Real network jitter alone is the rate-limiter operators
    # actually want. Operators with deliberately-throttled deploys can
    # set the knob >0 in Settings; the hot path checks
    # `if delay > 0:` before calling asyncio.sleep so the new default
    # skips the sleep entirely.
    chat_stream_chunk_chars: int = 24
    chat_stream_delay_s: float = 0.0
    chat_max_session_history: int = 15  # ~30 min of conversation; ToM/hints stripped for short turns

    # ── Voice / STT ───────────────────────────────────────────────────────────
    # Phase 15 — "npu" added. When voice_stt_npu_enabled is True the factory
    # tries WhisperNPUProvider before faster-whisper regardless of mode; the
    # explicit "npu" mode value just makes the intent visible in /settings.
    voice_stt_mode: Literal["hybrid", "vosk", "whisper", "npu", "mms"] = "hybrid"
    voice_stt_vosk_model: str = "uk-v3-lgraph"
    # Phase 13a.1 — default lowered "medium" → "small". On Radxa Q6A ARM CPU
    # (no GPU/CUDA) "medium" INT8 ≈ 1.5–3 s per utterance; "small" INT8
    # ≈ 500–900 ms. WER on Ukrainian short utterances differs by ~3–5 %,
    # acceptable for conversational use. "tiny" added as last-resort fast
    # option (~200–400 ms, lower accuracy). Operator can pick any via UI.
    voice_stt_whisper_model: Literal["tiny", "small", "medium", "large-v3"] = "small"
    voice_stt_whisper_device: Literal["auto", "cpu", "cuda"] = "auto"
    voice_stt_whisper_compute: Literal["int8", "float16", "float32"] = "int8"
    voice_stt_language: Literal["uk", "en", "auto"] = "uk"
    voice_stt_hybrid_threshold: float = 0.3
    voice_vad_silence_ms: int = 500
    voice_vad_speech_pad_ms: int = 200

    # ── Voice / STT — Phase 15 NPU (Hexagon HTP via QNN) ─────────────────────
    # Opt-in. When True the factory tries WhisperNPUProvider first and falls
    # back to faster-whisper / vosk if the bundle, EP plugin, or HTP runtime
    # isn't available. Off by default until a converted bundle ships.
    voice_stt_npu_enabled: bool = False
    # Directory holding the converted bundle: encoder_int8.{onnx,bin},
    # decoder_model.onnx, decoder_with_past_model.onnx, tokenizer assets.
    # Built by scripts/convert_whisper_to_qnn.py.
    voice_stt_npu_model_path: str = "src/backend/voice/models/whisper-small-qnn"
    # Encoder precision toggle. INT8 needs the matching quantised ONNX +
    # context binary; FP16 lets the QNN EP do online compile against the
    # FP32 encoder (slower cold start, no calibration step required).
    voice_stt_npu_compute: Literal["int8", "fp16"] = "int8"

    # ── Voice / STT — Phase 15b MMS NPU (instant-tier, fully on Hexagon) ─────
    # Massively Multilingual Speech (facebook/mms-1b-all) compiled per-language
    # into a single QNN context binary. CTC head + wav2vec2 backbone fuse into
    # one forward pass — no autoregressive decoder, no CPU hop. End-to-end
    # latency ~60–90 ms on Q6A for short utterances; that's the "instant tier"
    # in the dual-tier voice pipeline (MMS instant → optional Whisper-Turbo
    # refine on low-confidence transcripts). Off by default until a bundle
    # ships at voice_stt_mms_bundle_dir / mms-<lang>-qnn/.
    voice_stt_mms_enabled: bool = False
    # ISO-639-3 code matching MMS adapter naming (ukr, eng, rus, deu, fra, ...).
    # Each language has its own bundle dir because the LM head and adapter
    # weights are merged into the compiled graph at AI Hub time.
    voice_stt_mms_lang: str = "ukr"
    # Parent dir for per-language bundles. Resolver looks for
    # <bundle_dir>/mms-<lang>-qnn/ first, falls back to project-rooted paths.
    voice_stt_mms_bundle_dir: str = "src/backend/voice/models"
    # Quantisation regime baked into the .bin. INT8 is the standard HTP
    # recipe; FP16 is left as a knob for V79+ where FP16 HTP is supported.
    voice_stt_mms_compute: Literal["int8", "fp16"] = "int8"
    # When enabled, the dual-tier orchestrator calls Whisper-Turbo
    # (encoder-NPU + decoder-CPU) in the background after MMS emits its
    # instant transcript. If MMS confidence is below this threshold, the
    # turbo result replaces the message via a final_revised event. Same
    # pattern as Phase 13b's vosk→whisper refine, just with NPU on both
    # tiers.
    voice_stt_mms_refine_with_turbo: bool = False
    voice_stt_mms_refine_confidence_min: float = 0.85

    # ── Voice / TTS ───────────────────────────────────────────────────────────
    voice_tts_enabled: bool = True
    voice_tts_voice: str = "uk_UA-ukrainian_tts-medium"
    voice_tts_speed: float = 1.0
    voice_tts_alpha: float = 0.3
    voice_tts_beta: float = 0.7
    voice_tts_diffusion_steps: int = 5
    voice_tts_emotion_scale: float = 1.0
    voice_tts_state_adaptation: bool = True
    voice_wake_words: str = "фантом"
    voice_wake_word_enabled: bool = True
    voice_auto_listen_in_dialogue: bool = True
    # ── Voice / Always-on (Phase 11b) ─────────────────────────────────────────
    # Opt-in. When False the tap-to-talk path is the only way to reach STT.
    voice_always_on_enabled: bool = False
    # Minimum averaged Vosk per-word confidence for a wake match to count.
    voice_wake_confidence_min: float = 0.6
    # After PHANTOM replies, how long we keep the mic "armed" so the user can
    # continue without re-saying the wake word.
    voice_continuation_window_s: int = 10
    # Drop incoming mic frames while PHANTOM is speaking, to avoid self-wakes
    # when TTS audio leaks through the ReSpeaker near-field.
    voice_mic_duck_on_tts: bool = True
    # ── Voice / Modes (Phase 12.0 — VAD-driven voice + optional wake) ────────
    # Replaces voice_always_on_enabled. The old key stays in the schema as a
    # deprecated alias — it is still settable / readable so existing rows
    # don't break startup, but routes_voice_stream.py ignores it at runtime
    # and uses voice_mode instead. Three modes:
    #   "off"        — orchestrator no-op on frames; push-to-talk only.
    #   "continuous" — VAD detects speech → silence_timeout_ms → STT → final.
    #   "wake_word"  — same VAD+STT pipeline but transcripts not containing
    #                  voice_wake_phrase (case-insensitive substring match)
    #                  are silently dropped.
    voice_mode: Literal["off", "continuous", "wake_word"] = "off"
    # Wake phrase used when voice_mode == "wake_word". Case-insensitive
    # substring match against the Whisper transcript; phrase is stripped
    # from the message before chat send.
    voice_wake_phrase: str = "фантом"
    # End-of-utterance silence threshold (ms) used in continuous + wake_word
    # modes. After this much VAD-below-threshold time the buffer is sent to
    # Whisper STT.
    # Phase 12.4 — lowered 1500 → 800. The 1500 default felt unresponsive
    # in conversational use ("speak, then wait two seconds for the reply"),
    # 800 keeps brief intra-sentence pauses safe while turning around fast
    # enough that a back-and-forth chat is workable. Operator can still
    # tune via Settings (allowed range stays [500, 5000]).
    voice_silence_timeout_ms: int = 800

    # Phase 13a.3 — backend energy fast-path skip. When the orchestrator is
    # idle (not inside an utterance) AND the incoming PCM frame's peak
    # amplitude is below this normalised threshold (1.0 = full-scale s16),
    # skip Silero VAD inference entirely. Saves ~80% of idle-time CPU on
    # the event loop's worker thread when client-side VAD is also dropping
    # silence (Phase 13a.2). Set to 0.0 to disable the optimisation.
    # 0.005 ≈ -46 dBFS, well below typical conversational speech levels.
    voice_energy_skip_threshold: float = 0.005

    # ── Phase 13b — Streaming partial transcripts ────────────────────────────
    # When True (default), the always-on orchestrator emits ``partial``
    # events while the user is still speaking, driven by Vosk's native
    # KaldiRecognizer.PartialResult. Frontend renders a "ghost bubble"
    # so the user sees their words appear in real time. False = legacy
    # 12.x behaviour (silence → final-only).
    voice_streaming_partials: bool = True
    # Minimum gap between consecutive ``partial`` events. Vosk can produce
    # a fresh hypothesis every ~50 ms; that flickers in the UI. 200 ms is
    # a compromise between "feels live" and "stable to read".
    voice_partial_debounce_ms: int = 200
    # When True, after the Vosk fast-final has been emitted, run a Whisper
    # pass on the same audio buffer in the background. If the resulting
    # transcript differs from Vosk's by more than the configured ratio,
    # emit a ``final_revised`` event so the chat store can update the
    # already-displayed user message. OFF by default — opt-in advanced.
    voice_refine_with_whisper: bool = False
    # Levenshtein-ratio threshold below which Whisper's transcript is
    # considered "meaningfully different" from Vosk's. 0.85 = ~15%
    # character delta. Only used when voice_refine_with_whisper is True.
    voice_refine_diff_threshold: float = 0.85

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
    # phase-5-R0-3-THEME-NIGHT — three named themes ship with the sunrise
    # redesign. "sunrise-warm" is the bright cream daytime palette,
    # "amber-night" is the deep warm-dark night palette (THEME-NIGHT
    # agent), and "cyberdeck-cold" is the legacy slate look kept as
    # opt-in. The legacy aliases ("dark", "light", "auto") remain in
    # the Literal so persisted settings rows from earlier builds load
    # without rejection — the frontend treats them as "amber-night",
    # "sunrise-warm", and "auto" (prefers-color-scheme) respectively.
    ui_theme: Literal[
        "sunrise-warm",
        "amber-night",
        "cyberdeck-cold",
        "pro-console",
        "dark",
        "light",
        "auto",
    ] = "sunrise-warm"
    ui_density: Literal["compact", "normal", "comfortable"] = "normal"
    # V5 — OPERATOR screen layout mode.
    # 'conversation': conversational surface is primary center; AgentVitals +
    #   Tape demoted to collapsed peek strips.
    # 'telemetry': current dense 3-column layout (Vitals + FocusPanel + Tape).
    ui_agent_layout: Literal["conversation", "telemetry"] = "conversation"
    # Day-4 Wave-2 W-5 (audit U2-ANIM-C2 + U8-PERF): hardware-tier
    # gate. Frontend reads this and disables backdrop-filter / caps
    # animation framerate / drops AmbientGlows when "low" so weaker
    # GPUs (Adreno on cheap Win mini-PCs, integrated Intel) don't jank.
    # Default "mid" matches the Q6A baseline; operators on a fully
    # capable desktop can flip to "high"; CI / VM deploys flip to
    # "low".
    ui_hardware_tier: Literal["low", "mid", "high"] = "low"
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
    security_auto_login: bool = True
    security_session_timeout_m: int = 480
    security_max_pin_attempts: int = 5
    security_lockout_duration_m: int = 15
    security_dangerous_cmd_confirm: bool = True
    security_ghost_auto_encrypt: bool = True
    security_rate_limit_ai: int = 10
    # Day-3 D3-A-2 (audit-2026-04-30 Tier A) — XFF-aware lockout keying.
    #
    # Out of the box `request.client.host` is the immediate TCP peer. When
    # PHANTOM sits behind a reverse proxy (Caddy / Traefik / k8s ingress)
    # that peer is always the proxy, so per-IP lockout collapses every
    # remote attacker into a single `127.0.0.1` key — system-wide DoS
    # amplifier AND no-op against the actual attacker.
    #
    # ``security_trust_xff`` enables right-to-left XFF resolution. Only
    # set this when you control the proxy AND the proxy strips/replaces
    # `X-Forwarded-For` (a malicious client behind an untrusted proxy
    # could otherwise spoof their IP). ``security_trusted_proxies`` is
    # the allowlist of immediate-peer hosts whose XFF the daemon will
    # parse — typically the loopback aliases when the proxy is on the
    # same host, or the bridge gateway IP for a docker network.
    chroma_janitor_at_startup: bool = True
    # Day-3 R-2 (audit-2026-04-30 NEW-OPS-03 / D2-I2): explicit
    # deployment-mode knob so the daemon enforces the multi-tenant
    # invariant in code rather than docs alone. Setting this to
    # ``"multi"`` raises at lifespan startup until per-tenant
    # ``ContextEngine`` ships (Phase 17b D2-I2 invariant). Single-
    # tenant Radxa / single-VM deploys keep the default.
    deployment_mode: Literal["single", "multi"] = "single"
    security_trust_xff: bool = False
    security_trusted_proxies: list[str] = [
        "127.0.0.1", "::1", "localhost",
    ]

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
    # Audit-2026-04-28 F-10c: default tolerance lowered from 5 (MEDIUM) to
    # 3 (LOW). The agent loop now blocks bash.run / net.scan / fs.write
    # by default; operator must explicitly raise the slider in Settings
    # to authorise MEDIUM actions. Mitigates blast radius until the full
    # linux/dangerous_patterns.py blocklist + UI confirm pipeline lands.
    agent_risk_tolerance: int = 7            # caps executable actions: 1/3/5/7
    # Phase 23-D — when True (default), the risk gate consults the Council
    # BEFORE asking the operator (phone or desktop). A "abort"/"revise"
    # verdict short-circuits the prompt, so the operator never even sees a
    # destructive action that the cross-perspective deliberation already
    # rejected. Setting to False restores the pre-23-D path (gate jumps
    # straight to phone/desktop approval). Hot-reloadable.
    agent_council_for_high_risk: bool = True
    # Phase 23-G — distilled "lessons" memory. After every task `done`
    # the runtime extracts a transferable rule (what to do, what to
    # avoid, applicability) and stores it in a dedicated ChromaDB
    # collection. `tactical_plan` + `strategic_plan` retrieve top-K
    # lessons by goal similarity and inject them as system-prompt
    # context. Compounds intelligence across sessions — capability
    # Claude Code / Coworker do NOT have. Hot-reloadable.
    agent_lessons_enabled: bool = True
    agent_lessons_top_k: int = 3
    # Minimum lessons-recall similarity (0..1). Below threshold a
    # lesson is considered too distant to be useful and is dropped
    # from prompt injection so cold-cache prompts stay clean.
    agent_lessons_min_relevance: float = 0.35
    # Phase 26-A — Agent delegation / team fan-out.
    # `agent_max_team_concurrency` caps how many sub-agents (across ALL
    # currently-running parents) can run at once; the team semaphore
    # blocks further spawns when the cap is hit so a delegating loop
    # cannot fork-bomb the runtime. `agent_max_delegation_depth` caps
    # recursion: a sub-agent can itself spawn sub-sub-agents but only
    # up to this depth (default 3 = root → team_lead → senior →
    # ad-hoc reviewer). `agent_default_subagent_timeout_s` is the
    # fallback timeout when the delegate caller doesn't pin one.
    agent_team_enabled: bool = True
    agent_max_team_concurrency: int = 8
    agent_max_delegation_depth: int = 3
    agent_default_subagent_timeout_s: int = 300
    agent_workspace_dir: str = "~/phantom/workspace"
    # Day-4 Wave-2 Y-5 (ADR-SBX-002): default SandboxProfile applied to
    # bash.run + MCP adapter spawns. Closed enum mirrors the
    # `agent.operations.safety.sandbox.SandboxProfile` Python enum (compute |
    # net_observe). `radio_privileged` is intentionally NOT exposed in
    # Settings on Day-4 — it's reserved for the Day-6 BT/Wi-Fi work
    # and toggling it on early would silently re-enable CAP_NET_RAW
    # for every bash.run.
    agent_sandbox_profile_default: Literal["compute", "net_observe"] = "compute"
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
    # V1 limitless — bash caps now config-driven; any cap <=0 means
    # UNBOUND (no timeout / no truncation / no action / no LLM stop).
    # agent_unbound_default is the Settings master toggle that zeroes
    # the action/LLM caps. Sandbox + unsafe_mode are untouched.
    agent_bash_timeout_s: int = 120
    agent_bash_output_cap_bytes: int = 16384
    agent_unbound_default: bool = False
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
    # 2026-05-13 — autonomy switch. When True AND no paired phone has the
    # "approvals" capability, the loop auto-approves risky actions instead
    # of falling back to the desktop intervene queue (which currently waits
    # `agent_user_consent_timeout_s` then rejects). This is what makes a
    # 20+ hour unattended run possible: without it, the very first MEDIUM-
    # risk action burns 300s and dies. Phone-paired path is UNAFFECTED —
    # if a companion is paired the loop still asks the phone and respects
    # the operator's tap. Hot-reloadable via Settings.
    #
    # Default False so a fresh install stays safe by default; the operator
    # toggles it on for autonomous runs (Settings → Agent → Autonomy).
    agent_auto_approve_when_no_companion: bool = False
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
    agent_proactive_interval_max_s: int = 120

    # ── Ambient Guardian (perception → proactive care) ────────────────────────
    ambient_guardian_enabled: bool = True      # watch env/system/body, warn user
    ambient_guardian_interval_s: int = 60      # rule-scan cadence
    ambient_aqi_unhealthy: int = 150           # AQI ≥ → unhealthy warning
    ambient_aqi_hazardous: int = 200           # AQI ≥ → hazardous warning
    ambient_temp_hot_c: float = 32.0
    ambient_temp_cold_c: float = 0.0
    ambient_pressure_drop_hpa: float = 3.0     # drop since last tick → storm
    ambient_disk_full_pct: float = 92.0
    ambient_cpu_high_pct: float = 92.0
    ambient_stress_high: float = 0.7
    ambient_late_hour_start: int = 2           # deep-night-awake window (local)
    ambient_late_hour_end: int = 5

    # ── Will Engine (sub-project A) ───────────────────────────────────────────
    will_enabled: bool = False                 # master kill switch
    will_tick_interval_s: int = 300            # 5-min deliberation cadence
    will_daily_llm_calls: int = 200            # daily budget — LLM calls
    will_daily_token_cap: int = 300_000        # daily budget — tokens
    will_reflect_hour_local: int = 4           # daily self-generation hour (local)
    will_max_active_day_goals: int = 3         # anti-sprawl on the DAY horizon
    will_max_active_goals: int = 20            # anti-sprawl on the WHOLE tree —
    #   once the tree has this many active goals, orient() stops decomposing so
    #   budget flows to action (decide) instead of endless planning.
    agent_proactive_cooldown_s: int = 90
    agent_proactive_long_silence_threshold_min: int = 30
    agent_proactive_require_recent_chat: bool = False
    # Phase 9.3b — standing orders (persistent triggers). Runner checks every
    # `agent_standing_orders_poll_s` seconds; disabled by default so nothing
    # fires without operator opt-in. Hot-reloadable.
    agent_standing_orders_enabled: bool = True
    agent_standing_orders_poll_s: int = 10
    # Day-4 Wave-2 T-1 (ADR-SOH-001): lease TTL for standing-order
    # crash recovery. After this many seconds the
    # `recover_stale_leases()` startup pass treats a lingering
    # `in_flight_task_id` as orphaned and reconciles via
    # agent.runtime.task_status. Default 5 minutes — generous for
    # cron/interval headroom yet short enough that boot recovery is
    # immediate (we run reconcile at runner.start, not just by TTL).
    agent_standing_orders_lease_ttl_s: int = 300
    # Phase 9.3b — inner monologue channel rate limit (events per second).
    agent_monologue_rate_limit_eps: int = 10
    agent_reflection_every_n_actions: int = 5
    # V4 — self-synthesizing capability. Max new Action subclasses the agent
    # may author+sandbox-test+register within a SINGLE task. 0 = disabled.
    # Each synthesis costs 1 LLM call + 1 sandbox smoke run. Default 3 is a
    # conservative ceiling that allows real tool-gap filling without runaway.
    agent_synth_max_per_task: int = 3
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
    voice_tts_voice_uk: str = "uk_UA-ukrainian_tts-medium"
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
    # The Overpass public mirror blocks httpx's default User-Agent with
    # HTTP 406 Not Acceptable, so we must send an identifiable UA string
    # (same policy as Nominatim).
    agent_overpass_enabled: bool = True
    agent_overpass_cache_ttl_s: int = 24 * 3600
    agent_overpass_user_agent: str = "PHANTOM-OS/0.9 (localhost)"
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

    # ── Routing (Phase 24-C) ─────────────────────────────────────────────────
    # BRouter — offline routing in a local Docker sidecar, first in the
    # adapter chain. The Radxa is the canonical home of this; tests +
    # CI machines just leave it disabled or unreachable, which is fine
    # because the facade falls through to ORS / OSRM.
    routing_brouter_enabled: bool = True
    routing_brouter_url: str = "http://localhost:17777"
    # OpenRouteService — online API, key required. Set via Settings UI.
    routing_ors_enabled: bool = True
    routing_ors_api_key: str = ""
    # OSRM — public demo (rate-limited) or self-host. Last fallback.
    routing_osrm_enabled: bool = True
    routing_osrm_url: str = "https://router.project-osrm.org"
    routing_default_profile: str = "car"

    # ── Chat observability (Phase 16, audit-2026-04-28 step 4) ────────────────
    # Off by default — chat content is sensitive, operator opts in via UI.
    # When enabled, every chat turn writes a row to ai_tool_use_log with
    # truncated system prompt, user message, AI response, plus a
    # comma-separated `prompt_sections` flag for ops dashboards.
    chat_prompt_logging_enabled: bool = False
    chat_prompt_excerpt_max_chars: int = 800

    # ── Chat tool-use (Phase 17a, audit-2026-04-28 F-01) ──────────────────────
    # The chat path can call data-fetching tools (search_locationhistory,
    # query_temporal_anchors, recall_memory_facts, get_system_metrics,
    # get_sensor_status) before answering. Default stays OFF: ordinary
    # chat should behave like a calm professional assistant and use the
    # memory/context already hydrated into the prompt. Operators can opt
    # in when they want extra read-only grounding. Risky/mutating
    # autonomy still flows through the agent approval gates.
    chat_tools_enabled: bool = False
    # Rich response widgets (`respond_chart`, `respond_map`,
    # `respond_artifact`, etc.) are a separate opt-in from data tools.
    # Keeping them off by default prevents normal conversation from
    # turning into half-built UI cards while preserving the catalog for
    # labs/demo deployments that explicitly enable it.
    chat_response_widgets_enabled: bool = True
    # Day-4 Wave-2 X-1 (ADR-ORC-001): orchestrator scaffold flag. When
    # OFF (default), routes_chat calls chat_pipeline.run unchanged —
    # back-compat invariant preserved. When ON AND the active provider
    # is Gemini, the orchestrator becomes the entry point (single-turn
    # only on Day-4; parallel-K fan-out lands in X-3/X-4). Ollama path
    # always falls through to chat_pipeline.run regardless of the flag
    # because the Ollama tool-use path string-concats FunctionResponse
    # JSON and re-spawns the TM-17B-S1 nonce-injection threat.
    chat_orchestrator_enabled: bool = False
    chat_orchestrator_max_subagents: int = 3
    chat_orchestrator_per_subagent_ms: int = 3500
    chat_orchestrator_merge_reserve_ms: int = 1500
    chat_tool_locationhistory_limit: int = 20
    chat_tool_anchors_limit: int = 30
    chat_tool_max_calls_per_turn: int = 5
    # Day-2 D2-D1: per-call wall-clock cap for one chat-tool dispatch.
    # tool_executor's own asyncio.wait_for already covers the SQL/IO path;
    # this is the dispatcher-layer fallback that fires if a delegate
    # mock-installed by tests or by future call_with_tools paths hangs
    # outside tool_executor. 30 s mirrors TOOL_TIMEOUT_S so legitimate
    # chroma + nominatim retries can complete; tighten to 5 s if the
    # tier-D wall-clock budget pressure forces it.
    chat_tool_call_timeout_s: float = 30.0
    # Day-2 PERF-17b: per-turn wall-clock ceiling for the entire chat
    # tool-use loop (sum of all iterations: LLM ⇄ tool ⇄ LLM …). 4
    # iterations × Gemini ~2.1 s p50 = 8.4 s typical; p99 reaches 25 s
    # without a cap. Phase 17b's call_with_tools loop must abort and
    # surface the last-good response when this is exceeded — Tier D's
    # chat_pipeline.py reads this before each iteration. 60 s leaves
    # headroom over the typical case while keeping p99 within the
    # tolerable chat-turn budget.
    chat_tool_max_total_ms: int = 60_000
    chat_artifacts_enabled: bool = True
    chat_artifact_html_cap_bytes: int = 262144
    ai_artifact_model: str = "gemini-2.0-flash"
    ai_artifact_max_tokens: int = 32768
    ai_artifact_max_revisions: int = 2
    # Strategic/reflector planner needs reliable strict-JSON.
    ai_planner_model: str = "gemini-2.0-flash"
    ai_planner_max_tokens: int = 8192

    # Day-2 (audit-2026-04-29 Tier E): structured JSON log output.
    # Defaults to off so local-dev keeps the human-readable line format
    # (`HH:MM:SS [host] [LEVEL] logger: message`); production deploys
    # flip this on so journal/Loki/CloudWatch pipelines get parsable
    # rows with correlation_id surfaced as a top-level field. Wired in
    # main.py lifespan after the standard reconfigure; idempotent.
    log_json_enabled: bool = False

    # ── System ────────────────────────────────────────────────────────────────
    system_hostname: str = "phantom"
    system_sensor_log_retention_days: int = 7
    system_backup_interval_h: int = 24
    system_temporal_anchor_interval_s: int = 300

    def apply_overrides(self, overrides: dict[str, Any]) -> None:
        """
        In-place mutate config fields. Values that fail Pydantic validation are
        skipped (kept as the existing value) so a single bad override can't
        crash startup. Failures are logged at WARNING (audit-2026-04-28 F-38);
        previously they were swallowed silently, so a malformed PUT/import
        was reported as accepted while the value silently rolled back.

        Persistence is handled separately by `db.settings_repo.save(...)`.
        """
        for key, value in overrides.items():
            key_attr = key.replace(".", "_")
            if not hasattr(self, key_attr):
                _logger.warning(
                    "config.apply_overrides: unknown key %r — skipped", key
                )
                continue
            try:
                setattr(self, key_attr, value)
            except Exception as exc:
                _logger.warning(
                    "config.apply_overrides: rejected %s=%r — %s",
                    key_attr, value, exc,
                )

    # Back-compat alias — the old name lied (it never touched the DB).
    apply_db_overrides = apply_overrides

    # ── Cross-field validators (Phase 9.4c audit §7) ─────────────────────────
    @field_validator("debug", mode="before")
    @classmethod
    def _coerce_debug_env(cls, value: Any) -> Any:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production"}:
                return False
            if normalized in {"dev", "development"}:
                return True
        return value

    @model_validator(mode="after")
    def _validate_provider_distinction(self) -> "PhantomConfig":
        """Primary and fallback AI providers must differ unless fallback is
        explicitly 'none'. Routing falls through silently if the two match,
        masking outages as successful calls."""
        if (
            self.ai_fallback_provider != "none"
            and self.ai_primary_provider == self.ai_fallback_provider
        ):
            raise ValueError(
                f"ai_primary_provider and ai_fallback_provider cannot both be "
                f"{self.ai_primary_provider!r}. Set ai_fallback_provider to "
                f"'none' or pick a distinct provider."
            )
        return self

    @model_validator(mode="after")
    def _validate_proactive_interval(self) -> "PhantomConfig":
        """The proactive loop uses a randomised interval in
        [min_s, max_s]; zero would either busy-loop or hang depending on
        asyncio semantics."""
        if self.agent_proactive_enabled and self.agent_proactive_interval_min_s <= 0:
            raise ValueError(
                "agent_proactive_interval_min_s must be > 0 when "
                "agent_proactive_enabled is True"
            )
        if self.agent_proactive_enabled and self.agent_proactive_interval_max_s < self.agent_proactive_interval_min_s:
            raise ValueError(
                "agent_proactive_interval_max_s must be >= agent_proactive_interval_min_s"
            )
        return self

    @model_validator(mode="after")
    def _validate_voice_mode_keys(self) -> "PhantomConfig":
        """Phase 12.0 — keep the three new mode-related keys self-consistent.
        voice_wake_phrase must be non-empty + ≤ 50 chars, and the silence
        timeout must lie in 500..5000 ms so the orchestrator never waits
        forever (or fires after a single inter-word pause)."""
        phrase = (self.voice_wake_phrase or "").strip()
        if not phrase:
            raise ValueError("voice_wake_phrase must be non-empty")
        if len(phrase) > 50:
            raise ValueError("voice_wake_phrase must be ≤ 50 characters")
        if not (500 <= self.voice_silence_timeout_ms <= 5000):
            raise ValueError(
                "voice_silence_timeout_ms must be in [500, 5000] (got "
                f"{self.voice_silence_timeout_ms})"
            )
        # Phase 13b — partial debounce + refine threshold bounds.
        if not (50 <= self.voice_partial_debounce_ms <= 1000):
            raise ValueError(
                "voice_partial_debounce_ms must be in [50, 1000] (got "
                f"{self.voice_partial_debounce_ms})"
            )
        if not (0.0 <= self.voice_refine_diff_threshold <= 1.0):
            raise ValueError(
                "voice_refine_diff_threshold must be in [0.0, 1.0] (got "
                f"{self.voice_refine_diff_threshold})"
            )
        # Phase 15b — MMS bundle keys.
        lang = (self.voice_stt_mms_lang or "").strip().lower()
        if not lang or not lang.isascii() or not (2 <= len(lang) <= 5):
            raise ValueError(
                "voice_stt_mms_lang must be a 2-5 char ASCII code (e.g. 'ukr', "
                f"'eng', 'rus'); got {self.voice_stt_mms_lang!r}"
            )
        if not (0.0 <= self.voice_stt_mms_refine_confidence_min <= 1.0):
            raise ValueError(
                "voice_stt_mms_refine_confidence_min must be in [0.0, 1.0] "
                f"(got {self.voice_stt_mms_refine_confidence_min})"
            )
        return self

    @model_validator(mode="after")
    def _validate_tts_voice(self) -> "PhantomConfig":
        """voice_tts_enabled=True with an empty voice_tts_voice would crash
        the pipeline the first time the operator sends a speak command."""
        if self.voice_tts_enabled and not self.voice_tts_voice.strip():
            raise ValueError(
                "voice_tts_voice must be non-empty when voice_tts_enabled is True"
            )
        return self

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
