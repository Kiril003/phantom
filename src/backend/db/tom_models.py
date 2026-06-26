"""Phase 35 — Theory of Mind ORM models.
Defines ORM mappings for Episodes, SemanticMemory, Beliefs, and associated structures.
"""
from __future__ import annotations
from typing import Optional, List
from sqlalchemy import ForeignKey, String, Text, Float, Integer, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db.database import Base


class Episode(Base):
    __tablename__ = "episodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    ts: Mapped[float] = mapped_column(Float, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    prosody: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON string
    context_snap: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON string
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    last_accessed: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dream_processed: Mapped[int] = mapped_column(Integer, default=0, index=True)


class SemanticMemory(Base):
    __tablename__ = "semantic_memory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    topic_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    embedding_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    decay_score: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    last_accessed: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class SemanticSource(Base):
    __tablename__ = "semantic_source"

    semantic_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("semantic_memory.id", ondelete="CASCADE"), primary_key=True
    )
    episode_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("episodes.id", ondelete="CASCADE"), primary_key=True
    )


class Belief(Base):
    __tablename__ = "beliefs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject: Mapped[str] = mapped_column(String(16), nullable=False)  # user | self
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    predicate_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    belief_type: Mapped[str] = mapped_column(String(32), nullable=False)  # goal|preference|trait|open_loop|knowledge_gap|trigger
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    log_odds: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)  # active|superseded|retracted
    superseded_by: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("beliefs.id"), nullable=True
    )
    embedding_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)
    last_confirmed: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class BeliefEvidence(Base):
    __tablename__ = "belief_evidence"

    belief_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("beliefs.id", ondelete="CASCADE"), primary_key=True
    )
    source_type: Mapped[str] = mapped_column(String(16), primary_key=True)  # episode | semantic
    source_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    polarity: Mapped[int] = mapped_column(Integer, nullable=False)  # +1 / -1
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    added_at: Mapped[float] = mapped_column(Float, nullable=False)


class Contradiction(Base):
    __tablename__ = "contradictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    belief_a: Mapped[int] = mapped_column(Integer, ForeignKey("beliefs.id", ondelete="CASCADE"))
    belief_b: Mapped[int] = mapped_column(Integer, ForeignKey("beliefs.id", ondelete="CASCADE"))
    kind: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # update | conflict | refinement
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)  # open | resolved
    resolution: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    detected_at: Mapped[float] = mapped_column(Float, nullable=False)
    resolved_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class Hypothesis(Base):
    __tablename__ = "hypotheses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    belief_id: Mapped[int] = mapped_column(Integer, ForeignKey("beliefs.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    test_mode: Mapped[str] = mapped_column(String(16), nullable=False)  # passive | active_probe
    probe_hint: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending|confirmed|refuted|expired
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    resolved_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class ReflectionQueue(Base):
    __tablename__ = "reflection_queue"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # probe_outcome | affect_spike | contradiction_hint
    payload: Mapped[str] = mapped_column(Text, nullable=False)  # JSON payload
    priority: Mapped[int] = mapped_column(Integer, default=0, index=True)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    consumed: Mapped[int] = mapped_column(Integer, default=0, index=True)


class Epoch(Base):
    __tablename__ = "epochs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    topic_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)  # active | hidden
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class DreamJob(Base):
    __tablename__ = "dream_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[float] = mapped_column(Float, nullable=False)
    phase: Mapped[str] = mapped_column(String(32), nullable=False)  # planning | applying | done | aborted
    stage: Mapped[str] = mapped_column(String(32), nullable=False)  # summarize | beliefs | contradictions | hypotheses
    batch_lo: Mapped[int] = mapped_column(Integer, nullable=False)
    batch_hi: Mapped[int] = mapped_column(Integer, nullable=False)
    heartbeat: Mapped[float] = mapped_column(Float, nullable=False)
    committed_at: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    mutations: Mapped[List[DreamMutation]] = relationship(
        "DreamMutation", back_populates="job", cascade="all, delete-orphan"
    )


class DreamMutation(Base):
    __tablename__ = "dream_mutations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("dream_jobs.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    op: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    precond: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON string
    payload: Mapped[str] = mapped_column(Text, nullable=False)  # JSON string

    job: Mapped[DreamJob] = relationship("DreamJob", back_populates="mutations")
