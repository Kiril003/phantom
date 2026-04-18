"""
Observation builder + LLM formatter.

Observations are the bridge between executor results and the next planner call.
Keep them concise (≤ 500 chars) so the planner prompt stays token-efficient.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from .schemas import Observation, PlanStep, ActionResult

_URL_RE = re.compile(r"https?://[^\s\"'<>]+")
_PATH_RE = re.compile(r"(?:/|~/)[^\s\"'<>]+")
_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


def _truncate(text: str, limit: int = 500) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _summarize(step: PlanStep, result: ActionResult) -> str:
    if result.ok:
        out = result.output
        if isinstance(out, dict):
            keys = ", ".join(f"{k}={_short(v)}" for k, v in list(out.items())[:4])
            return _truncate(f"{step.action} OK — {keys}")
        return _truncate(f"{step.action} OK — {_short(out)}")
    return _truncate(f"{step.action} FAILED ({result.error_class}): {result.error or ''}")


def _short(value) -> str:
    s = str(value)
    if len(s) > 80:
        return s[:77] + "..."
    return s


def _extract_entities(step: PlanStep, result: ActionResult) -> list[str]:
    text = " ".join([
        step.action,
        " ".join(f"{k}={v}" for k, v in (step.args or {}).items()),
        str(result.output) if result.output else "",
        result.error or "",
    ])
    found: list[str] = []
    found.extend(_URL_RE.findall(text))
    found.extend(_IP_RE.findall(text))
    found.extend(_PATH_RE.findall(text))
    # Dedup, keep order
    seen: set[str] = set()
    out: list[str] = []
    for e in found:
        if e in seen:
            continue
        seen.add(e)
        out.append(e)
        if len(out) >= 6:
            break
    return out


def build_from_action_result(step: PlanStep, result: ActionResult) -> Observation:
    obs_type = "result" if result.ok else "error"
    confidence = step.monologue.confidence if result.ok else 0.3
    return Observation(
        step_idx=step.step_idx,
        type=obs_type,
        source=step.action,
        content=_summarize(step, result),
        confidence=confidence,
        entities=_extract_entities(step, result),
        ts=datetime.now(tz=timezone.utc),
    )


def build_system(step_idx: int, source: str, content: str, confidence: float = 1.0) -> Observation:
    return Observation(
        step_idx=step_idx,
        type="system",
        source=source,
        content=_truncate(content),
        confidence=confidence,
        entities=[],
        ts=datetime.now(tz=timezone.utc),
    )


def build_user(step_idx: int, content: str) -> Observation:
    return Observation(
        step_idx=step_idx,
        type="user_input",
        source="user",
        content=_truncate(content),
        confidence=1.0,
        entities=[],
        ts=datetime.now(tz=timezone.utc),
    )


def build_reflection(step_idx: int, content: str) -> Observation:
    return Observation(
        step_idx=step_idx,
        type="reflection",
        source="reflector",
        content=_truncate(content),
        confidence=1.0,
        entities=[],
        ts=datetime.now(tz=timezone.utc),
    )


def format_for_llm(observations: list[Observation], limit: int = 10) -> str:
    """Concise, structured, token-efficient block for prompt injection."""
    if not observations:
        return "(no prior observations)"
    recent = observations[-limit:]
    lines = []
    for i, obs in enumerate(recent, 1):
        ent = (" [" + ",".join(obs.entities[:3]) + "]") if obs.entities else ""
        lines.append(f"[{i}] {obs.type}:{obs.source} — {obs.content}{ent}")
    return "\n".join(lines)
