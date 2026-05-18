"""
Block C-1 — Mission Ledger: append-only Markdown file per mission.

The ledger is the crash-safe source-of-truth for long-horizon missions.
After a daemon restart the planner reads this file to restore ground state
instead of relying on the in-memory TaskState (which is gone).

File path: ~/.phantom/missions/<mission_id>/ledger.md

Append-only invariant
---------------------
LedgerWriter NEVER seeks backwards or truncates the file in-place.
The only exception is mark_phase_done(), which must flip an IN PROGRESS
heading to DONE — it does this by reading the whole file, making one
string substitution, and atomically renaming a temp file over the original.
This costs ~5ms for normal-sized ledgers and keeps the invariant intact:
at all times the file on disk is either the prior valid state or the new
valid state, never a partial write.

IO strategy
-----------
aiofiles is NOT installed in this environment. All file IO uses
asyncio.to_thread() wrapping synchronous open/write/read calls.  This keeps
all ledger methods awaitable without blocking the event loop.

Ledger format (operator-readable Markdown)
-------------------------------------------
# Mission: <brief summary, first 120 chars of brief>

## Operator brief (verbatim)
<full brief>

## Success criteria
<success_criteria text, or "(not yet set)">

## Phase 1 — <description> (DONE @ step 142, duration 1h23m)
- Decided: <decision text>
- Artifacts: <path> (NN MB)
- Lessons: <lesson text>

## Phase 2 — <description> (IN PROGRESS, step 143-?)
- Plan: <rationale>
- Current attempt: <placeholder>
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


# ── Formatting helpers ────────────────────────────────────────────────────────

def _format_size(size_bytes: int) -> str:
    """Human-readable file size for ledger bullets."""
    if size_bytes >= 1_048_576:
        return f"{size_bytes / 1_048_576:.1f} MB"
    if size_bytes >= 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes} B"


def _format_duration(wall_s: float) -> str:
    """Format seconds as HHhMMm or MMmSSs."""
    total_s = int(wall_s)
    hours, rem = divmod(total_s, 3600)
    minutes, secs = divmod(rem, 60)
    if hours > 0:
        return f"{hours}h{minutes:02d}m"
    return f"{minutes}m{secs:02d}s"


def _phase_heading_pattern(phase_idx: int, description: str) -> re.Pattern[str]:
    """Return a regex that matches the ## Phase N heading line for this phase."""
    # The description may contain regex metacharacters — escape it.
    safe_desc = re.escape(description)
    # Match the IN PROGRESS variant only (we only flip that one).
    return re.compile(
        r"^(## Phase "
        + re.escape(str(phase_idx + 1))
        + r" — "
        + safe_desc
        + r" \(IN PROGRESS,[^)]*\))$",
        re.MULTILINE,
    )


# ── IO helpers (asyncio.to_thread wrappers) ───────────────────────────────────

async def _read_file(path: str) -> str:
    """Read the full content of a text file, returning '' if not found."""
    def _sync() -> str:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return fh.read()
        except FileNotFoundError:
            return ""
    return await asyncio.to_thread(_sync)


async def _append_to_file(path: str, text: str) -> None:
    """Append text to a file, creating it if needed."""
    def _sync() -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text)
    await asyncio.to_thread(_sync)


