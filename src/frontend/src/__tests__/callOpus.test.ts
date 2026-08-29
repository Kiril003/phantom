import { describe, expect, it } from 'vitest';
import { AUDIO_PROFILES, tuneOpus } from '../services/callOpus';

/** Шматок справжнього offer із Chrome — рівно те, що приходить у рушій. */
const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=ptime:20',
].join('\r\n');

const fmtpOf = (sdp: string): Map<string, string> => {
  const line = sdp.split(/\r\n|\n/).find((l) => l.startsWith('a=fmtp:111 ')) ?? '';
  const map = new Map<string, string>();
  line
    .slice('a=fmtp:111 '.length)
    .split(';')
    .filter(Boolean)
    .forEach((kv) => {
      const eq = kv.indexOf('=');
      map.set(eq < 0 ? kv : kv.slice(0, eq), eq < 0 ? '' : kv.slice(eq + 1));
    });
  return map;
};

describe('tuneOpus', () => {
  it('вмикає FEC і DTX на кожній сходинці', () => {
    (['full', 'thrifty', 'narrow'] as const).forEach((level) => {
      const params = fmtpOf(tuneOpus(SDP, level));
      expect(params.get('useinbandfec')).toBe('1');
      expect(params.get('usedtx')).toBe('1');
      expect(params.get('stereo')).toBe('0');
    });
  });

  it('несе бітрейт і ptime своєї сходинки', () => {
    (['full', 'thrifty', 'narrow'] as const).forEach((level) => {
      const tuned = tuneOpus(SDP, level);
      const params = fmtpOf(tuned);
      const profile = AUDIO_PROFILES[level];
      expect(params.get('maxaveragebitrate')).toBe(String(profile.bitrate));
      expect(params.get('maxptime')).toBe(String(profile.maxptime));
      expect(tuned).toContain(`a=ptime:${profile.ptime}`);
      expect(tuned).toContain(`a=maxptime:${profile.maxptime}`);
    });
  });

  it('cbr вмикає лише на найвужчій сходинці', () => {
    expect(fmtpOf(tuneOpus(SDP, 'narrow')).get('cbr')).toBe('1');
    expect(fmtpOf(tuneOpus(SDP, 'full')).get('cbr')).toBe('0');
  });

  it('не викидає чужих параметрів, які поставив браузер', () => {
    expect(fmtpOf(tuneOpus(SDP, 'narrow')).get('minptime')).toBe('10');
  });

  it('лишає рівно один ptime — інакше опис недійсний', () => {
    const lines = tuneOpus(SDP, 'narrow').split('\r\n');
    expect(lines.filter((l) => l.startsWith('a=ptime:'))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith('a=maxptime:'))).toHaveLength(1);
  });

  it('без opus у SDP нічого не чіпає', () => {
    const noOpus = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 8\r\na=rtpmap:8 PCMA/8000';
    expect(tuneOpus(noOpus, 'narrow')).toBe(noOpus);
  });
});
