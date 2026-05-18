"""
Observation builder + LLM formatter.

Observations are the bridge between executor results and the next planner call.
Keep them concise (≤ 500 chars) so the planner prompt stays token-efficient.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from ..schemas import Observation, PlanStep, ActionResult

_URL_RE = re.compile(r"https?://[^\s\"'<>]+")
_PATH_RE = re.compile(r"(?:/|~/)[^\s\"'<>]+")
_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")

# Phase 9.2.1 — markers that mean "the action picked an element/locator that
# wasn't on the page". Ranking them as a class lets the tactical prompt
# bias toward grounded interaction (browser.click_by_description) instead
# of guessing another CSS selector against a page it doesn't know.
_SELECTOR_MISS_MARKERS = (
    "selector_no_match",
    "element_not_found",
    "no_such_element",
    "stale_element",
)

_SELECTOR_HINT_TEXT = (
    "(Hint: CSS selector did not match. Consider browser.click_by_description "
    "with a semantic description of the target, or try a different selector "
    "pattern.)"
)


def _truncate(text: str, limit: int = 500) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


# Phase 28-STABILITY — keys that should always be prioritised in the summary
# if they exist in the ActionResult.output.
_PRIORITY_KEYS = (
    "command_success",
    "return_code",
    "new_url",
    "url_final",
    "status",
    "title",
    "value",
    "truncated",
)


def _summarize(step: PlanStep, result: ActionResult) -> str:
    if result.ok:
        out = result.output
        if isinstance(out, dict):
            # Special case for bash.run — make it look like a terminal result
            if step.action == "bash.run" or step.action == "bash.run_unsafe":
                status = "SUCCESS" if out.get("command_success") else "FAILED"
                stdout = out.get("stdout", "").strip()
                if stdout:
                    return f"[{status}] {stdout}"
                return f"[{status}] (no output)"

            # Sort keys: priority first, then the rest.
            all_keys = list(out.keys())
            sorted_keys = sorted(
                all_keys,
                key=lambda k: (0 if k in _PRIORITY_KEYS else 1, all_keys.index(k))
            )
            
            # Take up to 6 keys to be more inclusive while staying concise.
            keys_to_show = sorted_keys[:6]
            summary_parts = []
            for k in keys_to_show:
                summary_parts.append(f"{k}={_short(out[k])}")
            
            return _truncate(f"{step.action} OK: {', '.join(summary_parts)}")
        return _truncate(f"{step.action} OK: {_short(out)}")
    return _truncate(f"{step.action} FAILED ({result.error_class}): {result.error or ''}")


def _short(value) -> str:
    s = str(value)
    if len(s) > 200:
        return s[:197] + "..."
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


def _is_selector_miss(result: ActionResult) -> bool:
    err_text = (result.error or "") + " " + (result.error_class or "")
    err_text = err_text.lower()
    return any(marker in err_text for marker in _SELECTOR_MISS_MARKERS)


def build_from_action_result(step: PlanStep, result: ActionResult) -> Observation:
    obs_type = "result" if result.ok else "error"
    confidence = step.monologue.confidence if result.ok else 0.3
    entities = _extract_entities(step, result)
    content = _summarize(step, result)
    if (not result.ok) and _is_selector_miss(result):
        # Tag for downstream prompt bias and append a trailer the planner sees verbatim.
        if "hint:selector_failed" not in entities:
            entities = [*entities, "hint:selector_failed"]
        content = _truncate(f"{content}\n{_SELECTOR_HINT_TEXT}")
    return Observation(
        step_idx=step.step_idx,
        type=obs_type,
        source=step.action,
        content=content,
        confidence=confidence,
        entities=entities,
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
