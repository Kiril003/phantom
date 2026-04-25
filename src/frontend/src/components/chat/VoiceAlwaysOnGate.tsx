/**
 * VoiceAlwaysOnGate — Phase 11b.1 settings-gated always-on wrapper.
 *
 * The hook `useVoiceAlwaysOn` was built in Phase 11b but never wired
 * into any component — so toggling the setting did nothing. This
 * component is the missing wiring: it reads
 * `values.voice_always_on_enabled` from the settings store and starts
 * / stops the hook accordingly, forwarding final transcripts to the
 * chat store.
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
  const enabled = useSettingsStore((s) =>
    Boolean(s.values.voice_always_on_enabled ?? false),
  );
  const sendMessage = useChatStore((s) => s.sendMessage);
  const systemState = useSystemStore((s) => s.state);
  const setInputMode = useInputMode((s) => s.setMode);
  const setGlobalStatus = useVoiceAlwaysOnStatusStore((s) => s.setStatus);

  const onFinalTranscript = useCallback(
    (t: FinalTranscript) => {
      const text = (t.transcript ?? '').trim();
      if (!text) return;
      // Fire-and-forget — the chat store handles errors (banner).
      void sendMessage(text, 'voice', systemState);
      // Hand input mode back to idle so tap-to-talk is free to claim
      // before the cooldown window even lands.
      setInputMode('idle');
    },
    [sendMessage, systemState, setInputMode],
  );

  const { status, errorMessage } = useVoiceAlwaysOn({
    enabled,
    onFinalTranscript,
  });

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
