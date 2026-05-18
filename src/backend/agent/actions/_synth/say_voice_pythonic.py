import asyncio
import os
import tempfile
from io import BytesIO
from typing import ClassVar

from pydantic import Field

from agent.actions.base import Action, ActionContext
from agent.schemas import ActionResult, RiskLevel

try:
    from gtts import gTTS
    from playsound import playsound
    _LIBS_AVAILABLE = True
except ImportError:
    _LIBS_AVAILABLE = False


class SayVoicePythonic(Action):
    """
    Synthesizes speech from text using gTTS and plays it back.
    This action requires an internet connection and the 'gtts' and 'playsound' libraries.
    """
    name: ClassVar[str] = "synth.say_voice_pythonic"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    requires_network: ClassVar[bool] = True
    reversible: ClassVar[bool] = False
    requires_consent: ClassVar[bool] = False
    estimated_peak_ram_mb: ClassVar[int] = 100
    estimated_disk_write_mb: ClassVar[int] = 1
    estimated_wall_seconds: ClassVar[int] = 20

    text: str = Field(
        ...,
        description="The text to be spoken in Ukrainian.",
        min_length=1
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        """
        Generates audio from the provided text and plays it.
        """
        if not _LIBS_AVAILABLE:
            return ActionResult(
                ok=False,
                error="Required libraries 'gtts' or 'playsound' are not installed. Cannot perform text-to-speech."
            )

        temp_filename = None
        try:
            # Generate speech and store it in an in-memory bytes buffer
            mp3_fp = BytesIO()
            tts = gTTS(text=self.text, lang='uk', slow=False)
            tts.write_to_fp(mp3_fp)
            mp3_fp.seek(0)

            # Create a temporary file to ensure cross-platform compatibility with playsound
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3", dir=ctx.workspace_dir) as temp_audio_file:
                temp_audio_file.write(mp3_fp.read())
                temp_filename = temp_audio_file.name

            # Define the blocking playback function
            def play_audio_sync(file_path: str):
                try:
                    playsound(file_path, block=True)
                finally:
                    # Ensure cleanup happens immediately after playback
                    if os.path.exists(file_path):
                        os.remove(file_path)

            # Run the blocking function in a separate thread to avoid blocking the event loop
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, play_audio_sync, temp_filename)

            summary = self.text if len(self.text) <= 60 else f"{self.text[:57]}..."
            return ActionResult(
                ok=True,
                output={"status": f"Successfully spoke: '{summary}'"}
            )

        except Exception as e:
            # Final cleanup attempt in case of an error during playback logic
            if temp_filename and os.path.exists(temp_filename):
                os.remove(temp_filename)
            return ActionResult(
                ok=False,
                error=f"Failed to generate or play audio: {type(e).__name__}: {e}"
            )