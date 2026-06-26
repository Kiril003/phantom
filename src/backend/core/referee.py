"""Phase 37 / Wave-2 — Output Referee.
Stack-machine that coordinates concurrent outputs (voice dialogue, sentinel alarms, and proactive nudges).
Ensures nudges do not accumulate and implements background TTL expiration swept periodically.
"""
from __future__ import annotations

import asyncio
import logging
import time
from enum import IntEnum
from typing import Dict, Any, List, Optional, Callable, Awaitable

logger = logging.getLogger(__name__)


class PriorityTier(IntEnum):
    NUDGE = 0
    CONVERSATION = 1
    SENTINEL = 2
    LOCKDOWN = 3


class OutputFrame:
    """Represents a scheduled visual/vocal output payload."""
    def __init__(self, key: str, tier: PriorityTier, payload: Dict[str, Any], ttl: float = 60.0):
        self.key = key
        self.tier = tier
        self.payload = payload
        self.ttl = ttl
        self.created_at = time.monotonic()
        self.accumulated_active = 0.0
        self.last_resumed_at: Optional[float] = time.monotonic()
        self.was_applied = False

    def suspend(self) -> None:
        """Suspends the frame, stopping the TTL timer."""
        if self.last_resumed_at is not None:
            self.accumulated_active += time.monotonic() - self.last_resumed_at
            self.last_resumed_at = None

    def resume(self) -> None:
        """Resumes the frame, restarting the TTL timer."""
        self.last_resumed_at = time.monotonic()

    @property
    def is_expired(self) -> bool:
        """Computes true active elapsed duration against TTL."""
        active_time = self.accumulated_active
        if self.last_resumed_at is not None:
            active_time += time.monotonic() - self.last_resumed_at
        return active_time > self.ttl