async def _atomic_write(path: str, content: str) -> None:
    """Write content to path via atomic temp-file rename.

    Guarantees the file is either the old content or the new content;
    never a half-written intermediate state.
    """
    def _sync() -> None:
        dirpath = os.path.dirname(path)
        os.makedirs(dirpath, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=dirpath, prefix=".ledger_", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(content)
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    await asyncio.to_thread(_sync)


# ── LedgerWriter ─────────────────────────────────────────────────────────────


class LedgerWriter:
    """Append-only writer for a single mission ledger.

    All public methods are async coroutines. The writer never seeks backwards;
    mark_phase_done() is the only method that rewrites the file (via atomic
    temp-rename) to flip one heading line.

    Args:
        mission_id: UUID string for the mission.
        ledger_path: Absolute filesystem path where the ledger lives.
    """

    def __init__(self, mission_id: str, ledger_path: str) -> None:
        self.mission_id = mission_id
        self.ledger_path = ledger_path

    # ── Initialisation ────────────────────────────────────────────────────────

    async def init(self, mission: object) -> None:
        """Write the mission header.  Idempotent: if the file already exists
        and contains the header, this is a no-op (does NOT overwrite content).

        Args:
            mission: A db.models.Mission ORM instance with .brief,
                     .success_criteria, and .id fields.
        """
        existing = await _read_file(self.ledger_path)
        header_sentinel = f"# Mission:"
        if existing and header_sentinel in existing:
            # Already initialised — do not duplicate the header.
            logger.debug("ledger already initialised: %s", self.ledger_path)
            return

        brief: str = getattr(mission, "brief", "")
        success_criteria: str = getattr(mission, "success_criteria", "") or "(not yet set)"
        # First line uses a short summary (first 120 chars) for readability.
        summary = brief[:120].replace("\n", " ")

        header = (
            f"# Mission: {summary}\n\n"
            f"## Operator brief (verbatim)\n{brief}\n\n"
            f"## Success criteria\n{success_criteria}\n\n"
        )
        await _atomic_write(self.ledger_path, header)
        logger.info("ledger initialised: %s", self.ledger_path)

    # ── Phase events ──────────────────────────────────────────────────────────

    async def append_phase_start(self, phase: object) -> None:
        """Append an IN PROGRESS phase heading + plan line.

        Args:
            phase: A db.models.Phase ORM instance with .idx, .description,
                   .rationale, and (optionally) .success_criteria fields.
        """
        idx: int = getattr(phase, "idx", 0)
        description: str = getattr(phase, "description", "")
        rationale: str = getattr(phase, "rationale", "")
        success_criteria: str = getattr(phase, "success_criteria", "")

        number = idx + 1  # 1-based for human readers
        heading = f"## Phase {number} — {description} (IN PROGRESS, step ?-?)"

        lines = [
            f"\n{heading}\n",
            f"- Plan: {rationale}\n" if rationale else "",
            f"- Acceptance: {success_criteria}\n" if success_criteria else "",
            f"- Current attempt: (in progress)\n",
        ]
        text = "".join(l for l in lines if l)
        await _append_to_file(self.ledger_path, text)
        logger.debug(
            "ledger phase start: mission=%s phase_idx=%d", self.mission_id, idx
        )

    async def append_phase_decision(self, phase_id: str, decision_text: str) -> None:
        """Append a decision bullet under the active phase.

        Args:
            phase_id: The Phase.id (used only for logging).
            decision_text: Human-readable decision description.
        """
        text = f"- Decided: {decision_text}\n"
        await _append_to_file(self.ledger_path, text)
        logger.debug(
            "ledger decision: mission=%s phase=%s", self.mission_id, phase_id
        )

    async def append_phase_artifact(
        self, phase_id: str, path: str, size_bytes: int
    ) -> None:
        """Append an artifact bullet under the active phase.

        Args:
            phase_id: The Phase.id (used only for logging).
            path: Filesystem path of the produced artifact.
            size_bytes: File size in bytes (used for human-readable label).
        """
        size_str = _format_size(size_bytes)
        text = f"- Artifacts: {path} ({size_str})\n"
        await _append_to_file(self.ledger_path, text)
        logger.debug(
            "ledger artifact: mission=%s phase=%s path=%s",
            self.mission_id, phase_id, path,
        )

    async def append_phase_lesson(self, phase_id: str, lesson_text: str) -> None:
        """Append a lesson bullet under the active phase.

        Args:
            phase_id: The Phase.id (used only for logging).
            lesson_text: Transferable lesson text.
        """
        text = f"- Lessons: {lesson_text}\n"
        await _append_to_file(self.ledger_path, text)
        logger.debug(
            "ledger lesson: mission=%s phase=%s", self.mission_id, phase_id
        )

    async def mark_phase_done(
        self,
        phase: object,
        step_idx_completed: int,
        wall_duration_s: float,
    ) -> None:
        """Flip the IN PROGRESS phase heading to DONE.

        Reads the whole file, substitutes exactly one heading line, then
        atomically renames a temp file over the original. If the IN PROGRESS
        heading is not found (e.g. it was already flipped), this is a no-op.

        Args:
            phase: A db.models.Phase ORM instance with .idx and .description.
            step_idx_completed: The step index at which the phase completed.
            wall_duration_s: Elapsed wall-clock seconds for the phase.
        """
        idx: int = getattr(phase, "idx", 0)
        description: str = getattr(phase, "description", "")
        number = idx + 1

        old_heading_pattern = _phase_heading_pattern(idx, description)
        duration_str = _format_duration(wall_duration_s)
        new_heading = (
            f"## Phase {number} — {description} "
            f"(DONE @ step {step_idx_completed}, duration {duration_str})"
        )

        current = await _read_file(self.ledger_path)
        if not current:
            logger.warning(
                "mark_phase_done: ledger empty or missing at %s", self.ledger_path
            )
            return

        if not old_heading_pattern.search(current):
            logger.debug(
                "mark_phase_done: IN PROGRESS heading not found for phase %d "
                "(already done or never started?)", number
            )
            return

        updated = old_heading_pattern.sub(new_heading, current, count=1)
        await _atomic_write(self.ledger_path, updated)
        logger.info(
            "ledger phase done: mission=%s phase_idx=%d step=%d duration=%s",
            self.mission_id, idx, step_idx_completed, duration_str,
        )


# ── LedgerReader ─────────────────────────────────────────────────────────────


class LedgerReader:
    """Read-only interface to a mission ledger.

    Args:
        ledger_path: Absolute filesystem path to the ledger file.
    """

    def __init__(self, ledger_path: str) -> None:
        self.ledger_path = ledger_path

    async def read_full(self) -> str:
        """Return the entire Markdown body of the ledger."""
        return await _read_file(self.ledger_path)

    async def current_phase_section(self) -> str:
        """Extract the currently IN PROGRESS phase block.

        Returns the text from the matching ## Phase heading to (but not
        including) the next ## heading, or an empty string if no phase is
        currently in progress.

        This is injected into the strategic planner prompt on restart so
        the planner has precise ground state without reading the full ledger.
        """
        content = await _read_file(self.ledger_path)
        if not content:
            return ""

        # Split the document on ## boundaries so each section is independent.
        # This avoids cross-section matches when using DOTALL.
        section_split = re.compile(r"(?=^## )", re.MULTILINE)
        sections = section_split.split(content)

        in_progress_marker = re.compile(r"\(IN PROGRESS,")
        # Collect all sections whose first line is an IN PROGRESS heading.
        candidates: list[str] = []
        for sec in sections:
            first_line = sec.split("\n", 1)[0]
            if first_line.startswith("## Phase") and in_progress_marker.search(first_line):
                candidates.append(sec.strip())

        if not candidates:
            return ""
        # Return the last IN PROGRESS section (most recent active phase).
        return candidates[-1]

    async def mission_summary(self, max_chars: int = 2000) -> str:
        """Produce a compressed briefing suitable for prompt injection.

        Strategy:
        1. Keep the full header (# Mission + ## Operator brief + ## Success criteria).
        2. For each DONE phase: one summary line.
        3. For the IN PROGRESS phase: keep the full section.
        4. Truncate to max_chars if necessary, preferring to drop middle done-phases.

        Args:
            max_chars: Maximum character budget for the returned string.

        Returns:
            Compressed Markdown string.
        """
        content = await _read_file(self.ledger_path)
        if not content:
            return ""

        # Split into sections on ## headings.
        section_pattern = re.compile(r"(?=^## )", re.MULTILINE)
        parts = section_pattern.split(content)

        header_parts: list[str] = []
        done_lines: list[str] = []
        in_progress_section: str = ""

        for part in parts:
            stripped = part.strip()
            if not stripped:
                continue
            first_line = stripped.split("\n", 1)[0]

            if first_line.startswith("## Phase") and "(DONE" in first_line:
                # Compress to a single summary line.
                done_lines.append(first_line)
            elif first_line.startswith("## Phase") and "IN PROGRESS" in first_line:
                in_progress_section = stripped
            else:
                header_parts.append(stripped)

        sections: list[str] = []
        if header_parts:
            sections.append("\n\n".join(header_parts))
        if done_lines:
            sections.append("## Completed phases\n" + "\n".join(done_lines))
        if in_progress_section:
            sections.append(in_progress_section)

        result = "\n\n".join(sections)
        if len(result) > max_chars:
            result = result[:max_chars - 3] + "..."
        return result


__all__ = ["LedgerWriter", "LedgerReader"]
