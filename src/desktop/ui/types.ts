import { SystemState } from '../../shared/types/system';

/** WS hub wire envelope — mirrors `websocket_hub.py` `{channel,type,data,ts}`. */
export interface HubEnvelope {
  channel: string;
  type: string;
  data: Record<string, unknown>;
  ts: number;
}

/** `state/transition` payload — mirrors `StateTransitionEvent.to_ws_payload()`. */
export interface StateTransitionPayload {
  from: string;
  to: string;
  trigger: string;
  timestamp: number;
  auto: boolean;
}

export function isHubEnvelope(raw: unknown): raw is HubEnvelope {
  if (typeof raw !== 'object' || raw === null) return false;
  const m = raw as Record<string, unknown>;
  return typeof m.channel === 'string' && typeof m.type === 'string' && typeof m.data === 'object' && m.data !== null;
}

export function parseSystemState(value: unknown): SystemState | null {
  if (typeof value !== 'string') return null;
  const upper = value.toUpperCase();
  return upper in SystemState ? (upper as SystemState) : null;
}

/** Pull a human sentence out of loosely-shaped broadcast data. */
export function extractText(data: Record<string, unknown>): string | null {
  for (const key of ['message', 'text', 'content', 'reason']) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'object' && v !== null) {
      const inner = (v as Record<string, unknown>).content;
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    }
  }
  return null;
}

/** A murmur is a single line (§3.3): first sentence, hard-capped. */
export function toMurmurLine(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  const sentenceEnd = oneLine.search(/[.!?…](\s|$)/);
  const sentence = sentenceEnd > 0 ? oneLine.slice(0, sentenceEnd + 1) : oneLine;
  return sentence.length <= max ? sentence : sentence.slice(0, max - 1).trimEnd() + '…';
}