class RuntimeReferee:
    """Coordinates screen and speaker outputs with focus levels and preemption rules."""
    def __init__(self, lockdown_controller: Any, on_nudge_ignored_callback: Callable[[OutputFrame], Awaitable[None]]):
        self.stack: List[OutputFrame] = []
        self.nudge_slot: Optional[OutputFrame] = None
        self.lock = asyncio.Lock()
        self.lockdown = lockdown_controller
        self.on_nudge_ignored = on_nudge_ignored_callback
        self._sweep_task: Optional[asyncio.Task] = None
        
        # Link ourselves back to the lockdown controller
        self.lockdown.referee = self

    def start_sweeper(self) -> None:
        """Starts the background TTL sweep loop."""
        if not self._sweep_task or self._sweep_task.done():
            self._sweep_task = asyncio.create_task(self._sweep_loop(), name="referee_ttl_sweeper")

    def stop_sweeper(self) -> None:
        """Cancels the sweeper task."""
        if self._sweep_task:
            self._sweep_task.cancel()
            self._sweep_task = None

    async def emit(self, frame: OutputFrame) -> bool:
        """Attempts to register and render a new output frame based on priorities."""
        if self.lockdown.is_active:
            return False

        if frame.tier == PriorityTier.LOCKDOWN:
            await self.lockdown.trigger("Emergency lockdown emitted via Referee.")
            return True

        async with self.lock:
            # 1. NUDGE (Tier 0) slot-only behavior (no stacking)
            if frame.tier == PriorityTier.NUDGE:
                if self.nudge_slot:
                    if self.nudge_slot.is_expired:
                        expired = self.nudge_slot
                        await self._clear_nudge_slot(expired, reason="expired")
                        asyncio.create_task(self.on_nudge_ignored(expired))
                    else:
                        if frame.payload.get("value", 0.0) < self.nudge_slot.payload.get("value", 0.0):
                            return False
                        superseded = self.nudge_slot
                        await self._clear_nudge_slot(superseded, reason="superseded")
                        asyncio.create_task(self.on_nudge_ignored(superseded))

                self.nudge_slot = frame
                await self._render_nudge_slot(frame)
                return True

            # 2. SENTINEL (Tier 2) preempts everything below immediately
            if frame.tier == PriorityTier.SENTINEL:
                await self._suspend_all_below()
                self.stack.append(frame)
                await self._apply_frame(frame)
                return True

            # 3. CONVERSATION/Normal Stack items (Tier 1)
            if self.stack:
                current = self.stack[-1]
                if frame.tier >= current.tier:
                    current.suspend()
                    await self._suspend_frame(current)
                    self.stack.append(frame)
                    await self._apply_frame(frame)
                    return True
                else:
                    self.stack.insert(0, frame)
                    frame.suspend()  # Freeze timer until it rises to top
                    return False
            else:
                self.stack.append(frame)
                await self._apply_frame(frame)
                return True

    async def yield_active(self, key: str) -> None:
        """Finishes active rendering of a frame anywhere in the stack/slots."""
        async with self.lock:
            # Check nudge slot
            if self.nudge_slot and self.nudge_slot.key == key:
                await self._clear_nudge_slot(self.nudge_slot, reason="yielded")
                self.nudge_slot = None
                return

            # Check stack
            target_idx = -1
            for idx, frame in enumerate(self.stack):
                if frame.key == key:
                    target_idx = idx
                    break

            if target_idx == -1:
                return

            removed = self.stack.pop(target_idx)
            await self._terminate_frame(removed)

            # If top was removed, resume next frame
            if target_idx == len(self.stack):
                await self._resume_next()

    async def on_lockdown(self) -> None:
        """Triggered by LockdownController: immediately wipes and terminates all channels."""
        # Note: LockdownController acquires cond, but we acquire referee lock here.
        # This is safe because lockdown trigger doesn't hold Cond inside Referee calls.
        async with self.lock:
            self.stop_sweeper()
            if self.nudge_slot:
                try:
                    await self._clear_nudge_slot(self.nudge_slot, reason="lockdown")
                except Exception:
                    pass
                self.nudge_slot = None

            for frame in self.stack:
                try:
                    await self._terminate_frame(frame)
                except Exception:
                    pass
            self.stack.clear()

    def on_re_arm(self) -> None:
        """Called when lockdown is cleared. Cleans up stack/slots and prepares for fresh start."""
        self.stack.clear()
        self.nudge_slot = None
        self.start_sweeper()

    async def _resume_next(self) -> None:
        """Finds the next valid frame in stack, terminating expired ones."""
        while self.stack:
            candidate = self.stack[-1]
            if candidate.is_expired:
                self.stack.pop()
                await self._terminate_frame(candidate)
            else:
                candidate.resume()
                if candidate.was_applied:
                    await self._resume_frame(candidate)
                else:
                    await self._apply_frame(candidate)
                break

    async def _sweep_loop(self) -> None:
        """Periodically sweeps and purges expired nudges and stack items."""
        while True:
            try:
                await asyncio.sleep(0.2)
                async with self.lock:
                    now = time.monotonic()
                    # Check nudge slot expiry
                    if self.nudge_slot and self.nudge_slot.is_expired:
                        expired = self.nudge_slot
                        await self._clear_nudge_slot(expired, reason="expired")
                        self.nudge_slot = None
                        # Execute ignored tracking callback asynchronously
                        asyncio.create_task(self.on_nudge_ignored(expired))

                    # Check stack expiry
                    expired_frames = [f for f in self.stack if f.is_expired]
                    for f in expired_frames:
                        self.stack.remove(f)
                        await self._terminate_frame(f)

                    if expired_frames and self.stack:
                        await self._resume_next()

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Error in Referee sweep loop: %s", exc)

    async def _suspend_all_below(self) -> None:
        for f in self.stack:
            f.suspend()
            await self._suspend_frame(f)

    # UI/Audio low-level drivers overrides
    async def _render_nudge_slot(self, frame: OutputFrame) -> None:
        frame.was_applied = True

    async def _clear_nudge_slot(self, frame: OutputFrame, reason: str) -> None:
        pass

    async def _apply_frame(self, frame: OutputFrame) -> None:
        frame.was_applied = True

    async def _suspend_frame(self, frame: OutputFrame) -> None:
        pass

    async def _resume_frame(self, frame: OutputFrame) -> None:
        pass

    async def _terminate_frame(self, frame: OutputFrame) -> None:
        pass


class SystemReferee(RuntimeReferee):
    """Production implementation of RuntimeReferee that triggers dialog/scene rendering."""

    async def _render_nudge_slot(self, frame: OutputFrame) -> None:
        await super()._render_nudge_slot(frame)
        await self._render_frame_to_user(frame)

    async def _apply_frame(self, frame: OutputFrame) -> None:
        await super()._apply_frame(frame)
        await self._render_frame_to_user(frame)

    async def _render_frame_to_user(self, frame: OutputFrame) -> None:
        payload = frame.payload
        kind = payload.get("kind")
        if kind == "speak":
            msg = payload.get("message")
            reason = payload.get("reason")
            priority = payload.get("priority", 5)
            causality = payload.get("causality", "")
            
            from agent.cognition.proactive.loop import get_loop
            loop = get_loop()
            if loop:
                ctx = await loop._build_context()
                await loop._emit_speech(msg, reason, priority, ctx, causality=causality)
        elif kind == "scene":
            msg = payload.get("message")
            brief = payload.get("scene_brief")
            reason = payload.get("reason")
            priority = payload.get("priority", 5)
            causality = payload.get("causality", "")
            
            from agent.cognition.proactive.loop import get_loop
            loop = get_loop()
            if loop:
                ctx = await loop._build_context()
                await loop._emit_scene(msg, brief, reason, priority, ctx, causality=causality)


async def _default_nudge_ignored(frame: OutputFrame) -> None:
    logger.info("Nudge ignored by referee: %s", frame.key)


from security.lockdown import lockdown_controller

system_referee = SystemReferee(
    lockdown_controller=lockdown_controller,
    on_nudge_ignored_callback=_default_nudge_ignored
)
