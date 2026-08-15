/**
 * useTtsPlaying — reactive "is PHANTOM audibly speaking right now".
 *
 * Backs the operator's stop-speaking control: it must only be reachable
 * while PHANTOM is actually talking (§ design-critic finding on the
 * missing interrupt). `ttsPlayer` is the single source of truth for
 * that — it covers both the sentence-stream queue and the whole-reply
 * fallback `<audio>` registered via `ttsPlayer.setExternalAudio`.
 */
import { useSyncExternalStore } from 'react';
import { ttsPlayer } from '../services/ttsPlayer';

function subscribe(onChange: () => void): () => void {
  return ttsPlayer.subscribe(onChange);
}

function getSnapshot(): boolean {
  return ttsPlayer.playing;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useTtsPlaying(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
