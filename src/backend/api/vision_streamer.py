import asyncio
import logging
from api.websocket_hub import hub
from agent.actions.device import ScreenCapture

logger = logging.getLogger(__name__)

class VisionStreamer:
    def __init__(self):
        self._task: asyncio.Task | None = None
        self._subscribers = 0
        self._lock = asyncio.Lock()

    async def start(self):
        async with self._lock:
            self._subscribers += 1
            if self._subscribers == 1 and (self._task is None or self._task.done()):
                self._task = asyncio.create_task(self._stream_loop())
                logger.info("Vision stream started")

    async def stop(self):
        async with self._lock:
            self._subscribers = max(0, self._subscribers - 1)
            if self._subscribers == 0 and self._task and not self._task.done():
                self._task.cancel()
                self._task = None
                logger.info("Vision stream stopped")

    async def _stream_loop(self):
        try:
            action = ScreenCapture()
            # Simple context stub
            class DummyCtx:
                workspace_dir = "/tmp"
            ctx = DummyCtx()
            
            while True:
                # Limit to ~5 FPS to save resources on Radxa
                await asyncio.sleep(0.2)
                
                try:
                    res = await action.execute(ctx)
                    if res.ok and "png_base64" in res.output:
                        await hub.broadcast("vision", "frame", {
                            "width": res.output.get("width"),
                            "height": res.output.get("height"),
                            "strategy": res.output.get("strategy"),
                            "png_base64": res.output["png_base64"]
                        })
                except Exception as exc:
                    logger.debug("Vision stream capture error: %s", exc)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Vision streamer crashed: %s", exc)

streamer = VisionStreamer()
