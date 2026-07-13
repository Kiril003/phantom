import { describe, expect, it } from 'vitest';
import { parseDepth, parseSpawn, resolveKey } from './keymap';
import { Verb } from './types';

const alt = (code: string) => ({ code, altKey: true });

describe('local verb keymap', () => {
  it('binds all six verbs to Alt-modified physical keys', () => {
    expect(resolveKey(alt('Enter'))).toEqual({ action: 'verb', verb: Verb.Approach });
    expect(resolveKey(alt('Escape'))).toEqual({ action: 'verb', verb: Verb.Recede });
    // mutter grabs Alt+Escape; Backspace is Recede's guaranteed path.
    expect(resolveKey(alt('Backspace'))).toEqual({ action: 'verb', verb: Verb.Recede });
    expect(resolveKey(alt('Period'))).toEqual({ action: 'verb', verb: Verb.Pin });
    expect(resolveKey(alt('KeyF'))).toEqual({ action: 'verb', verb: Verb.Feed });
    expect(resolveKey(alt('KeyD'))).toEqual({ action: 'verb', verb: Verb.Cleave });
    expect(resolveKey(alt('Slash'))).toEqual({ action: 'verb', verb: Verb.Trace });
  });

  it('cycles the target with Alt + arrows', () => {
    expect(resolveKey(alt('ArrowRight'))).toEqual({ action: 'target', dir: 1 });
    expect(resolveKey(alt('ArrowDown'))).toEqual({ action: 'target', dir: 1 });
    expect(resolveKey(alt('ArrowLeft'))).toEqual({ action: 'target', dir: -1 });
    expect(resolveKey(alt('ArrowUp'))).toEqual({ action: 'target', dir: -1 });
  });

  it('never fires without Alt — ordinary typing stays untouched', () => {
    expect(resolveKey({ code: 'KeyF', altKey: false })).toBeNull();
    expect(resolveKey({ code: 'Enter', altKey: false })).toBeNull();
    expect(resolveKey({ code: 'Escape', altKey: false })).toBeNull();
    expect(resolveKey({ code: 'Period', altKey: false })).toBeNull();
  });

  it('yields Alt+Ctrl / Alt+Meta chords to the host OS', () => {
    expect(resolveKey({ code: 'KeyD', altKey: true, ctrlKey: true })).toBeNull();
    expect(resolveKey({ code: 'KeyD', altKey: true, metaKey: true })).toBeNull();
  });

  it('ignores unbound keys', () => {
    expect(resolveKey(alt('KeyQ'))).toBeNull();
    expect(resolveKey(alt('Space'))).toBeNull();
  });
});

describe('spawn sigil', () => {
  it('parses the spawnable facets after a slash', () => {
    expect(parseSpawn('/log')).toEqual({ kind: 'log', arg: '' });
    expect(parseSpawn('/monitor')).toEqual({ kind: 'monitor', arg: '' });
    expect(parseSpawn('  /DOSSIER anima ')).toEqual({ kind: 'dossier', arg: 'anima' });
  });

  it('leaves ordinary questions alone', () => {
    expect(parseSpawn('who are you')).toBeNull();
    expect(parseSpawn('')).toBeNull();
  });

  it('rejects an unknown slash word rather than guessing', () => {
    expect(parseSpawn('/nonsense')).toBeNull();
  });
});

describe('the dive words', () => {
  it('descends and surfaces by word — semantic zoom is the navigation', () => {
    expect(parseDepth('/deep')).toBe(1);
    expect(parseDepth('/dive')).toBe(1);
    expect(parseDepth('/surface')).toBe(-1);
    expect(parseDepth('/up')).toBe(-1);
  });

  it('does not mistake a question, or a spawn, for a dive', () => {
    expect(parseDepth('how deep is the ocean')).toBeNull();
    expect(parseDepth('/monitor')).toBeNull();
    expect(parseDepth('')).toBeNull();
  });
});
