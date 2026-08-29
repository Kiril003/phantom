import { describe, expect, it } from 'vitest';

import { BEARER_SUBPROTOCOL, bearerProtocols, nextDelayMs, socketUrl } from './ws';

describe('socketUrl', () => {
  it('keeps the token out of the address even when there is one', () => {
    expect(socketUrl('ws://127.0.0.1:8000/ws', 'abc.def.ghi')).toBe(
      'ws://127.0.0.1:8000/ws',
    );
  });

  it('stays anonymous when there is no session', () => {
    expect(socketUrl('ws://127.0.0.1:8000/ws', null)).toBe('ws://127.0.0.1:8000/ws');
  });
});

describe('bearerProtocols', () => {
  it('carries the token as the second subprotocol', () => {
    expect(bearerProtocols('abc.def.ghi')).toEqual([BEARER_SUBPROTOCOL, 'abc.def.ghi']);
  });

  it('offers no subprotocol without a session', () => {
    expect(bearerProtocols(null)).toBeUndefined();
  });
});

describe('nextDelayMs', () => {
  it('backs off and caps at 30s', () => {
    expect(nextDelayMs(0, () => 0.5)).toBe(1_000);
    expect(nextDelayMs(3, () => 0.5)).toBe(8_000);
    expect(nextDelayMs(20, () => 0.5)).toBe(30_000);
  });

  it('jitters within ±20%', () => {
    expect(nextDelayMs(2, () => 0)).toBe(3_200);
    expect(nextDelayMs(2, () => 1)).toBe(4_800);
  });
});
