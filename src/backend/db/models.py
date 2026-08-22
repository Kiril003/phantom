"""
SQLAlchemy ORM Models — PHANTOM OS
All tables with columns and relations.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ── Tenants (SaaS Multi-tenancy) ───────────────────────────────────────────────

class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    users: Mapped[list["User"]] = relationship(
        "User", back_populates="tenant", cascade="all, delete-orphan"
    )

# ── Users ──────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="GUEST")
    tenant_role: Mapped[str] = mapped_column(String(32), default="Member")
    rfid_uid_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    pin_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    # JSON-stored sub-objects (serialized as text)
    preferences_json: Mapped[str] = mapped_column(Text, default="{}")
    behavioral_model_json: Mapped[str] = mapped_column(Text, default="{}")

    # Relations
    tenant: Mapped[Optional["Tenant"]] = relationship("Tenant", back_populates="users")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(
        "ChatSession", back_populates="user", cascade="all, delete-orphan"
    )
    memory_facts: Mapped[list["MemoryFact"]] = relationship(
        "MemoryFact", back_populates="user", cascade="all, delete-orphan"
    )
    temporal_anchors: Mapped[list["TemporalAnchor"]] = relationship(
        "TemporalAnchor", back_populates="user", cascade="all, delete-orphan"
    )
    map_pois: Mapped[list["MapPOI"]] = relationship(
        "MapPOI", back_populates="user", cascade="all, delete-orphan"
    )
    profiles: Mapped[list["Profile"]] = relationship(
        "Profile", back_populates="user", cascade="all, delete-orphan"
    )
    agent_tasks: Mapped[list["AgentTask"]] = relationship(
        "AgentTask", back_populates="user", cascade="all, delete-orphan"
    )
    agent_audit: Mapped[list["AgentAuditEntry"]] = relationship(
        "AgentAuditEntry", back_populates="user", cascade="all, delete-orphan"
    )
    agent_checkpoints: Mapped[list["AgentCheckpoint"]] = relationship(
        "AgentCheckpoint", back_populates="user", cascade="all, delete-orphan"
    )
    agent_memory_seeds: Mapped[list["AgentMemorySeed"]] = relationship(
        "AgentMemorySeed", back_populates="user", cascade="all, delete-orphan"
    )
    agent_feedback: Mapped[list["AgentFeedback"]] = relationship(
        "AgentFeedback", back_populates="user", cascade="all, delete-orphan"
    )
    core_narratives: Mapped[list["CoreNarrativeLog"]] = relationship(
        "CoreNarrativeLog", back_populates="user", cascade="all, delete-orphan"
    )
    curiosity_questions: Mapped[list["CuriosityQuestion"]] = relationship(
        "CuriosityQuestion", back_populates="user", cascade="all, delete-orphan"
    )


# ── Profiles (companion-v2 multi-identity) ─────────────────────────────────────
#
# Each User can carry several Profile rows — sub-identities used by the
# companion-android v2 client to switch between operator personas without
# re-authenticating. The desktop continues to talk to a single User (the
# primary RBAC subject); the phone subscribes to a specific Profile so WS
# broadcasts can be partitioned per-persona for users who share a single
# device tree (family / roommates).
#
# Phase 1-B (companion-v2) adds:
#   • this Profile table
#   • PairedDevice.profile_id (nullable FK, SET NULL on delete) — every
#     paired phone binds to one profile per pair claim
#   • migrations/011_user_profiles.py — idempotent CREATE TABLE +
#     ALTER COLUMN guarded by PRAGMA introspection + Primary backfill
#
# Why role lives on Profile instead of just User: the companion native v2
# expects each profile to assert its own ROOT/OPERATOR/GUEST level so a
# guest profile under a ROOT user cannot mint ROOT-only verbs. The User-
# level role stays as the device-trust ceiling for the desktop login.

class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = (
        Index("ix_profiles_user", "user_id"),
        UniqueConstraint(
            "user_id", "display_name", name="uq_profiles_user_display_name"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="OPERATOR")
    avatar_uri: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_now, nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime, default=_now, onupdate=_now, nullable=False
    )
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    behavioral_model_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="profiles")


# ── Chat ───────────────────────────────────────────────────────────────────────

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    state_history_json: Mapped[str] = mapped_column(Text, default="[]")

    user: Mapped["User"] = relationship("User", back_populates="chat_sessions")
    messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user/assistant/system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    response_form: Mapped[str] = mapped_column(String(32), default="text")
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    attachments_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    # MIGRATION_NOTE: speaker_user_id added Day-4 (Block ID-3 / ADR-ID-004).
    # Day-4 leaves it NULL forever — Day-5 ML resolver populates it from
    # `STTResult.speaker_id`. Index is implicit via `index=True`. The
    # column is NULLABLE because most messages (text input, voice with
    # no enrolled match) won't carry a speaker. Migration:
    # `db/migrations/006_chat_message_speaker_user_id.py`.
    speaker_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"),
        nullable=True,
        index=True,
        default=None,
    )

    session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="messages")


# ── Memory ─────────────────────────────────────────────────────────────────────

class MemoryFact(Base):
    __tablename__ = "memory_facts"
    # Phase 9.4c audit B2 — composite index accelerates the common
    # "facts near me" query in `memory.geo_query.get_facts_near_user`
    # which filters on (user_id, place_lat, place_lon) simultaneously.
    __table_args__ = (
        Index("ix_memory_facts_user_geo", "user_id", "place_lat", "place_lon"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    layer: Mapped[str] = mapped_column(String(16), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    embedding_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    source_session_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    accessed_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    is_sealed: Mapped[bool] = mapped_column(Boolean, default=False)
    decay_factor: Mapped[float] = mapped_column(Float, default=1.0)
    # Phase 12.0 — temporal cognitive memory fields
    valid_from: Mapped[datetime] = mapped_column(DateTime, default=_now)
    valid_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    superseded_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    entity_slot: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    sentiment_score: Mapped[float] = mapped_column(Float, default=0.0)
    # Phase 9.4b — memory-to-geo bridge. When a fact mentions or is attached
    # to a place, these carry the geocoded coordinates + provenance. All
    # nullable so prior facts keep working without backfill.
    place_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    place_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    place_lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    place_source: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    place_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="memory_facts")


class TemporalAnchor(Base):
    __tablename__ = "temporal_anchors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_now)
    lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    place_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    activity_summary: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    mood: Mapped[str] = mapped_column(String(64), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="temporal_anchors")


class CoreNarrativeLog(Base):
    __tablename__ = "core_narrative_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    diff_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    user: Mapped["User"] = relationship("User", back_populates="core_narratives")


class CuriosityQuestion(Base):
    __tablename__ = "curiosity_queue"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)  # pending | asked | skipped
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    user: Mapped["User"] = relationship("User", back_populates="curiosity_questions")


# ── Wardriving ─────────────────────────────────────────────────────────────────

class WardrivingRecord(Base):
    __tablename__ = "wardriving_records"
    __table_args__ = (UniqueConstraint("mac", "lat_rounded", "lon_rounded"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mac: Mapped[str] = mapped_column(String(17), nullable=False)
    ssid: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    rssi: Mapped[int] = mapped_column(Integer, nullable=False)
    encryption: Mapped[str] = mapped_column(String(32), nullable=False)
    channel: Mapped[int] = mapped_column(Integer, nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    lat_rounded: Mapped[float] = mapped_column(Float, nullable=False)
    lon_rounded: Mapped[float] = mapped_column(Float, nullable=False)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    seen_count: Mapped[int] = mapped_column(Integer, default=1)


class LocationHistory(Base):
    """Phase 9.4b — persistent location log driven by the resolver.

    Writer appends an entry only when the user has moved > N metres OR
    N minutes have elapsed since the last entry. Reverse-geocode enricher
    lazily populates ``place_name``/``country`` on a cadence that respects
    Nominatim's 1 req/s policy. Retention: 90 days by default.
    """
    __tablename__ = "location_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    accuracy_m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    place_name: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    country_code: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class MapPOI(Base):
    __tablename__ = "map_pois"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="custom")
    notes: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(64), default="📍")
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    user: Mapped["User"] = relationship("User", back_populates="map_pois")


# ── Settings ───────────────────────────────────────────────────────────────────

class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


# ── State Log ──────────────────────────────────────────────────────────────────

class StateTransitionLog(Base):
    __tablename__ = "state_transitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_state: Mapped[str] = mapped_column(String(16), nullable=False)
    to_state: Mapped[str] = mapped_column(String(16), nullable=False)
    trigger: Mapped[str] = mapped_column(String(256), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_now)
    auto: Mapped[bool] = mapped_column(Boolean, default=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


# ── Sensor Timeseries (7d rotation) ───────────────────────────────────────────

class SensorLog(Base):
    __tablename__ = "sensor_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    # Radar
    radar_present: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    radar_motion_energy: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    radar_static_energy: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    radar_distance_cm: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    radar_breath_bpm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # GPS
    gps_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gps_lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gps_fix: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    gps_speed_kmh: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Environment
    env_temp_c: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    env_pressure_hpa: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    env_aqi: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


# ── Tools ──────────────────────────────────────────────────────────────────────

class Timer(Base):
    __tablename__ = "timers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    label: Mapped[str] = mapped_column(String(256), nullable=False)
    duration_s: Mapped[int] = mapped_column(Integer, nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    fired: Mapped[bool] = mapped_column(Boolean, default=False)


class Alarm(Base):
    __tablename__ = "alarms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    label: Mapped[str] = mapped_column(String(256), nullable=False)
    time_str: Mapped[str] = mapped_column(String(5), nullable=False)  # "HH:MM"
    repeat: Mapped[str] = mapped_column(String(16), nullable=False)  # daily/weekdays/once
    next_trigger: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    location: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ── Ghost Records (encrypted references) ──────────────────────────────────────

class GhostRecord(Base):
    __tablename__ = "ghost_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    encrypted_path: Mapped[str] = mapped_column(String(512), nullable=False)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ── Agent — Phase 9.1 Cognitive Seed ──────────────────────────────────────────

class AgentTask(Base):
    __tablename__ = "agent_tasks"
    __table_args__ = (Index("ix_agent_tasks_user", "user_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="agent_tasks")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="planning")
    track: Mapped[str] = mapped_column(String(16), nullable=False, default="foreground")
    sub_goals_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    observations_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    self_model_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    thought_budget_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    paused_reason: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Block A-1 — full TaskState snapshot for crash recovery. When present,
    # rehydrate_task() uses this in preference to the per-column blobs above.
    # NULL on rows created before Block A-1 shipped; legacy fallback path in
    # rehydrate.py reads the column blobs instead.
    # Also carries the mission_id FK so rehydrate can skip a join.
    runtime_snapshot_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    mission_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)


class AgentAuditEntry(Base):
    __tablename__ = "agent_audit"
    __table_args__ = (Index("ix_agent_audit_user", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    task_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="agent_audit")
    step_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    sub_goal_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    action_name: Mapped[str] = mapped_column(String(64), nullable=False)
    args_json: Mapped[str] = mapped_column(Text, default="{}")
    intent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    monologue_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    risk_level: Mapped[int] = mapped_column(Integer, default=1)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    retried_from: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class AgentCheckpoint(Base):
    __tablename__ = "agent_checkpoints"
    __table_args__ = (Index("ix_agent_checkpoints_user", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    task_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="agent_checkpoints")
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class AgentMemorySeed(Base):
    """Bridge to future episodic memory — SQL LIKE search this phase, ChromaDB later."""
    __tablename__ = "agent_memory_seeds"
    __table_args__ = (Index("ix_agent_memory_seeds_user", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    task_id: Mapped[str] = mapped_column(String(36), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="agent_memory_seeds")
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    key_actions: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class AgentFeedback(Base):
    __tablename__ = "agent_feedback"
    __table_args__ = (Index("ix_agent_feedback_user", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="agent_feedback")
    audit_entry_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    rating: Mapped[str] = mapped_column(String(16), nullable=False)  # up | down | comment
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ── AI tool-use telemetry (Phase 9.2) ─────────────────────────────────────────


class AiToolUseLog(Base):
    """One row per call_with_tools attempt — used to tune provider routing."""
    __tablename__ = "ai_tool_use_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(36), index=True, nullable=True)
    step_idx: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    tool_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error_kind: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    retry_count: Mapped[int] = mapped_column(Integer, default=1)
    # Phase 9.2.1 — resilience telemetry. retry_after_s captures the
    # Retry-After hint Google returns on 429s; fell_through_to_fallback marks
    # rows produced by the fallback provider after primary was exhausted;
    # cooling_triggered marks rows where the router put the provider into
    # cooldown immediately after this attempt.
    retry_after_s: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fell_through_to_fallback: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    cooling_triggered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Phase 16 (audit-2026-04-28 step 4) — per-chat-turn observability.
    # Populated only when chat_prompt_logging_enabled is on; truncated to
    # chat_prompt_excerpt_max_chars before write so we never persist the
    # full user message / AI response. user_id is indexed so operator
    # dashboards can scope queries per-tenant.
    user_id: Mapped[Optional[str]] = mapped_column(String(36), index=True, nullable=True)
    prompt_excerpt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    response_excerpt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prompt_sections: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    # Day-2 D2-R1 (audit-2026-04-29) — chat-tool audit completeness.
    # Populated by the chat_tool_dispatcher path on every dispatch attempt
    # (success and failure both). tool_args_json is the LLM's argument
    # dict serialised + truncated; tool_result_summary is a short
    # operator-readable verdict ("ok rows=12", "error invalid_args").
    tool_args_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tool_result_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


# ── Standing orders (Phase 9.3b) ─────────────────────────────────────────────


class StandingOrder(Base):
    """
    Persistent user-defined trigger. `kind` selects a schedule flavour:
      - "interval"        — run every N seconds (every_s)
      - "cron"            — cron expression via croniter (minute/hour/day)
      - "conditional"     — eval a simple DSL condition on a cadence
      - "one_shot_future" — fire once at a specific datetime
    Goals are plain strings turned into foreground agent tasks when fired;
    the runner declines to preempt an active user-initiated task.
    """
    __tablename__ = "standing_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(256), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    schedule_json: Mapped[str] = mapped_column(Text, nullable=False)
    action_json: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    last_fired_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    fire_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_outcome: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Day-4 Wave-2 T-1 (ADR-SOH-001): lease columns. The runner's
    # `_fire_order` claims a row via atomic UPDATE WHERE
    # in_flight_task_id IS NULL; release happens via task_status
    # reconciliation (SOH-002). Both default NULL so existing rows +
    # tests stay byte-compatible (Day-3 contract preserved).
    in_flight_task_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True, index=True
    )
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Day-4 Wave-2 T-2 (ADR-SOH-003): denormalised action kind for
    # fast filtering (operator console, per-kind metrics) and for the
    # Day-5 dispatcher's match-table on kind. action_json continues
    # to hold the full payload; this column is populated on POST +
    # backfilled by migration 009 (legacy {"goal": "..."} → "task").
    action_kind: Mapped[Optional[str]] = mapped_column(
        String(16), nullable=True, index=True
    )

# Day-4 Wave-2 FACTS-1 (ADR-FCT-001): UserFact ORM (closes U6-ID-* class)
# - Profile facts (email, phone, telegram, discord, file_pointer) attached
#   to a User. `value_encrypted` holds a Fernet token from
#   `security.crypto.encrypt_pii`; raw plaintext is never persisted.
# - Composite index (user_id, category) accelerates 'all phones for user X'.
# - ondelete=CASCADE: deleting a User vacates their facts.

class UserFact(Base):
    __tablename__ = "user_facts"
    __table_args__ = (
        Index("ix_user_facts_user_category", "user_id", "category"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    value_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    # V11 — operator trust gate: when True this fact is filtered out of all
    # LLM/planner prompts but remains visible in IntelligenceHub for un-exclude.
    # Migration: db/migrations/015_user_facts_exclude_flag.py
    exclude_from_prompts: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )


# ── Phase 17b — Agent Studio (CustomAgent / cards / runs) ────────────────────


class CustomAgentRow(Base):
    """A user-saved autonomous agent built from cards."""
    __tablename__ = "custom_agents"
    __table_args__ = (Index("ix_custom_agents_owner", "owner_user_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    avatar: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    goal_template: Mapped[str] = mapped_column(Text, default="")
    inputs_schema_json: Mapped[str] = mapped_column(Text, default="[]")
    cards_json: Mapped[str] = mapped_column(Text, default="[]")
    links_json: Mapped[str] = mapped_column(Text, default="[]")
    recipients_json: Mapped[str] = mapped_column(Text, default="[]")
    schedule_json: Mapped[str] = mapped_column(Text, default="{}")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    success_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class CustomAgentRunRow(Base):
    """One execution of a CustomAgent — links to the agent_runtime task."""
    __tablename__ = "custom_agent_runs"
    __table_args__ = (
        Index("ix_custom_agent_runs_agent", "agent_id"),
        Index("ix_custom_agent_runs_task", "task_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    agent_id: Mapped[str] = mapped_column(String(36), nullable=False)
    task_id: Mapped[str] = mapped_column(String(36), nullable=False)
    inputs_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    triggered_by: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


# ── Phase 19 — Mobile Companion ──────────────────────────────────────────────
#
# Pairing protocol (X25519 ECDH + Ed25519 long-term + HMAC-SHA256 proofs)
# lives in `security/pair_crypto.py`. Tables here are the *persistent* outputs:
#
#   PairedDevice            — one row per claimed device (long-term Ed25519
#                             pubkey, owning user, audit timestamps, revocation).
#   MobileSensorBatch       — append-only log of mobile sensor packets received
#                             via POST /sensors/mobile_batch. Used by the same
#                             ContextEngine pipeline that ingests ESP32 data;
#                             stored here for audit + replay + offline catch-up.
#   MobileApprovalRequest   — push-driven ROOT-tier approval gate (Phase 19
#                             approve-on-phone). Agent runtime creates a row,
#                             phone signs response, runtime resumes with the
#                             verdict.
#
# Ephemeral pairing sessions live in-memory in `pair_crypto._sessions` (60 s
# TTL per design §4) — not persisted because a restart cancels them anyway
# and PII (server private ECDH key) MUST NOT touch disk.


class PairedDevice(Base):
    __tablename__ = "paired_devices"
    __table_args__ = (
        Index("ix_paired_devices_user", "user_id"),
        Index("ix_paired_devices_active", "user_id", "revoked_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Phase 1-B (companion-v2) — per-Profile binding. NULL on legacy rows
    # until the backfill pass runs (see migrations/011_user_profiles.py).
    # FK uses SET NULL on profile delete so we never hard-delete a paired
    # device row by surprise; revocation stays explicit.
    profile_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Display
    device_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    device_model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    platform: Mapped[str] = mapped_column(String(16), nullable=False, default="android")
    platform_version: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    # Crypto
    device_pub_ed25519: Mapped[str] = mapped_column(String(128), nullable=False)
    # Lifecycle
    paired_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime, default=_now, onupdate=_now, nullable=False
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    revoked_reason: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    # Capability flags (JSON-encoded set: ["sensors","approvals","comms",...])
    capabilities_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)


class MobileSensorBatch(Base):
    __tablename__ = "mobile_sensor_batches"
    __table_args__ = (
        Index("ix_mobile_sensor_batches_device_ts", "device_id", "received_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(
        ForeignKey("paired_devices.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    # Original device timestamp (ms since epoch) — keep so we can detect
    # offline-buffered batches that arrive late.
    device_ts_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Geo + motion + RF (all optional — phone may carry only some sensors)
    gps_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gps_lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gps_accuracy_m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    motion_class: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    mic_rms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    body_bpm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    body_hrv: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # BLE/WiFi observations are arrays — keep raw JSON. ContextEngine bridge
    # opportunistically forwards each WiFi entry to wardriving.collector.
    ble_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    wifi_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)


class MobileApprovalRequest(Base):
    """Phase 19 approve-on-phone gate.

    Lifecycle:
      pending → (phone signs)  → approved | denied
      pending → (timeout)      → expired
      pending → (operator UI)  → cancelled
    Nonce is a 16-byte b64 random string the phone signs together with
    `request_id || verdict` using its long-term Ed25519 device key.
    """
    __tablename__ = "mobile_approval_requests"
    __table_args__ = (
        Index("ix_mobile_approval_pending", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    device_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    action_name: Mapped[str] = mapped_column(String(64), nullable=False)
    risk_level: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    summary: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    nonce_b64: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    verdict: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    signature_b64: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


# ── Phase 25-A — Personal Vault (encrypted info cards) ───────────────────────


class VaultCard(Base):
    """Phase 25-A — encrypted personal info card.

    Each card belongs to one user and groups related fields (e.g. one
    `email_account` card holds provider, address, password, app_password).
    `fields_json` stores a dict where each value is either:

        {"v": "<plaintext>", "secret": false}       ← visible to AI
        {"v": "<base64-aead-token>", "secret": true} ← AES-256-GCM
                                                        token via
                                                        security/vault_crypto

    AI sees label + tags + non-secret fields by default. Secret fields
    require an explicit `vault.reveal` call (Council pre-approval +
    phone biometric) OR `vault.use` which injects the secret directly
    into a downstream action's args without ever returning plaintext to
    the LLM context window.
    """
    __tablename__ = "vault_cards"
    __table_args__ = (
        Index("ix_vault_cards_owner_kind", "owner_user_id", "kind"),
        Index("ix_vault_cards_active", "owner_user_id", "deleted_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Closed enum mirrors the FE card editors. Storage is a string so
    # adding a new kind doesn't require a schema migration; the FE +
    # routes layer enforces the closed set.
    # Known kinds: email_account, service_login, messenger, phone,
    # company, payment_method, api_key, document, contact, wifi_network,
    # crypto_wallet, custom.
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    fields_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    tags_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    # When False, AI tools may read but never write the card. Operator-
    # owned cards (e.g. master credentials) flip this off.
    ai_writable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Soft-delete with 30d undo window — see VaultAuditEntry for the
    # audit trail. Hard delete happens via a nightly job in 25-B.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_now, onupdate=_now, nullable=False
    )
    # Last time ANY field on this card was read (revealed or used). Lets
    # the FE highlight stale cards and powers an "AI accessed this
    # 2 hours ago" hint in the audit timeline.
    last_accessed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True
    )


# ── Phase 25-B — Vault Audit Log ─────────────────────────────────────────────


class VaultAuditEntry(Base):
    """Append-only audit trail for all vault card operations.

    Populated by routes_vault._record_audit and tool_executor vault actions.
    Actions: create, update, delete, restore, reveal, use.
    actor: "user" | "ai" — who initiated the action.
    details_json: arbitrary dict with action-specific context.
    """
    __tablename__ = "vault_audit"
    __table_args__ = (
        Index("ix_vault_audit_card", "card_id"),
        Index("ix_vault_audit_user_action", "user_id", "action"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # card_id may be NULL for bulk/user-level audit rows
    card_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    actor: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    details_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_now, nullable=False, index=True
    )


# ── Will Engine (Phase 28) ───────────────────────────────────────────────────


class DriveState(Base):
    """Persistent state of the 7 fundamental drives (Will Engine v1).
    Curiosity, Mastery, Autonomy, Relatedness, Achievement, Security, Beauty.
    """
    __tablename__ = "drive_state"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # The drive name (e.g. "curiosity")
    name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    current_level: Mapped[float] = mapped_column(Float, default=0.5)
    baseline: Mapped[float] = mapped_column(Float, default=0.5)
    decay_rate: Mapped[float] = mapped_column(Float, default=0.01)
    pressure_rate: Mapped[float] = mapped_column(Float, default=0.01)
    last_satisfied_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class PersistentGoal(Base):
    """Multi-horizon goal stack (Vision/Year/Quarter/.../Action).
    Persistent across sessions, priority-sorted by the Will Engine.
    """
    __tablename__ = "goals_persistent"
    __table_args__ = (
        Index("ix_goals_horizon", "horizon_level"),
        Index("ix_goals_status", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    parent_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("goals_persistent.id"), nullable=True
    )
    # 0=Vision, 1=Year, 2=Quarter, 3=Month, 4=Week, 5=Day, 6=Action
    horizon_level: Mapped[int] = mapped_column(Integer, default=6, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    owner_agent: Mapped[str] = mapped_column(String(64), nullable=False, default="CEO")  # CEO/CTO/etc
    kpi: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    blockers_json: Mapped[str] = mapped_column(Text, default="[]")
    # seeded (operator) | self_generated (will reflection)
    source: Mapped[str] = mapped_column(String(16), default="seeded", nullable=False)
    # pending, running, done, failed, snoozed, cancelled
    status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
    
    # Priority components for the Will Engine heap
    value_alignment: Mapped[float] = mapped_column(Float, default=1.0)
    drive_pull: Mapped[float] = mapped_column(Float, default=1.0)
    urgency: Mapped[float] = mapped_column(Float, default=0.5)
    tractability: Mapped[float] = mapped_column(Float, default=0.5)
    progress: Mapped[float] = mapped_column(Float, default=0.0) # 0..1 progress towards the goal

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Self-relation for parent/child goals
    parent: Mapped[Optional["PersistentGoal"]] = relationship(
        "PersistentGoal", remote_side=[id], backref="children"
    )


# ── Block C-1 — Mission + Phase (long-horizon planning substrate) ─────────────
#
# Three-tier hierarchy: Mission → Phase → SubGoal (existing).
# Mission: the operator's prompt, durable, immutable after Phase 1 starts.
# Phase: strategic decomposition into 5-15 ordered segments, each with its
# own success_criteria and expected_duration_h. Re-planned only on explicit
# operator revise. Sub-goals (existing SubGoal shape) live inside a Phase.
#
# Both tables use the same status enum string as AgentTask for consistency:
#   "planning" | "running" | "paused" | "done" | "failed" | "abandoned"
#
# Every Mission gets a Markdown ledger at ledger_path — append-only, crash-
# safe source-of-truth for the planner on restart.  See agent/missions/.


class Mission(Base):
    """Durable top-level mission container, one per operator prompt.

    Immutable fields after creation: brief, success_criteria (frozen once
    Phase 1 starts). All other fields may be updated by the mission store.
    Per-user isolation is enforced by all CRUD helpers: every query is
    scoped by user_id and any cross-user read raises PermissionError.
    """
    __tablename__ = "agent_missions"
    __table_args__ = (
        Index("ix_agent_missions_user_status", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The operator's original prompt — verbatim, never modified after create.
    brief: Mapped[str] = mapped_column(Text, nullable=False)
    # Free-text emitted by the strategic planner; frozen once first Phase runs.
    success_criteria: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Operator's "what good looks like" — qualitative bar, may be empty.
    quality_bar: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Optional wall-clock deadline for the mission.
    deadline_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # JSON dict: e.g. {"max_usd": 20, "max_wall_hours": 72}. Nullable.
    budget_constraints_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # planning | running | paused | done | failed | abandoned
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="planning"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_now
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Absolute filesystem path to the append-only Markdown ledger.
    ledger_path: Mapped[str] = mapped_column(String(512), nullable=False, default="")

    # Relations
    phases: Mapped[list["Phase"]] = relationship(
        "Phase", back_populates="mission", cascade="all, delete-orphan",
        order_by="Phase.idx",
    )


class Phase(Base):
    """One ordered segment of a Mission.

    idx is 0-based and unique within a mission — enforced by the UniqueConstraint.
    status mirrors Mission.status values. artifacts_json stores declared output
    files: [{"path": "...", "kind": "file|blend|render|...", "produced": false}].
    The produced flag is flipped by mark_artifact_produced() once the file lands.
    """
    __tablename__ = "agent_phases"
    __table_args__ = (
        Index("ix_agent_phases_mission_idx", "mission_id", "idx"),
        UniqueConstraint("mission_id", "idx", name="uq_agent_phases_mission_idx"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    mission_id: Mapped[str] = mapped_column(
        ForeignKey("agent_missions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 0-based ordering within the mission; unique per mission (UniqueConstraint above).
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    success_criteria: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Planner estimate in hours; 0.0 = unknown.
    expected_duration_h: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0
    )
    # planning | running | paused | done | failed | abandoned
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="planning"
    )
    # JSON list of artifact descriptors: [{"path": str, "kind": str, "produced": bool}]
    artifacts_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relations
    mission: Mapped["Mission"] = relationship("Mission", back_populates="phases")


# ── V2 — Agent Chat Thread (conversational loop) ──────────────────────────────


class AgentChatThread(Base):
    """Persistent per-task conversation turns for the parallel chat channel.

    One row per message (user or assistant). Loaded on every
    POST /agent/chat to provide rolling context, persisted after the
    assistant reply so history survives across drawer close/remount.
    task_id is NOT a FK — it references agent_tasks.id but tasks may be
    purged while chat threads should survive for post-task review.
    """
    __tablename__ = "agent_chat_threads"
    __table_args__ = (
        Index("ix_agent_chat_threads_task", "task_id"),
        Index("ix_agent_chat_threads_task_created", "task_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(String(36), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


# ── Agent Roles (Phase 30 — Org-Chart) ────────────────────────────────────────

class AgentRole(Base):
    """A specialized sub-agent with defined responsibilities and constraints.
    Persistent across sessions.
    """
    __tablename__ = "agent_roles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False) # e.g. "CEO", "Developer"
    description: Mapped[str] = mapped_column(Text, nullable=False)
    standing_orders: Mapped[str] = mapped_column(Text, default="")
    system_prompt_extension: Mapped[str] = mapped_column(Text, default="")
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    # Relations
    outbound_relations: Mapped[list["AgentRelation"]] = relationship(
        "AgentRelation", foreign_keys="AgentRelation.source_role_id", back_populates="source_role"
    )
    inbound_relations: Mapped[list["AgentRelation"]] = relationship(
        "AgentRelation", foreign_keys="AgentRelation.target_role_id", back_populates="target_role"
    )


class AgentRelation(Base):
    """Defines trust and hierarchy between roles.
    e.g. "CEO" -> "Developer" (COMMANDS)
    """
    __tablename__ = "agent_relations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source_role_id: Mapped[str] = mapped_column(ForeignKey("agent_roles.id"), nullable=False)
    target_role_id: Mapped[str] = mapped_column(ForeignKey("agent_roles.id"), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(32), default="COMMANDS") # COMMANDS, AUDITS, ADVISES
    trust_level: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    source_role: Mapped["AgentRole"] = relationship(
        "AgentRole", foreign_keys=[source_role_id], back_populates="outbound_relations"
    )
    target_role: Mapped["AgentRole"] = relationship(
        "AgentRole", foreign_keys=[target_role_id], back_populates="inbound_relations"
    )


# ── Phase 24-I — Geofences ────────────────────────────────────────────────────


class Geofence(Base):
    """Phase 24-I — Geofence definition (Circle or Polygon).
    
    Coordinates stored as JSON.
    kind: "circle" | "polygon"
    trigger_on: "enter" | "exit" | "dwell"
    """
    __tablename__ = "map_geofences"
    __table_args__ = (
        Index("ix_map_geofences_user_active", "user_id", "is_active"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="circle")
    # For circle: {"lat": float, "lon": float, "radius_m": float}
    # For polygon: {"points": [[lon, lat], ...]}
    geometry_json: Mapped[str] = mapped_column(Text, nullable=False)
    
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # JSON list of actions: [{"type": "toast", "message": "..."}, {"type": "voice", "text": "..."}]
    on_enter_json: Mapped[str] = mapped_column(Text, default="[]")
    on_exit_json: Mapped[str] = mapped_column(Text, default="[]")
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    last_triggered_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


# ── Phase 25 — Trajectory Pattern Learning ───────────────────────────────────


class TrajectoryPattern(Base):
    """Phase 25 — Learned movement pattern.
    
    Stores clusters of locations (e.g. "Work", "Gym") and typical
    arrival/departure time windows.
    """
    __tablename__ = "map_trajectory_patterns"
    __table_args__ = (
        Index("ix_map_trajectory_user_label", "user_id", "label"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(64), nullable=False) # "Home", "Office"
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    radius_m: Mapped[float] = mapped_column(Float, default=100.0)
    
    # Typical time windows: [{"dow": 0..6, "start": "09:00", "end": "18:00"}]
    schedule_json: Mapped[str] = mapped_column(Text, default="[]")
    
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    last_detected_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ── Team Chat Messages (Slack-style multi-agent dialogue) ─────────────────────

class TeamChatMessage(Base):
    """Slack-style multi-agent dialogue and tasks execution/delegation log.
    Allows root and sub-agents to chat, report status, and share deliverables.
    """
    __tablename__ = "team_chat_messages"
    __table_args__ = (
        Index("ix_team_chat_messages_task", "task_id"),
        Index("ix_team_chat_messages_task_created", "task_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(String(36), nullable=False) # Root task ID
    parent_task_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True) # Direct parent task ID
    sender: Mapped[str] = mapped_column(String(64), nullable=False) # e.g. "CEO (Chief Executive)"
    receiver: Mapped[str] = mapped_column(String(64), nullable=False) # e.g. "Developer"
    message: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(String(32), default="text", nullable=False) # "text", "delegate", "progress", "report"
    media_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # JSON list of media attachments
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


# ── Phantom Mind State (PMState) ──────────────────────────────────────────────


class PhantomMindState(Base):
    """Per-user compressed mind-state: what PHANTOM is thinking between turns.

    One row per user (unique on user_id). state_json holds:
      focus, open_loops (list), emotional_thread, last_insight.
    Updated asynchronously after each chat turn via memory.mind_state.
    """
    __tablename__ = "phantom_mind_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True, unique=True, nullable=False)
    state_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_now, onupdate=_now
    )


class PhantomNarrative(Base):
    """Per-user living narrative: interpretive 3-paragraph story updated every N turns.

    Unlike raw facts, this is a synthesized human-readable account of who
    the user is RIGHT NOW — focus, patterns, unmet needs. Updated in the
    background every 10 chat turns via memory.narrative.update_narrative_if_due.
    """
    __tablename__ = "phantom_narrative"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True, unique=True, nullable=False)
    narrative_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    turn_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_now, onupdate=_now
    )




class WillBudgetLedger(Base):
    """Daily LLM spend ledger for the Will Engine (per user, per local date)."""
    __tablename__ = "will_budget_ledger"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    ledger_date: Mapped[str] = mapped_column(String(10), primary_key=True)  # YYYY-MM-DD
    llm_calls: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)


class PolisMissionRow(Base):
    """ПОЛІС mission: full PlanGraph persisted as JSON, reboot-proof."""
    __tablename__ = "polis_missions"
    __table_args__ = (Index("ix_polis_missions_user_status", "user_id", "status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    brief: Mapped[str] = mapped_column(Text, nullable=False)
    pipeline: Mapped[str] = mapped_column(String(32), nullable=False, default="generic")
    domain: Mapped[str] = mapped_column(String(16), nullable=False, default="generic")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="planning")
    graph_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    chat_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_now, onupdate=_now
    )


class PolisCitizenRow(Base):
    """ПОЛІС citizen — a specialist's persistent reputation across missions."""
    __tablename__ = "polis_citizens"
    role: Mapped[str] = mapped_column(String(64), primary_key=True)
    successes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revisions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_produced: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    domains_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    recent_titles_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    last_active: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class ManagedKeyRow(Base):
    """KeyVault: encrypted API key with rotation state and lifetime meters."""
    __tablename__ = "managed_keys"
    __table_args__ = (Index("ix_managed_keys_provider_prio", "provider", "priority"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    encrypted_key: Mapped[str] = mapped_column(Text, nullable=False)
    key_hint: Mapped[str] = mapped_column(String(12), nullable=False, default="")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    cooldown_until: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    requests_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failures_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_used_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class WillJournal(Base):
    """Append-only post-facto record of will decisions and outcomes."""
    __tablename__ = "will_journal"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    ts: Mapped[float] = mapped_column(Float, nullable=False)
    decision_json: Mapped[str] = mapped_column(Text, default="{}")
    action: Mapped[str] = mapped_column(String(64), default="")
    task_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    outcome: Mapped[str] = mapped_column(Text, default="")
    budget_delta_json: Mapped[str] = mapped_column(Text, default="{}")


# ── Multi-Tenant SaaS Organization Model ───────────────────────────────────────

class TenantOrg(Base):
    """SaaS Organization model managing multi-tenant isolation and subscriptions."""
    __tablename__ = "tenant_orgs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    plan_tier: Mapped[str] = mapped_column(String(32), nullable=False, default="FREE")  # FREE / PRO / ENTERPRISE
    max_users: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    max_ai_tokens_monthly: Mapped[int] = mapped_column(Integer, nullable=False, default=100000)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


# ── API Keys & Billing (Phase C SaaS Monetization) ─────────────────────────────

class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    tier: Mapped[str] = mapped_column(String(32), default="Free")
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    max_tokens: Mapped[int] = mapped_column(Integer, default=1000)
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    tenant: Mapped["Tenant"] = relationship("Tenant", foreign_keys=[tenant_id])


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    tenant: Mapped["Tenant"] = relationship("Tenant", foreign_keys=[tenant_id])


# ── Месенджер ────────────────────────────────────────────────────────────────


class MessengerConversation(Base):
    """Розмова з людьми. Живе на вузлі власника, а не в чужій хмарі."""

    __tablename__ = "messenger_conversations"
    __table_args__ = (
        Index("ix_messenger_conversations_owner_updated", "owner_user_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="dm", nullable=False)
    circle: Mapped[str] = mapped_column(String(32), default="all", nullable=False)
    handle: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    avatar: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    #: Розмова з конкретною людиною. Є контакт — є крипто-сесія, і повідомлення
    #: їде до неї шифротекстом, а не просто лягає в локальну стрічку.
    contact_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("messenger_contacts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    #: Наступний номер у стрічці. Порядок повідомлень тримається на ньому, а не
    #: на годиннику: у двох пристроїв час розходиться, лічильник — ні.
    next_seq: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


class MessengerMessage(Base):
    """Одне повідомлення. Переживає рестарт застосунку, вузла й браузера."""

    __tablename__ = "messenger_messages"
    __table_args__ = (
        #: Клієнт може надіслати те саме повідомлення двічі — після обриву
        #: звʼязку він не знає, чи дійшло. Унікальність по client_id робить
        #: повторну доставку безпечною: у стрічці все одно один запис.
        UniqueConstraint("conversation_id", "client_id", name="uq_messenger_client_id"),
        Index("ix_messenger_messages_conversation_seq", "conversation_id", "seq"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("messenger_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Ідентифікатор, який згенерував клієнт ще до відправки.
    client_id: Mapped[str] = mapped_column(String(64), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    author_id: Mapped[str] = mapped_column(String(64), nullable=False)
    author_name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), default="text", nullable=False)
    #: Відкритий текст або JSON складного типу — для розмов, які ще не шифруємо.
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    #: Шифротекст для наскрізно захищених розмов. Вузол його не розуміє.
    ciphertext: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    transport: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    #: local — везти нікуди; queued — чекає на транспорт; sent — віддано.
    #: Стан мусить лежати в базі, інакше після рестарту вузол забуває, що
    #: комусь щось винен, і повідомлення тихо зникає між людьми.
    delivery_state: Mapped[str] = mapped_column(String(12), default="local", nullable=False)
    delivery_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    #: Готовий кадр для співрозмовника. Повтор має везти ТОЙ САМИЙ кадр:
    #: перешифрувати означало б зрушити храповик іще раз і надіслати людині
    #: два різні повідомлення замість одного.
    outbound_frame: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class MessengerContact(Base):
    """Співрозмовник і крипто-сесія з ним.

    Тут же живе число для звірки: доки його не прочитали одне одному вголос,
    контакт лишається непідтвердженим, і UI не має права малювати замок.
    """

    __tablename__ = "messenger_contacts"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "peer_node_id", name="uq_messenger_contact_peer"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    peer_node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Пряма адреса вузла співрозмовника, якщо вона відома: та сама мережа,
    #: власний домен, тунель. Немає адреси — кадр чекає на ретранслятор.
    peer_address: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    bundle_json: Mapped[str] = mapped_column(Text, nullable=False)
    #: Стан храповика, запечатаний ключем вузла. Вузол-сусід його не прочитає.
    session_blob: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    safety_number: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Проставляється лише після того, як люди звірили число голосом.
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
