"""
PHANTOM OS — Voice subsystem.

Phase 07 (push-to-talk slice):
  - stt_engine : Speech-to-text abstract interface + Vosk provider.
  - tts_engine : Text-to-speech abstract interface + Piper provider.
  - pipeline   : Orchestrates STT → chat → TTS for the /voice/ws endpoint.

Streaming STT, wake-word detection, and StyleTTS2 Ukrainian are deferred
to a later phase; this module ships a tap-to-speak pipeline that works
with the browser's MediaRecorder.
"""
