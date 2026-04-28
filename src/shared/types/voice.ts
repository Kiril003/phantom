/**
 * Voice / STT shared types — Day-4 Block ID-1 (ADR-ID-001).
 *
 * Mirrors the backend `voice.stt_engine.STTResult` dataclass and is the
 * authoritative shape consumed by:
 *   - WS `phantom_voice_transcript` events.
 *   - REST `/api/v1/voice/transcribe` JSON response body.
 *   - frontend voice store + chat input speaker pill (Day-5 surface).
 *
 * Day-4 ships the SCHEMA SLOT — `speaker_id` is always `null` until the
 * Day-5 ML resolver lands (ADR-ID-002). Legacy clients that don't know
 * about the field stay correct: backend omits the key from the JSON
 * payload when the value is `None` / `null`, so existing parsers won't
 * see an unknown field.
 */

export type STTEngineName =
  | "whisper"
  | "vosk"
  | "noop"
  | "whisper_npu"
  | "mms_npu";

/**
 * Authoritative transcript shape on the wire.
 *
 * `speaker_id` is the Day-5 ML resolver's output: a `User.id` UUID string
 * when the speaker matches an enrolled user, `null` otherwise. The field
 * is OPTIONAL on the JSON wire (`STTResult.to_dict` omits it when null);
 * downstream code that ingests legacy payloads should normalise an
 * absent key to `null` for type-system uniformity.
 *
 * `engine_error` is the Day-2 audit's F-25 closure — populated only when
 * the provider's forward pass failed; absence means a clean transcript.
 */
export interface Transcript {
  text: string;
  confidence: number;
  engine: STTEngineName;
  language: string;
  /** Day-5 speaker-ID resolver output (Day-4 always null). */
  speaker_id: string | null;
  /** Provider-side inference failure reason (Day-2 F-25). */
  engine_error?: string;
}
