import { create } from 'zustand';

/**
 * Phase 11c.3 — global voice always-on status.
 *
 * Phase 11b.1 mounted `VoiceAlwaysOnGate` inside `DialogueLayout`, which
 * meant the always-on listener only ran while the user was *in* the
 * chat. The whole point of always-on is to listen *always*, regardless
 * of which screen the operator happens to be looking at, so the gate
 * was lifted up to App-level. The price: layouts that used to read the
 * gate's status via a `onStatusChange` callback can no longer do that
 * (the callback was per-mount and we now have one global mount). This
 * tiny store carries that status to whoever wants to display it
 * (currently only `DialogueLayout`'s sphere label + pulse).
 */
export type VoiceAlwaysOnStatus =
  | 'disabled'
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'armed'
  | 'cooldown'
  | 'error';

interface VoiceAlwaysOnStatusState {
  status: VoiceAlwaysOnStatus;
  setStatus: (status: VoiceAlwaysOnStatus) => void;
}

export const useVoiceAlwaysOnStatusStore = create<VoiceAlwaysOnStatusState>(
  (set) => ({
    status: 'disabled',
    setStatus: (status) => set({ status }),
  }),
);
