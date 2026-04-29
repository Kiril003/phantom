/**
 * VoiceAlwaysOnGate — Phase 12.0 mode-driven always-on wrapper.
 *
 * Reads ``values.voice_mode`` from the settings store: when it's
 * "continuous" or "wake_word" the hook is started; "off" tears it
 * down. Final transcripts are forwarded to the chat store.
 *
 * Renders nothing — voice feedback lives in the sphere label and chat
 * flow, not in this gate.
 */
import { useCallback, useEffect } from 'react';
import { useVoiceAlwaysOn, type FinalTranscript } from '../../hooks/useVoiceAlwaysOn';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { useSystemStore } from '../../stores/systemStore';
import { useInputMode } from '../../stores/inputModeStore';
import {
  useVoiceAlwaysOnStatusStore,
  type VoiceAlwaysOnStatus,
} from '../../stores/voiceAlwaysOnStatusStore';

interface Props {
  /** Optional hook callbacks (e.g., for layouts that want to render
   *  the current hook status next to the orb). Hook keeps ownership
   *  of the stream/WS regardless. */
  onStatusChange?: (status: string) => void;
}

export function VoiceAlwaysOnGate({ onStatusChange }: Props = {}) {
  // Phase 12.0 — voice_mode drives the gate. Anything other than "off"
  // (continuous / wake_word) starts the hook. The store may briefly
  // hold undefined before the first /settings load completes, in which
  // case we treat it as "off" — fail closed.
  const voiceMode = useSettingsStore(
    (s) => (s.values.voice_mode as string | undefined) ?? 'off',
  );
  const enabled = voiceMode === 'continuous' || voiceMode === 'wake_word';
  const sendMessage = useChatStore((s) => s.sendMessage);
  // Phase 13b — ghost-bubble preview during streaming partials.
  const setUserPreview = useChatStore((s) => s.setUserPreview);
  // Phase 13b — Whisper background-refine swaps the user message in place.
  const replaceLastUserMessage = useChatStore((s) => s.replaceLastUserMessage);
  // Phase 13b — once the chat round-trip starts, suppress ghost preview
  // updates so the real user bubble does not coexist with a ghost copy
  // of the same text.
  const sending = useChatStore((s) => s.sending);
  const systemState = useSystemStore((s) => s.state);
  const setInputMode = useInputMode((s) => s.setMode);
  const setGlobalStatus = useVoiceAlwaysOnStatusStore((s) => s.setStatus);

  const onFinalTranscript = useCallback(
    (t: FinalTranscript) => {
      const text = (t.transcript ?? '').trim();
      if (!text) return;
      // Day-5 quality gate — drop low-signal transcripts BEFORE they
      // become a /chat/messages call. Uses Whisper/Vosk's own
      // pseudo-confidence (avg_logprob → exp clamp [0,1]) so we never
      // need a noise-word allow-list. Two-tier threshold: 1-2-char
      // transcripts ("у", "ok") need a much higher confidence to ship,
      // because Whisper most often hallucinates short fillers from
      // silence; longer transcripts use a relaxed floor.
      // Operator-tunable via Settings later (key: voice_min_confidence).
      const confidence = typeof t.confidence === 'number' ? t.confidence : 0;
      const minConfidence = text.length <= 2 ? 0.55 : 0.4;
      if (confidence < minConfidence) {
        // eslint-disable-next-line no-console
        console.debug(
          '[voice-gate] dropped low-confidence',
          { text, confidence, threshold: minConfidence, source: t.source },
        );
        setInputMode('idle');
        return;
      }
      // Fire-and-forget — the chat store handles errors (banner).
      void sendMessage(text, 'voice', systemState);
      // Hand input mode back to idle so tap-to-talk is free to claim
      // before the cooldown window even lands.
      setInputMode('idle');
    },
    [sendMessage, systemState, setInputMode],
  );

  // Phase 13b — Whisper background refine arrived with a transcript that
  // differs from Vosk's fast-final by more than the configured ratio.
  // Update the most recent user message in place so the chat reflects
  // the higher-quality text without a duplicate row.
  const onRevisedTranscript = useCallback(
    (t: FinalTranscript) => {
      const text = (t.transcript ?? '').trim();
      if (!text) return;
      replaceLastUserMessage(text, {
        revised_by: 'whisper',
        revised_confidence: t.confidence,
      });
    },
    [replaceLastUserMessage],
  );

  const { status, errorMessage, partialTranscript } = useVoiceAlwaysOn({
    enabled,
    onFinalTranscript,
    onRevisedTranscript,
  });

  // Phase 13b — pipe the partial transcript into the chat store so
  // ChatWindow can render the ghost bubble. Skipped while ``sending`` so
  // the committed user bubble is not visually duplicated by the ghost
  // (final-event leaves partialTranscript set to the captured text for a
  // brief moment, and chatStore.sendMessage clears userPreview itself).
  useEffect(() => {
    if (!enabled || sending) {
      setUserPreview(null);
      return;
    }
    setUserPreview(partialTranscript ? partialTranscript : null);
  }, [enabled, sending, partialTranscript, setUserPreview]);

  useEffect(() => {
    onStatusChange?.(status);
    setGlobalStatus(status as VoiceAlwaysOnStatus);
  }, [status, onStatusChange, setGlobalStatus]);

  // Log hook-level errors once per change so they land in the browser
  // console during manual testing without forcing a banner on users.
  useEffect(() => {
    if (errorMessage) {
      // eslint-disable-next-line no-console
      console.warn('[voice-always-on]', errorMessage);
    }
  }, [errorMessage]);

  return null;
}
