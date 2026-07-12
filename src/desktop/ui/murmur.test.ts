import { describe, expect, it } from 'vitest';
import { MurmurQueue } from './murmur';
import { toMurmurLine, extractText, parseSystemState } from './types';
import { nextDelayMs } from './ws';

describe('MurmurQueue', () => {
  it('serves murmurs one at a time in arrival order', () => {
    const q = new MurmurQueue();
    q.push({ text: 'перший', voice: 'entity' });
    q.push({ text: 'другий', voice: 'system' });
    expect(q.next()?.text).toBe('перший');
    expect(q.next()?.text).toBe('другий');
    expect(q.next()).toBeNull();
  });

  it('collapses a backlog deeper than two into one batch murmur', () => {
    const q = new MurmurQueue();
    q.push({ text: 'a', voice: 'system' });
    q.push({ text: 'b', voice: 'system' });
    q.push({ text: 'c', voice: 'system' });
    expect(q.depth).toBe(1);
    const batch = q.next();
    expect(batch?.voice).toBe('entity');
    expect(batch?.text).toContain('3 речей');
    expect(q.next()).toBeNull();
  });
});

describe('toMurmurLine', () => {
  it('keeps only the first sentence', () => {
    expect(toMurmurLine('Перше речення. Друге речення.')).toBe('Перше речення.');
  });

  it('collapses whitespace and hard-caps length with an ellipsis', () => {
    const long = 'слово '.repeat(60);
    const line = toMurmurLine(long);
    expect(line.length).toBeLessThanOrEqual(140);
    expect(line.endsWith('…')).toBe(true);
    expect(line.includes('\n')).toBe(false);
  });
});

describe('extractText', () => {
  it('reads flat string fields', () => {
    expect(extractText({ text: ' повітря погане ' })).toBe('повітря погане');
  });

  it('reads nested proactive message content', () => {
    expect(extractText({ message: { content: 'тиск падає' } })).toBe('тиск падає');
  });

  it('returns null for shapeless data', () => {
    expect(extractText({ foo: 1 })).toBeNull();
  });
});

describe('parseSystemState', () => {
  it('normalizes case and validates membership', () => {
    expect(parseSystemState('sentinel')).toBe('SENTINEL');
    expect(parseSystemState('FOCUS')).toBe('FOCUS');
    expect(parseSystemState('nonsense')).toBeNull();
    expect(parseSystemState(42)).toBeNull();
  });
});

describe('nextDelayMs', () => {
  it('backs off exponentially and caps at 30s', () => {
    const noJitter = () => 0.5;
    expect(nextDelayMs(0, noJitter)).toBe(1_000);
    expect(nextDelayMs(1, noJitter)).toBe(2_000);
    expect(nextDelayMs(3, noJitter)).toBe(8_000);
    expect(nextDelayMs(20, noJitter)).toBe(30_000);
  });

  it('applies bounded jitter', () => {
    const hi = nextDelayMs(2, () => 1);
    const lo = nextDelayMs(2, () => 0);
    expect(hi).toBe(4_800);
    expect(lo).toBe(3_200);
  });
});
