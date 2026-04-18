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


# ── Users ──────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="GUEST")
    rfid_uid_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    pin_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    # JSON-stored sub-objects (serialized as text)
    preferences_json: Mapped[str] = mapped_column(Text, default="{}")
    behavioral_model_json: Mapped[str] = mapped_column(Text, default="{}")

    # Relations
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

    session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="messages")


# ── Memory ─────────────────────────────────────────────────────────────────────

class MemoryFact(Base):
    __tablename__ = "memory_facts"

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
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


class AgentAuditEntry(Base):
    __tablename__ = "agent_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class AgentMemorySeed(Base):
    """Bridge to future episodic memory — SQL LIKE search this phase, ChromaDB later."""
    __tablename__ = "agent_memory_seeds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(36), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    key_actions: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class AgentFeedback(Base):
    __tablename__ = "agent_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    audit_entry_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    rating: Mapped[str] = mapped_column(String(16), nullable=False)  # up | down | comment
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
