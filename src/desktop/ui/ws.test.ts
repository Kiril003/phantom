import { describe, expect, it } from 'vitest';

import { nextDelayMs, socketUrl } from './ws';

describe('socketUrl', () => {
  it('opens the token into the query the hub reads', () => {
    expect(socketUrl('ws://127.0.0.1:8000/ws', 'abc.def.ghi')).toBe(
      'ws://127.0.0.1:8000/ws?token=abc.def.ghi',
    );
  });

  it('stays anonymous when there is no session', () => {
    expect(socketUrl('ws://127.0.0.1:8000/ws', null)).toBe('ws://127.0.0.1:8000/ws');
  });

  it('escapes a token so a stray character cannot forge query params', () => {
    expect(socketUrl('ws://x/ws', 'a&b=c')).toBe('ws://x/ws?token=a%26b%3Dc');
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
