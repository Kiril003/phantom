"""
PHANTOM OS — Session Memory (in-RAM, current session only).
Stores the last N messages for the ongoing conversation so the AI
has conversational context without hitting the DB on every turn.
"""
from __future__ import annotations

import time
from core.clock import clock
from collections import deque
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SessionMessage:
    role: str           # "user" | "assistant" | "system"
    content: str
    ts: float = field(default_factory=clock.time)
    response_form: str = "text"
    attachments: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class DeferredThought:
    id: str
    session_id: str
    kind: str  # "speak" | "scene"
    content: str
    priority: int
    value: float
    created_at: float  # time.monotonic()
    ttl: float = 600.0  # 10 minute default
    metadata: dict[str, Any] = field(default_factory=dict)


class SessionMemory:
    """
    Ephemeral, per-session message ring buffer.
    Survives only for the lifetime of the server process.
    Indexed by session_id.
    """

    def __init__(self, max_messages_per_session: int = 100) -> None:
        self._max = max_messages_per_session
        # session_id → deque[SessionMessage]
        self._sessions: dict[str, deque[SessionMessage]] = {}
        # session_id → list[DeferredThought]
        self._deferred_thoughts: dict[str, list[DeferredThought]] = {}

    # ── Public API ─────────────────────────────────────────────────────────────

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        response_form: str = "text",
        attachments: list[dict[str, Any]] | None = None,
    ) -> None:
        if session_id not in self._sessions:
            self._sessions[session_id] = deque(maxlen=self._max)
        self._sessions[session_id].append(
            SessionMessage(
                role=role,
                content=content,
                response_form=response_form,
                attachments=attachments or [],
            )
        )

    def get_messages(
        self,
        session_id: str,
        limit: int | None = None,
    ) -> list[SessionMessage]:
        msgs = list(self._sessions.get(session_id, []))
        if limit:
            msgs = msgs[-limit:]
        return msgs

    def get_history_dicts(
        self,
        session_id: str,
        max_turns: int = 20,
    ) -> list[dict[str, str]]:
        """
        Returns [{"role": "user"|"assistant", "content": "..."}] for the last
        max_turns turns — suitable for passing to AI providers.
        """
        msgs = self.get_messages(session_id, limit=max_turns * 2)
        return [
            {"role": m.role, "content": m.content}
            for m in msgs
            if m.role in ("user", "assistant")
        ]

    def clear_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self._deferred_thoughts.pop(session_id, None)

    def session_exists(self, session_id: str) -> bool:
        return session_id in self._sessions and bool(self._sessions[session_id])

    def message_count(self, session_id: str) -> int:
        return len(self._sessions.get(session_id, []))

    def summary_context(self, session_id: str, max_chars: int = 500) -> str:
        """
        Returns a short text summary of the current session for use in memory hints.
        Takes the last few messages and truncates to max_chars.
        """
        msgs = self.get_messages(session_id, limit=6)
        lines: list[str] = []
        for m in msgs:
            prefix = "Ю" if m.role == "user" else "P"
            lines.append(f"[{prefix}]: {m.content[:120]}")
        full = " | ".join(lines)
        return full[:max_chars]

    def active_session_ids(self) -> list[str]:
        return [sid for sid, buf in self._sessions.items() if buf]

    def defer_thought(
        self,
        session_id: str,
        kind: str,
        content: str,
        priority: int,
        value: float,
        ttl: float = 600.0,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        import uuid
        thought_id = str(uuid.uuid4())
        thought = DeferredThought(
            id=thought_id,
            session_id=session_id,
            kind=kind,
            content=content,
            priority=priority,
            value=value,
            created_at=clock.time(),
            ttl=ttl,
            metadata=metadata or {},
        )
        if session_id not in self._deferred_thoughts:
            self._deferred_thoughts[session_id] = []
        self._deferred_thoughts[session_id].append(thought)
        return thought_id

    def get_deferred_thoughts(self, session_id: str) -> list[DeferredThought]:
        return self._deferred_thoughts.get(session_id, [])

    def prune_expired_thoughts(self, session_id: str) -> None:
        if session_id not in self._deferred_thoughts:
            return
        now = clock.time()
        active = []
        for t in self._deferred_thoughts[session_id]:
            if now - t.created_at <= t.ttl:
                active.append(t)
        self._deferred_thoughts[session_id] = active

    def clear_deferred_thoughts(self, session_id: str) -> None:
        self._deferred_thoughts.pop(session_id, None)


# Singleton
session_memory = SessionMemory()
