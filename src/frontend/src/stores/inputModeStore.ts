/**
 * inputModeStore — Phase 11b.1 input-mode arbitration.
 *
 * Tap-to-talk and always-on both consume the same microphone stream
 * (see useMicStream). They can coexist, but at the "send a message to
 * the backend" level one of them has to win. This store is the single
 * source of truth for which input mode currently owns the turn.
 *
 * Transitions:
 *   idle     — nothing happening; always-on may emit wake/final events
 *   tap      — user is holding the tap-to-talk mic; always-on MUST
 *              discard wake/final events so the turn isn't double-sent
 *   always_on — always-on is mid-utterance; tap-to-talk takeover is
 *              allowed but should be preceded by a WS reset command
 *
 * Kept deliberately tiny — one field, one setter. Bigger state like
 * "am I recording" still belongs in useVoiceRecorder / useVoiceAlwaysOn.
 */
import { create } from 'zustand';

export type InputMode = 'idle' | 'tap' | 'always_on';

interface InputModeStore {
  mode: InputMode;
  setMode: (m: InputMode) => void;
}

export const useInputMode = create<InputModeStore>((set) => ({
  mode: 'idle',
  setMode: (m) => set({ mode: m }),
}));
